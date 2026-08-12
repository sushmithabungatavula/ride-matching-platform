from fastapi import APIRouter, Response, status

from app.database import check_db_connection
from app.redis_client import get_redis

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def liveness():
    """Liveness probe. Only checks that the process is running and able to
    respond, kept intentionally cheap so kubelet's frequent checks don't
    add load to the database or Redis.
    """
    return {"status": "ok"}


@router.get("/readyz")
async def readiness(response: Response):
    """Readiness probe. Verifies the pod can actually serve traffic by
    checking its dependencies. Kubernetes stops routing traffic to this
    pod if any check fails.
    """
    checks = {"database": await check_db_connection()}

    try:
        await get_redis().ping()
        checks["redis"] = True
    except Exception:
        checks["redis"] = False

    healthy = all(checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ok" if healthy else "degraded", "checks": checks}
