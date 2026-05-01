from app.workers.celery_app import QUEUE_NAMES, celery_app


def test_celery_queues_are_configured() -> None:
    assert set(QUEUE_NAMES) == {
        "default",
        "payments",
        "provider_polling",
        "video_local_gpu",
        "video_local_gpu_dlq",
        "video_cloud_api",
    }
    assert celery_app.conf.task_default_queue == "default"
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert "app.workers.tasks.poll_provider_job" in celery_app.conf.task_routes
    assert celery_app.conf.task_routes["app.workers.tasks.run_video_replace_pipeline"] == {
        "queue": "video_local_gpu"
    }
