import type { UploadedFile } from "../api";
import type { ControlOwnerScope } from "../control-owner-scope";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type ApiRequestErrorOptions = {
  code?: string;
  status?: number;
};

type ControlMediaRequestScope = {
  accountOwnerType: NonNullable<ControlOwnerScope["accountOwnerType"]>;
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

type ControlMediaBeginResponse = {
  media_object_id?: string;
  mediaObjectId?: string;
  bucket?: string;
  upload_session_id?: string;
  uploadSessionId?: string;
  object_key?: string;
  objectKey?: string;
  upload_url?: string;
  uploadUrl?: string;
};

type ControlMediaReadResponse = {
  signed_read_url?: string;
  signedReadUrl?: string;
};

export type MediaServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  createClientId: (prefix: string) => string;
  createApiRequestError: (message: string, options?: ApiRequestErrorOptions) => Error;
};

function buildControlMediaScope(
  actorId: string,
  ownerScope: ControlOwnerScope,
): ControlMediaRequestScope {
  return {
    accountOwnerType: ownerScope.accountOwnerType ?? "user",
    accountOwnerId: ownerScope.accountOwnerId ?? actorId,
    regionCode: "CN",
    currency: "CNY",
  };
}

function toObjectKeySegment(value: string, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return (normalized || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function inferMediaType(kind: string, file: File) {
  const normalizedKind = String(kind || "").trim();
  if (normalizedKind) return normalizedKind;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function fileNameForDataUrl(kind: string, nameHint: string, contentType: string) {
  const extByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  };
  const ext = extByType[contentType] || "bin";
  return `${toObjectKeySegment(nameHint || kind, "upload")}.${ext}`;
}

function buildStableLocalObjectContentPath(bucket: string, objectKey: string) {
  const normalizedBucket = String(bucket || "").trim();
  const normalizedObjectKey = String(objectKey || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  if (!normalizedBucket || !normalizedObjectKey) {
    return "";
  }

  return `/api/media/object-content/${encodeURIComponent(normalizedBucket)}/${normalizedObjectKey}`;
}

export function createMediaService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  createClientId,
  createApiRequestError,
}: MediaServiceDeps) {
  const uploadFile = async (file: File, kind = "file") => {
    const actorId = getCurrentActorId();
    const uploadId = createClientId("media");
    const mediaType = inferMediaType(kind, file);
    const contentType = file.type || "application/octet-stream";
    const objectKey = [
      "media",
      "frontend",
      toObjectKeySegment(actorId, "guest"),
      `${uploadId}-${toObjectKeySegment(file.name, "upload.bin")}`,
    ].join("/");
    const scope = buildControlMediaScope(actorId, resolveCurrentOwnerScope());

    const begin = await controlApiJsonRequest<ControlMediaBeginResponse>("/api/media/upload-begin", {
      method: "POST",
      body: JSON.stringify({
        ...scope,
        idempotencyKey: `frontend:${actorId}:${uploadId}`,
        objectKey,
        mediaType,
        contentType,
        byteSize: file.size,
        data: {
          originalName: file.name,
          frontendKind: kind,
        },
      }),
    });

    const mediaObjectId = String(begin.media_object_id || begin.mediaObjectId || "");
    const uploadSessionId = String(begin.upload_session_id || begin.uploadSessionId || "");
    const uploadUrl = String(begin.upload_url || begin.uploadUrl || "");
    const bucket = String(begin.bucket || "");
    const stableReadPath = buildStableLocalObjectContentPath(bucket, objectKey);
    if (!mediaObjectId || !uploadSessionId || !uploadUrl) {
      throw createApiRequestError("Control API did not return a usable media upload session", {
        code: "MEDIA_UPLOAD_SESSION_INVALID",
        status: 502,
      });
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw createApiRequestError("Object storage upload failed", {
        code: "MEDIA_OBJECT_UPLOAD_FAILED",
        status: uploadResponse.status,
      });
    }

    await controlApiJsonRequest<unknown>("/api/media/upload-complete", {
      method: "POST",
      body: JSON.stringify({
        ...scope,
        uploadSessionId,
        mediaObjectId,
        byteSize: file.size,
      }),
    });

    await controlApiJsonRequest<unknown>("/api/media/move-temp-to-permanent", {
      method: "POST",
      body: JSON.stringify({
        ...scope,
        mediaObjectId,
        permanentObjectKey: objectKey,
        reason: `frontend-${mediaType}`,
      }),
    });

    const read = await controlApiJsonRequest<ControlMediaReadResponse>("/api/media/signed-read-url", {
      method: "POST",
      body: JSON.stringify({
        ...scope,
        mediaObjectId,
        expiresInSeconds: 3600,
      }),
    });
    const signedReadUrl = String(read.signed_read_url || read.signedReadUrl || uploadUrl);

    return {
      id: mediaObjectId,
      kind,
      originalName: file.name,
      storedName: objectKey.split("/").pop() || objectKey,
      sizeBytes: file.size,
      contentType,
      url: signedReadUrl,
      urlPath: stableReadPath || signedReadUrl,
      mediaObjectId,
      objectKey,
      signedReadUrl,
    } satisfies UploadedFile;
  };

  const uploadDataUrlAsFile = async (dataUrl: string, kind = "file", nameHint = "upload") => {
    if (!dataUrl.startsWith("data:")) {
      throw createApiRequestError("Expected a data URL for media upload", {
        code: "MEDIA_UPLOAD_INVALID_DATA_URL",
        status: 400,
      });
    }

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const contentType = blob.type || dataUrl.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
    const file = new File([blob], fileNameForDataUrl(kind, nameHint, contentType), { type: contentType });
    return uploadFile(file, kind);
  };

  return {
    uploadFile,
    uploadDataUrlAsFile,
  };
}
