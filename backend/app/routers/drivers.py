import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.kafka_client import publish
from app.models import Driver
from app.redis_client import remove_driver, upsert_driver_location
from app.schemas import DriverCreate, DriverLocationUpdate, DriverOut

router = APIRouter(prefix="/drivers", tags=["drivers"])
logger = logging.getLogger(__name__)


@router.post("", response_model=DriverOut, status_code=201)
async def register_driver(payload: DriverCreate, db: AsyncSession = Depends(get_db)):
    driver = Driver(name=payload.name, vehicle_type=payload.vehicle_type)
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


@router.post("/{driver_id}/location", response_model=DriverOut)
async def update_driver_location(
    driver_id: uuid.UUID,
    payload: DriverLocationUpdate,
    db: AsyncSession = Depends(get_db),
):
    """High-frequency endpoint hit by the driver app every few seconds.
    Writes go to Redis synchronously (needed immediately for matching) and
    to Kafka asynchronously (for trip replay, analytics, fraud detection),
    keeping this endpoint fast under load.
    """
    result = await db.execute(select(Driver).where(Driver.id == driver_id))
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="driver not found")

    driver.last_lat = payload.lat
    driver.last_lng = payload.lng
    driver.status = payload.status
    await db.commit()
    await db.refresh(driver)

    await upsert_driver_location(
        str(driver_id), payload.lat, payload.lng, payload.status.value
    )
    await publish(
        settings.kafka_topic_driver_locations,
        key=str(driver_id),
        value={
            "driver_id": str(driver_id),
            "lat": payload.lat,
            "lng": payload.lng,
            "status": payload.status.value,
        },
    )

    return driver


@router.post("/{driver_id}/offline", response_model=DriverOut)
async def set_driver_offline(driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Driver).where(Driver.id == driver_id))
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="driver not found")

    from app.models import DriverStatus

    driver.status = DriverStatus.OFFLINE
    await db.commit()
    await db.refresh(driver)
    await remove_driver(str(driver_id))
    return driver


@router.get("/{driver_id}", response_model=DriverOut)
async def get_driver(driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Driver).where(Driver.id == driver_id))
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(status_code=404, detail="driver not found")
    return driver
