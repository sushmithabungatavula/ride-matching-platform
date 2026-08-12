import logging

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)

DRIVER_GEO_KEY = "drivers:geo"
DRIVER_STATUS_KEY_PREFIX = "driver:status:"

_pool = redis.ConnectionPool(
    host=settings.redis_host,
    port=settings.redis_port,
    db=settings.redis_db,
    decode_responses=True,
    max_connections=50,
)


def get_redis() -> redis.Redis:
    return redis.Redis(connection_pool=_pool)


async def upsert_driver_location(driver_id: str, lat: float, lng: float, status: str) -> None:
    """Write a driver's live location into a Redis geo set (O(log N) insert)
    and cache its current status. This is the hot path hit on every location
    ping, so it stays on Redis instead of Postgres.
    """
    r = get_redis()
    async with r.pipeline(transaction=True) as pipe:
        pipe.geoadd(DRIVER_GEO_KEY, (lng, lat, driver_id))
        pipe.set(f"{DRIVER_STATUS_KEY_PREFIX}{driver_id}", status, ex=120)
        await pipe.execute()


async def remove_driver(driver_id: str) -> None:
    r = get_redis()
    async with r.pipeline(transaction=True) as pipe:
        pipe.zrem(DRIVER_GEO_KEY, driver_id)
        pipe.delete(f"{DRIVER_STATUS_KEY_PREFIX}{driver_id}")
        await pipe.execute()


async def find_nearby_drivers(
    lat: float, lng: float, radius_km: float, limit: int
) -> list[tuple[str, float]]:
    """GEOSEARCH for the closest available drivers within radius_km,
    sorted ascending by distance. Returns (driver_id, distance_km) pairs.
    """
    r = get_redis()
    results = await r.geosearch(
        DRIVER_GEO_KEY,
        longitude=lng,
        latitude=lat,
        radius=radius_km,
        unit="km",
        sort="ASC",
        count=limit * 3,  # over-fetch, then filter by live status below
        withdist=True,
    )

    available: list[tuple[str, float]] = []
    for driver_id, distance in results:
        status = await r.get(f"{DRIVER_STATUS_KEY_PREFIX}{driver_id}")
        if status == "AVAILABLE":
            available.append((driver_id, float(distance)))
        if len(available) >= limit:
            break

    return available
