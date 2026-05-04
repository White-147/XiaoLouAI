from fastapi import APIRouter, Response

from app.db import check_database
from app.metrics import metrics_response
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/readyz", response_model=HealthResponse)
async def ready() -> HealthResponse:
    return HealthResponse(status="ok", database=await check_database())


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return metrics_response()
