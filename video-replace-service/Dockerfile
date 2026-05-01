# ⚠ LEGACY — this Dockerfile builds the standalone FastAPI (port 4200)
# debug variant only. The default / production stack is core-api 4100-native
# (Node). See core-api/README.md for the current architecture. Do not ship
# this image alongside core-api 4100 in production. Both write the same
# PostgreSQL video_replace_jobs table and can race startup reconcile.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VR_LEGACY_STANDALONE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml /app/
RUN pip install --upgrade pip && pip install .

COPY app /app/app

# 4201 — intentionally NOT 4200 so this legacy container can't quietly
# resurrect the historical sidecar port. If you explicitly need 4200 in
# a debug deploy, pass -p 4200:4201 at `docker run` time.
EXPOSE 4201
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4201"]
