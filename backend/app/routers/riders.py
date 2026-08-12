import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Rider
from app.schemas import RiderCreate, RiderOut

router = APIRouter(prefix="/riders", tags=["riders"])


@router.post("", response_model=RiderOut, status_code=201)
async def register_rider(payload: RiderCreate, db: AsyncSession = Depends(get_db)):
    rider = Rider(name=payload.name)
    db.add(rider)
    await db.commit()
    await db.refresh(rider)
    return rider


@router.get("/{rider_id}", response_model=RiderOut)
async def get_rider(rider_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Rider).where(Rider.id == rider_id))
    rider = result.scalar_one_or_none()
    if rider is None:
        raise HTTPException(status_code=404, detail="rider not found")
    return rider
