import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DriverStatus(str, enum.Enum):
    OFFLINE = "OFFLINE"
    AVAILABLE = "AVAILABLE"
    EN_ROUTE = "EN_ROUTE"
    ON_TRIP = "ON_TRIP"


class TripStatus(str, enum.Enum):
    REQUESTED = "REQUESTED"
    MATCHED = "MATCHED"
    DRIVER_ARRIVING = "DRIVER_ARRIVING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    UNMATCHED = "UNMATCHED"


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120))
    vehicle_type: Mapped[str] = mapped_column(String(40), default="standard")
    status: Mapped[DriverStatus] = mapped_column(
        Enum(DriverStatus), default=DriverStatus.OFFLINE
    )
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    trips: Mapped[list["Trip"]] = relationship(back_populates="driver")


class Rider(Base):
    __tablename__ = "riders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    trips: Mapped[list["Trip"]] = relationship(back_populates="rider")


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    rider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("riders.id"))
    driver_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("drivers.id"), nullable=True
    )

    status: Mapped[TripStatus] = mapped_column(
        Enum(TripStatus), default=TripStatus.REQUESTED
    )

    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    dropoff_lat: Mapped[float] = mapped_column(Float)
    dropoff_lng: Mapped[float] = mapped_column(Float)

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    matched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    rider: Mapped["Rider"] = relationship(back_populates="trips")
    driver: Mapped["Driver"] = relationship(back_populates="trips")
