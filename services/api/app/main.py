from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import admin, health, payments, projects, tasks, uploads, video_replace, wallets
from app.config import get_settings
from app.logging import configure_logging
from app.metrics import MetricsMiddleware
from app.services.video_replace import ensure_video_replace_dirs, video_replace_static_dirs


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="XiaoLouAI API",
        version="0.1.0",
        description="Python production API for XiaoLouAI.",
    )
    app.add_middleware(MetricsMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(projects.router)
    app.include_router(tasks.router)
    app.include_router(uploads.router)
    app.include_router(video_replace.router)
    app.include_router(wallets.router)
    app.include_router(payments.router)
    app.include_router(admin.router)
    ensure_video_replace_dirs(settings)
    for prefix, directory in video_replace_static_dirs(settings).items():
        app.mount(
            prefix,
            StaticFiles(directory=str(directory)),
            name=prefix.strip("/").replace("-", "_"),
        )
    return app


app = create_app()
