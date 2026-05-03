from fastapi.testclient import TestClient

from app.main import create_app


def test_legacy_reference_health_route_is_importable() -> None:
    """The archived FastAPI reference remains importable for route comparison."""

    client = TestClient(create_app())
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": None}
