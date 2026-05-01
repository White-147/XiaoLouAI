from fastapi.testclient import TestClient

from app.main import create_app


def test_video_replace_routes_are_registered() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/video-replace/upload" in paths
    assert "/api/video-replace/reference" in paths
    assert "/api/video-replace/jobs" in paths
    assert "/api/video-replace/reference-import" in paths
    assert "/api/video-replace/jobs/{job_id}/detect" in paths
    assert "/api/video-replace/jobs/{job_id}/enqueue" in paths
    assert "/api/video-replace/jobs/{job_id}/cancel" in paths
