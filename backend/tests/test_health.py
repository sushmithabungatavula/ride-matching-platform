"""Smoke test for the health endpoints. Run with: pytest backend/tests

Uses FastAPI's TestClient against the liveness endpoint, which has no
external dependencies, so this runs without Postgres/Redis/Kafka present.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_liveness_ok():
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
