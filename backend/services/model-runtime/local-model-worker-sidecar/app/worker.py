from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

WORKER_KIND = "local-model"
WORKER_EXECUTION_MODE = "stubbed-simulated"
WORKER_RUNTIME_BOUNDARY = "canonical-queue-worker-skeleton"
WORKER_ADAPTER_STATUS = "not_connected"


def post_json(base_url: str, path: str, payload: dict[str, Any], internal_token: str = "") -> Any:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if internal_token:
        headers["X-XiaoLou-Internal-Token"] = internal_token

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def payload_requests_failure(job: dict[str, Any]) -> bool:
    payload = job.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)

    return isinstance(payload, dict) and payload.get("forceFail") is True


def build_stubbed_result(worker_id: str, provider_route: str) -> dict[str, Any]:
    return {
        "worker": worker_id,
        "kind": WORKER_KIND,
        "providerRoute": provider_route,
        "status": "stubbed",
        "executionMode": WORKER_EXECUTION_MODE,
        "runtimeBoundary": WORKER_RUNTIME_BOUNDARY,
        "adapterStatus": WORKER_ADAPTER_STATUS,
        "isStubbed": True,
        "isSimulated": True,
        "contract": (
            "This result proves canonical PostgreSQL job lease/running/succeed plumbing only; "
            "no real local model adapter or media output has been executed."
        ),
        "requiredForRealExecution": [
            "model_adapter",
            "model_weights_or_endpoint",
            "object_storage_media_outputs",
        ],
    }


def run_worker(
    control_api: str,
    lane: str,
    provider_route: str,
    worker_id: str,
    poll_seconds: int,
    batch_size: int,
    lease_seconds: int,
    run_once: bool,
    internal_token: str,
) -> None:
    print(
        (
            f"local model worker executionMode={WORKER_EXECUTION_MODE} "
            f"adapterStatus={WORKER_ADAPTER_STATUS}; canonical queue worker skeleton only"
        ),
        flush=True,
    )

    while True:
        try:
            leased = post_json(
                control_api,
                "/api/internal/jobs/lease",
                {
                    "lane": lane,
                    "providerRoute": provider_route,
                    "workerId": worker_id,
                    "batchSize": batch_size,
                    "leaseSeconds": lease_seconds,
                },
                internal_token,
            )
            if not leased:
                if run_once:
                    print("run-once mode found no local model jobs to process", flush=True)
                    return
                time.sleep(poll_seconds)
                continue

            for job in leased:
                job_id = job["id"]
                try:
                    post_json(control_api, f"/api/internal/jobs/{job_id}/running", {"workerId": worker_id}, internal_token)
                    if payload_requests_failure(job):
                        raise RuntimeError("forced local model worker failure requested by job payload")

                    # Boundary contract: this proves queue plumbing only. Real adapters
                    # must replace the simulated result with media output metadata.
                    post_json(
                        control_api,
                        f"/api/internal/jobs/{job_id}/succeed",
                        {"result": build_stubbed_result(worker_id, provider_route)},
                        internal_token,
                    )
                except Exception as exc:
                    post_json(
                        control_api,
                        f"/api/internal/jobs/{job_id}/fail",
                        {
                            "error": str(exc),
                            "retry": True,
                        },
                        internal_token,
                    )

                if run_once:
                    return
        except urllib.error.URLError as exc:
            print(f"control API unavailable: {exc}", flush=True)
            if run_once:
                raise
            time.sleep(poll_seconds)
        except Exception as exc:
            print(f"local model worker loop failed: {exc}", flush=True)
            if run_once:
                raise
            time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--control-api", default=os.getenv("CONTROL_API_BASE_URL", "http://127.0.0.1:4100"))
    parser.add_argument("--lane", default=os.getenv("LOCAL_MODEL_WORKER_LANE", "account-media"))
    parser.add_argument(
        "--provider-route",
        "--kind",
        dest="provider_route",
        default=os.getenv("LOCAL_MODEL_WORKER_PROVIDER_ROUTE", "local-model"),
    )
    parser.add_argument("--worker-id", default=os.getenv("LOCAL_MODEL_WORKER_ID", "local-model-worker-1"))
    parser.add_argument("--poll-seconds", type=int, default=int(os.getenv("LOCAL_MODEL_WORKER_POLL_SECONDS", "5")))
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("LOCAL_MODEL_WORKER_BATCH_SIZE", "1")))
    parser.add_argument("--lease-seconds", type=int, default=int(os.getenv("LOCAL_MODEL_WORKER_LEASE_SECONDS", "300")))
    parser.add_argument(
        "--internal-token",
        default=os.getenv("LOCAL_MODEL_WORKER_INTERNAL_TOKEN", os.getenv("INTERNAL_API_TOKEN", "")),
    )
    parser.add_argument(
        "--run-once",
        action="store_true",
        default=os.getenv("LOCAL_MODEL_WORKER_RUN_ONCE", "").lower() in {"1", "true", "yes"},
    )
    args = parser.parse_args()

    run_worker(
        args.control_api,
        args.lane,
        args.provider_route,
        args.worker_id,
        args.poll_seconds,
        args.batch_size,
        args.lease_seconds,
        args.run_once,
        args.internal_token,
    )


if __name__ == "__main__":
    main()
