from celery import Celery
from kombu import Exchange, Queue

from app.config import get_settings

DEAD_LETTER_EXCHANGE = "xiaolou.dlx"
QUEUE_NAMES = (
    "default",
    "payments",
    "provider_polling",
    "video_local_gpu",
    "video_local_gpu_dlq",
    "video_cloud_api",
)

settings = get_settings()

celery_app = Celery(
    "xiaolou",
    broker=settings.rabbitmq_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    accept_content=["json"],
    broker_connection_retry_on_startup=True,
    enable_utc=True,
    task_default_retry_delay=30,
    result_expires=3600,
    result_serializer="json",
    task_acks_late=True,
    task_default_queue="default",
    task_queues=(
        Queue("default"),
        Queue("payments"),
        Queue("provider_polling"),
        Queue(
            "video_local_gpu",
            queue_arguments={
                "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE,
                "x-dead-letter-routing-key": "video_local_gpu.dlq",
            },
        ),
        Queue(
            "video_local_gpu_dlq",
            exchange=Exchange(DEAD_LETTER_EXCHANGE, type="direct"),
            routing_key="video_local_gpu.dlq",
        ),
        Queue("video_cloud_api"),
    ),
    task_reject_on_worker_lost=True,
    task_routes={
        "app.workers.tasks.dispatch_task": {"queue": "default"},
        "app.workers.tasks.submit_provider_job": {"queue": "default"},
        "app.workers.tasks.poll_provider_job": {"queue": "provider_polling"},
        "app.workers.tasks.reconcile_recharge_order": {"queue": "payments"},
        "app.workers.tasks.run_video_replace_detection": {"queue": "video_local_gpu"},
        "app.workers.tasks.run_video_replace_pipeline": {"queue": "video_local_gpu"},
    },
    task_serializer="json",
    task_track_started=True,
    timezone="UTC",
    worker_prefetch_multiplier=1,
)
