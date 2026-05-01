from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import UploadSignRequest, UploadSignResponse

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("/sign", response_model=UploadSignResponse)
async def sign_upload(payload: UploadSignRequest) -> UploadSignResponse:
    settings = get_settings()
    safe_name = Path(payload.filename).name.replace("\\", "_").replace("/", "_")
    object_key = f"{payload.asset_type}/{uuid4()}-{safe_name}"

    if settings.storage_backend == "local":
        return UploadSignResponse(
            upload_url=f"{settings.public_base_url}/api/uploads/local/{object_key}",
            public_url=f"{settings.public_base_url}/uploads/{object_key}",
            headers={"content-type": payload.content_type},
        )

    return UploadSignResponse(
        upload_url=f"s3://{settings.object_store_bucket}/{object_key}",
        public_url=f"{settings.public_base_url}/uploads/{object_key}",
        headers={"content-type": payload.content_type},
    )
