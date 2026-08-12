import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import DriverStatus, TripStatus


class DriverCreate(BaseModel):
    name: str
    vehicle_type: str = "standard"


class DriverLocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    status: DriverStatus = DriverStatus.AVAILABLE


class DriverOut(BaseModel):
    id: uuid.UUID
    name: str
    vehicle_type: str
    status: DriverStatus
    last_lat: float | None
    last_lng: float | None
    updated_at: datetime

    class Config:
        from_attributes = True


class RiderCreate(BaseModel):
    name: str


class RiderOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


class TripRequestCreate(BaseModel):
    rider_id: uuid.UUID
    pickup_lat: float = Field(ge=-90, le=90)
    pickup_lng: float = Field(ge=-180, le=180)
    dropoff_lat: float = Field(ge=-90, le=90)
    dropoff_lng: float = Field(ge=-180, le=180)


class TripOut(BaseModel):
    id: uuid.UUID
    rider_id: uuid.UUID
    driver_id: uuid.UUID | None
    status: TripStatus
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    requested_at: datetime
    matched_at: datetime | None
    completed_at: datetime | None

    class Config:
        from_attributes = True


class NearbyDriver(BaseModel):
    driver_id: uuid.UUID
    distance_km: float
