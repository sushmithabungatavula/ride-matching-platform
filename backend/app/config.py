from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration. All values are overridable via environment
    variables, which is how the Docker and Kubernetes manifests inject them.
    """

    app_name: str = "ride-matching-platform"
    environment: str = "development"

    # Postgres
    database_url: str = (
        "postgresql+asyncpg://ride_user:ride_pass@postgres:5432/ride_matching"
    )

    # Redis (geospatial driver index + trip cache)
    redis_host: str = "redis"
    redis_port: int = 6379
    redis_db: int = 0

    # Kafka
    kafka_bootstrap_servers: str = "kafka:9092"
    kafka_topic_driver_locations: str = "driver.locations"
    kafka_topic_trip_events: str = "trip.events"
    kafka_consumer_group: str = "ride-matching-consumers"

    # Matching
    match_search_radius_km: float = 5.0
    match_max_candidates: int = 10

    log_level: str = "INFO"

    class Config:
        env_file = ".env"


settings = Settings()
