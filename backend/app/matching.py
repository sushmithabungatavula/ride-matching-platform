import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.kafka_client import publish
from app.models import Driver, DriverStatus, Trip, TripStatus
from app.redis_client import find_nearby_drivers

logger = logging.getLogger(__name__)


async def match_trip(db: AsyncSession, trip: Trip) -> Trip:
    """Find the closest available driver for a trip request and reserve them.

    Strategy:
    1. Ask Redis for the nearest AVAILABLE drivers around the pickup point
       (geospatial index, sub-millisecond lookup even at large fleet size).
    2. Walk candidates closest-first and atomically claim the first one
       whose status is still AVAILABLE in Postgres (source of truth),
       guarding against a race where two riders match the same driver.
    3. Emit a trip.events message so downstream services (notifications,
       ETA, pricing) can react without the API blocking on them.
    """
    candidates = await find_nearby_drivers(
        lat=trip.pickup_lat,
        lng=trip.pickup_lng,
        radius_km=settings.match_search_radius_km,
        limit=settings.match_max_candidates,
    )

    if not candidates:
        trip.status = TripStatus.UNMATCHED
        await db.commit()
        await publish(
            settings.kafka_topic_trip_events,
            key=str(trip.id),
            value={"event": "trip_unmatched", "trip_id": str(trip.id)},
        )
        return trip

    for driver_id_str, distance_km in candidates:
        driver_id = uuid.UUID(driver_id_str)
        result = await db.execute(
            select(Driver).where(
                Driver.id == driver_id, Driver.status == DriverStatus.AVAILABLE
            ).with_for_update(skip_locked=True)
        )
        driver = result.scalar_one_or_none()
        if driver is None:
            continue  # already claimed by a concurrent match, try next

        driver.status = DriverStatus.EN_ROUTE
        trip.driver_id = driver.id
        trip.status = TripStatus.MATCHED
        from sqlalchemy import func

        trip.matched_at = func.now()
        await db.commit()
        await db.refresh(trip)

        await publish(
            settings.kafka_topic_trip_events,
            key=str(trip.id),
            value={
                "event": "trip_matched",
                "trip_id": str(trip.id),
                "driver_id": str(driver.id),
                "distance_km": round(distance_km, 3),
            },
        )
        logger.info(
            "matched trip=%s driver=%s distance_km=%.3f",
            trip.id, driver.id, distance_km,
        )
        return trip

    trip.status = TripStatus.UNMATCHED
    await db.commit()
    await publish(
        settings.kafka_topic_trip_events,
        key=str(trip.id),
        value={"event": "trip_unmatched", "trip_id": str(trip.id)},
    )
    return trip
