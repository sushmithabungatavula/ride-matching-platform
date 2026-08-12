# Ride Matching Platform

A distributed ride matching platform modeled on Uber's core dispatch flow. It ingests driver locations, accepts rider trip requests, matches riders to the nearest available driver, and tracks trip state through completion.

## Architecture

The system splits work across three data stores, each chosen for what it does best.

- FastAPI serves the REST API and runs async end to end.
- Redis holds a live geospatial index of driver locations. GEOSEARCH finds the nearest available drivers in milliseconds, even with a large fleet.
- PostgreSQL is the source of truth for drivers, riders, and trips. It also enforces matching correctness with row-level locking, so two riders can never claim the same driver.
- Kafka carries location pings and trip lifecycle events to downstream consumers (analytics, notifications, fraud checks) without blocking the API.
- Docker Compose runs the full stack locally. Kubernetes manifests deploy it to a cluster with health probes and autoscaling.

Request flow for a trip:

1. Driver app calls `POST /drivers/{id}/location` every few seconds. The API writes to Postgres, upserts the driver into the Redis geo index, and publishes a `driver.locations` event.
2. Rider app calls `POST /trips`. The API creates a trip row, then calls the matching engine.
3. The matching engine queries Redis for the closest available drivers, then claims the first one still marked `AVAILABLE` in Postgres using `SELECT ... FOR UPDATE SKIP LOCKED`. This avoids a race where two trips grab the same driver.
4. A `trip_matched` or `trip_unmatched` event publishes to Kafka.
5. Trip lifecycle endpoints (`/start`, `/complete`, `/cancel`) move the trip and driver through their states.

## Project layout

```
backend/
  app/
    main.py          FastAPI app, startup/shutdown, Kafka consumers
    config.py         Environment-driven settings
    database.py        Async SQLAlchemy engine and session
    models.py           Driver, Rider, Trip ORM models
    schemas.py            Pydantic request/response models
    redis_client.py         Geospatial index operations
    kafka_client.py          Producer and consumer helpers
    matching.py                Nearest-driver matching engine
    routers/                    drivers.py, riders.py, trips.py, health.py
  tests/
  Dockerfile
frontend/
  React + Vite dispatch console for demoing the API
k8s/
  Namespace, Postgres, Redis, Kafka, backend Deployment, Service, HPA, Ingress
docker-compose.yml
```

## Run it locally

Requires Docker and Docker Compose.

```
docker compose up --build
```

This starts Postgres, Redis, Kafka, the backend on port 8000, and the frontend on port 5173. Open `http://localhost:8000/docs` for the interactive API docs, or `http://localhost:5173` for the dispatch console.

## Run the backend without Docker

```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

You still need Postgres, Redis, and Kafka running somewhere reachable at the addresses in `.env`.

## Run tests

```
cd backend
pip install pytest
pytest
```

## Deploy to Kubernetes

```
kubectl apply -f k8s/
```

Build and push the backend image first, then update the image reference in `k8s/20-backend-deployment.yaml`. The backend runs 3 replicas by default and autoscales to 20 based on CPU and memory. Liveness and readiness probes hit `/healthz` and `/readyz`. The Kafka manifest runs a single broker for demo purposes; swap in the Strimzi operator for production.

## Key design decisions

- Matching stays inline with the trip request instead of going fully async. Redis GEOSEARCH is fast enough that this keeps the client experience simple: the API response tells you immediately whether a driver was found.
- Driver status lives in both Postgres and Redis. Postgres is authoritative and enforces locking during a claim. Redis is a fast index for the search step and expires stale entries automatically.
- Kafka topics are keyed by driver ID and trip ID, so partition ordering guarantees events for the same entity process in order.
- All backend endpoints are async, and the database pool is sized for concurrent load, so a single instance can handle a high volume of location pings without blocking on I/O.
