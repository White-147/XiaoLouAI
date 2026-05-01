from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx


class ProviderError(RuntimeError):
    """Base error for model provider failures."""


class ProviderConfigurationError(ProviderError):
    """Raised when a provider is selected but not configured."""


class ProviderSubmitError(ProviderError):
    """Raised when a provider rejects a job submission."""


class ProviderPollError(ProviderError):
    """Raised when provider job status cannot be read."""


class UnsupportedProviderError(ProviderError):
    """Raised when a model id cannot be mapped to a provider."""


@dataclass(frozen=True)
class ProviderJobRequest:
    task_id: str
    model_id: str
    input: dict[str, Any]
    callback_url: str | None = None


@dataclass(frozen=True)
class ProviderJobStatus:
    status: str
    external_job_id: str | None = None
    progress: int | None = None
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class BaseProvider(ABC):
    name: str
    kind: str
    queue_name: str

    @abstractmethod
    async def submit(self, request: ProviderJobRequest) -> ProviderJobStatus:
        """Submit a provider job and return its initial status."""

    @abstractmethod
    async def poll(self, external_job_id: str) -> ProviderJobStatus:
        """Read the latest status for a provider job."""

    @abstractmethod
    async def cancel(self, external_job_id: str) -> ProviderJobStatus:
        """Cancel a provider job when the backend supports it."""


def normalize_provider_status(value: Any) -> str:
    status = str(value or "queued").strip().lower()
    if status in {"pending", "created", "queued"}:
        return "queued"
    if status in {"starting", "processing", "running", "in_progress"}:
        return "running"
    if status in {"success", "succeeded", "completed", "complete", "done"}:
        return "succeeded"
    if status in {"cancelled", "canceled"}:
        return "cancelled"
    if status in {"failed", "error", "errored"}:
        return "failed"
    return "running"


class HTTPModelProvider(BaseProvider):
    submit_path = "/v1/jobs"
    poll_path_template = "/v1/jobs/{external_job_id}"
    cancel_path_template = "/v1/jobs/{external_job_id}/cancel"

    def __init__(
        self,
        *,
        name: str,
        kind: str,
        queue_name: str,
        base_url: str,
        api_key: str | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        normalized_base_url = base_url.strip().rstrip("/")
        if not normalized_base_url:
            raise ProviderConfigurationError(f"{name} provider base URL is not configured")
        self.name = name
        self.kind = kind
        self.queue_name = queue_name
        self.base_url = normalized_base_url
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def submit(self, request: ProviderJobRequest) -> ProviderJobStatus:
        payload = {
            "task_id": request.task_id,
            "model_id": request.model_id,
            "input": request.input,
            "callback_url": request.callback_url,
        }
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(),
                timeout=self.timeout_seconds,
            ) as client:
                response = await client.post(self.submit_path, json=payload)
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            raise ProviderSubmitError(f"{self.name} provider submit failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderSubmitError(f"{self.name} provider returned invalid JSON") from exc

        if not isinstance(body, dict):
            raise ProviderSubmitError(f"{self.name} provider returned invalid submit payload")
        external_job_id = _extract_external_job_id(body)
        if not external_job_id:
            raise ProviderSubmitError(f"{self.name} provider response is missing job id")
        return _status_from_payload(body, external_job_id=external_job_id)

    async def poll(self, external_job_id: str) -> ProviderJobStatus:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(),
                timeout=self.timeout_seconds,
            ) as client:
                response = await client.get(
                    self.poll_path_template.format(external_job_id=external_job_id)
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            raise ProviderPollError(f"{self.name} provider poll failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderPollError(f"{self.name} provider returned invalid JSON") from exc

        if not isinstance(body, dict):
            raise ProviderPollError(f"{self.name} provider returned invalid status payload")
        return _status_from_payload(body, external_job_id=external_job_id)

    async def cancel(self, external_job_id: str) -> ProviderJobStatus:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(),
                timeout=self.timeout_seconds,
            ) as client:
                response = await client.post(
                    self.cancel_path_template.format(external_job_id=external_job_id)
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            raise ProviderPollError(f"{self.name} provider cancel failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderPollError(f"{self.name} provider returned invalid JSON") from exc

        if not isinstance(body, dict):
            raise ProviderPollError(f"{self.name} provider returned invalid cancel payload")
        return _status_from_payload(body, external_job_id=external_job_id)


def _extract_external_job_id(payload: dict[str, Any]) -> str:
    raw = (
        payload.get("external_job_id")
        or payload.get("job_id")
        or payload.get("id")
        or payload.get("request_id")
        or ""
    )
    return str(raw).strip()


def _status_from_payload(
    payload: dict[str, Any],
    *,
    external_job_id: str,
) -> ProviderJobStatus:
    result = payload.get("result") or payload.get("output") or {}
    if not isinstance(result, dict):
        result = {"value": result}
    progress = payload.get("progress")
    return ProviderJobStatus(
        status=normalize_provider_status(payload.get("status")),
        external_job_id=external_job_id,
        progress=int(progress) if isinstance(progress, int | float) else None,
        result=result,
        error=str(payload.get("error") or "") or None,
        raw=payload,
    )
