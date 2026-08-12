import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import settings
from app.database import Base, engine
from app.kafka_client import consume_forever, start_producer, stop_producer
from app.logging_config import configure_logging
from app.routers import drivers, health, riders, trips

configure_logging()
logger = logging.getLogger(__name__)

_background_tasks: list[asyncio.Task] = []


async def _driver_location_event_logger(message: dict) -> None:
    """Example consumer: in production this fan-outs to analytics,
    surge-pricing, and fraud-detection services. Kept minimal here.
    """
    logger.info("driver_location_event %s", message)


async def _trip_event_logger(message: dict) -> None:
    logger.info("trip_event %s", message)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await start_producer()

    _background_tasks.append(
        asyncio.create_task(
            consume_forever(
                settings.kafka_topic_driver_locations,
                f"{settings.kafka_consumer_group}-locations",
                _driver_location_event_logger,
            )
        )
    )
    _background_tasks.append(
        asyncio.create_task(
            consume_forever(
                settings.kafka_topic_trip_events,
                f"{settings.kafka_consumer_group}-trips",
                _trip_event_logger,
            )
        )
    )
    logger.info("service started environment=%s", settings.environment)

    yield

    # Shutdown
    for task in _background_tasks:
        task.cancel()
    await asyncio.gather(*_background_tasks, return_exceptions=True)
    await stop_producer()
    await engine.dispose()
    logger.info("service stopped")


app = FastAPI(
    title="Ride Matching Platform",
    description="Distributed ride matching service: driver ingestion, "
    "rider requests, and real-time nearest-driver matching.",
    version="1.0.0",
    lifespan=lifespan,
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

app.include_router(health.router)
app.include_router(drivers.router)
app.include_router(riders.router)
app.include_router(trips.router)
