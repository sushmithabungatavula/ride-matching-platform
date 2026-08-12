import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.kafka_client import publish
from app.matching import match_trip
from app.models import Driver, DriverStatus, Trip, TripStatus
from app.schemas import TripOut, TripRequestCreate

router = APIRouter(prefix="/trips", tags=["trips"])


@router.post("", response_model=TripOut, status_code=201)
async def request_trip(payload: TripRequestCreate, db: AsyncSession = Depends(get_db)):
    """Create a trip request and synchronously attempt to match it to the
    nearest available driver. The match step is fast (Redis geosearch),
    so doing it inline keeps the API simple; heavier post-match work
    (notifications, ETA calc) happens off the request path via Kafka.
    """
    trip = Trip(
        rider_id=payload.rider_id,
        pickup_lat=payload.pickup_lat,
        pickup_lng=payload.pickup_lng,
        dropoff_lat=payload.dropoff_lat,
        dropoff_lng=payload.dropoff_lng,
        status=TripStatus.REQUESTED,
    )
    db.add(trip)
    await db.commit()
    await db.refresh(trip)

    await publish(
        settings.kafka_topic_trip_events,
        key=str(trip.id),
        value={"event": "trip_requested", "trip_id": str(trip.id)},
    )

    trip = await match_trip(db, trip)
    return trip


@router.post("/{trip_id}/start", response_model=TripOut)
async def start_trip(trip_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    trip = await _get_trip_or_404(db, trip_id)
    if trip.status != TripStatus.MATCHED:
        raise HTTPException(400, detail=f"cannot start trip in status {trip.status}")

    trip.status = TripStatus.IN_PROGRESS
    if trip.driver_id:
        result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
        driver = result.scalar_one_or_none()
        if driver:
            driver.status = DriverStatus.ON_TRIP
    await db.commit()
    await db.refresh(trip)

    await publish(
        settings.kafka_topic_trip_events,
        key=str(trip.id),
        value={"event": "trip_started", "trip_id": str(trip.id)},
    )
    return trip


@router.post("/{trip_id}/complete", response_model=TripOut)
async def complete_trip(trip_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func

    trip = await _get_trip_or_404(db, trip_id)
    if trip.status != TripStatus.IN_PROGRESS:
        raise HTTPException(400, detail=f"cannot complete trip in status {trip.status}")

    trip.status = TripStatus.COMPLETED
    trip.completed_at = func.now()
    if trip.driver_id:
        result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
        driver = result.scalar_one_or_none()
        if driver:
            driver.status = DriverStatus.AVAILABLE
    await db.commit()
    await db.refresh(trip)

    await publish(
        settings.kafka_topic_trip_events,
        key=str(trip.id),
        value={"event": "trip_completed", "trip_id": str(trip.id)},
    )
    return trip


@router.post("/{trip_id}/cancel", response_model=TripOut)
async def cancel_trip(trip_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    trip = await _get_trip_or_404(db, trip_id)
    if trip.status in (TripStatus.COMPLETED, TripStatus.CANCELLED):
        raise HTTPException(400, detail=f"cannot cancel trip in status {trip.status}")

    trip.status = TripStatus.CANCELLED
    if trip.driver_id:
        result = await db.execute(select(Driver).where(Driver.id == trip.driver_id))
        driver = result.scalar_one_or_none()
        if driver:
            driver.status = DriverStatus.AVAILABLE
    await db.commit()
    await db.refresh(trip)

    await publish(
        settings.kafka_topic_trip_events,
        key=str(trip.id),
        value={"event": "trip_cancelled", "trip_id": str(trip.id)},
    )
    return trip


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(trip_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await _get_trip_or_404(db, trip_id)


async def _get_trip_or_404(db: AsyncSession, trip_id: uuid.UUID) -> Trip:
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=404, detail="trip not found")
    return trip
