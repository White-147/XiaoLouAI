import base64
import binascii
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import Settings


class PaymentSignatureError(ValueError):
    """Raised when a payment callback cannot be trusted."""


def _decode_base64(value: str, label: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PaymentSignatureError(f"invalid {label}") from exc


def _load_public_key(public_key_pem: str, label: str) -> Any:
    try:
        return serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise PaymentSignatureError(f"invalid {label}") from exc


def resolve_secret_value(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "-----BEGIN" in raw:
        return raw.replace("\\n", "\n")

    for candidate in (Path(raw), Path.cwd() / raw):
        if candidate.exists() and candidate.is_file():
            return candidate.read_text(encoding="utf-8").replace("\\n", "\n")

    return raw.replace("\\n", "\n")


def _assert_fresh_timestamp(timestamp: str, *, window_seconds: int) -> None:
    try:
        value = int(timestamp)
    except (TypeError, ValueError) as exc:
        raise PaymentSignatureError("invalid callback timestamp") from exc

    now = int(datetime.now(tz=UTC).timestamp())
    if abs(now - value) > window_seconds:
        raise PaymentSignatureError("callback timestamp is outside replay window")


def _parse_alipay_time(value: str) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            parsed = datetime.strptime(value, fmt)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _assert_fresh_alipay_notify_time(params: Mapping[str, Any], *, window_seconds: int) -> None:
    parsed = _parse_alipay_time(str(params.get("notify_time") or ""))
    if parsed is None:
        return
    now = datetime.now(tz=UTC)
    if abs((now - parsed.astimezone(UTC)).total_seconds()) > window_seconds:
        raise PaymentSignatureError("Alipay notify_time is outside replay window")


def _serialize_alipay_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def build_alipay_sign_content(params: Mapping[str, Any]) -> str:
    return "&".join(
        f"{key}={_serialize_alipay_value(params[key])}"
        for key in sorted(params)
        if key not in {"sign", "sign_type"}
        and params[key] is not None
        and _serialize_alipay_value(params[key]) != ""
    )


def verify_alipay_notification(params: Mapping[str, Any], settings: Settings) -> None:
    signature = str(params.get("sign") or "").strip()
    public_key_pem = resolve_secret_value(settings.alipay_public_key)
    if not signature or not public_key_pem:
        raise PaymentSignatureError("missing Alipay signature or public key")

    _assert_fresh_alipay_notify_time(
        params, window_seconds=settings.payment_replay_window_seconds
    )
    public_key = _load_public_key(public_key_pem, "Alipay public key")
    try:
        public_key.verify(
            _decode_base64(signature, "Alipay signature"),
            build_alipay_sign_content(params).encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except InvalidSignature as exc:
        raise PaymentSignatureError("invalid Alipay signature") from exc

    app_id = str(params.get("app_id") or "").strip()
    seller_id = str(params.get("seller_id") or "").strip()
    if settings.alipay_app_id and app_id and app_id != settings.alipay_app_id:
        raise PaymentSignatureError("Alipay app_id mismatch")
    if settings.alipay_seller_id and seller_id and seller_id != settings.alipay_seller_id:
        raise PaymentSignatureError("Alipay seller_id mismatch")


def parse_amount_cents(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int((Decimal(str(value)) * Decimal("100")).quantize(Decimal("1")))
    except (InvalidOperation, ValueError):
        return None


def normalize_alipay_notification(params: Mapping[str, Any], settings: Settings) -> dict[str, Any]:
    verify_alipay_notification(params, settings)
    trade_status = str(params.get("trade_status") or "").strip()
    provider_trade_no = str(params.get("out_trade_no") or "").strip()
    transaction_id = str(params.get("trade_no") or "").strip()
    event_id = (
        str(params.get("notify_id") or "").strip()
        or transaction_id
        or f"{provider_trade_no}:{trade_status}"
    )
    return {
        "provider": "alipay",
        "event_id": event_id,
        "event_type": trade_status or "unknown",
        "provider_trade_no": provider_trade_no or None,
        "transaction_id": transaction_id or None,
        "status": "paid" if trade_status in {"TRADE_SUCCESS", "TRADE_FINISHED"} else "pending",
        "paid_at": str(params.get("gmt_payment") or "").strip() or None,
        "amount_cents": parse_amount_cents(params.get("total_amount")),
        "payload": dict(params),
    }


def _header(headers: Mapping[str, str], name: str) -> str:
    lower_name = name.lower()
    for key, value in headers.items():
        if key.lower() == lower_name:
            return str(value).strip()
    return ""


def verify_wechat_signature(raw_body: bytes, headers: Mapping[str, str], settings: Settings) -> None:
    timestamp = _header(headers, "Wechatpay-Timestamp")
    nonce = _header(headers, "Wechatpay-Nonce")
    signature = _header(headers, "Wechatpay-Signature")
    public_key_pem = resolve_secret_value(settings.wechat_pay_platform_public_key)
    if not timestamp or not nonce or not signature or not public_key_pem:
        raise PaymentSignatureError("missing WeChat Pay signature headers or public key")

    _assert_fresh_timestamp(timestamp, window_seconds=settings.payment_replay_window_seconds)
    try:
        body_text = raw_body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PaymentSignatureError("invalid WeChat Pay callback body encoding") from exc
    message = f"{timestamp}\n{nonce}\n{body_text}\n".encode("utf-8")
    public_key = _load_public_key(public_key_pem, "WeChat Pay platform public key")
    try:
        public_key.verify(
            _decode_base64(signature, "WeChat Pay signature"),
            message,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except InvalidSignature as exc:
        raise PaymentSignatureError("invalid WeChat Pay signature") from exc


def decrypt_wechat_resource(resource: Mapping[str, Any], api_v3_key: str) -> dict[str, Any]:
    ciphertext = _decode_base64(str(resource.get("ciphertext") or ""), "WeChat Pay ciphertext")
    nonce = str(resource.get("nonce") or "").encode("utf-8")
    associated_data = str(resource.get("associated_data") or "").encode("utf-8")
    try:
        plaintext = AESGCM(api_v3_key.encode("utf-8")).decrypt(nonce, ciphertext, associated_data)
        decoded = json.loads(plaintext.decode("utf-8"))
    except (InvalidTag, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise PaymentSignatureError("invalid WeChat Pay encrypted resource") from exc
    if not isinstance(decoded, dict):
        raise PaymentSignatureError("invalid WeChat Pay encrypted resource")
    return decoded


def normalize_wechat_notification(
    raw_body: bytes,
    headers: Mapping[str, str],
    settings: Settings,
) -> dict[str, Any]:
    verify_wechat_signature(raw_body, headers, settings)
    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PaymentSignatureError("invalid WeChat Pay callback JSON") from exc
    if not isinstance(payload, dict):
        raise PaymentSignatureError("invalid WeChat Pay callback JSON")
    resource = payload.get("resource")
    if not isinstance(resource, dict):
        raise PaymentSignatureError("missing WeChat Pay resource")
    api_v3_key = settings.wechat_pay_api_v3_key or ""
    if not api_v3_key:
        raise PaymentSignatureError("missing WeChat Pay API v3 key")

    decrypted = decrypt_wechat_resource(resource, api_v3_key)
    provider_trade_no = str(decrypted.get("out_trade_no") or "").strip()
    transaction_id = str(decrypted.get("transaction_id") or "").strip()
    trade_state = str(decrypted.get("trade_state") or "").strip()
    amount = decrypted.get("amount") or {}
    if not isinstance(amount, dict):
        amount = {}
    event_id = str(payload.get("id") or "").strip() or transaction_id or provider_trade_no
    return {
        "provider": "wechat",
        "event_id": event_id,
        "event_type": trade_state or str(payload.get("event_type") or "unknown"),
        "provider_trade_no": provider_trade_no or None,
        "transaction_id": transaction_id or None,
        "status": "paid" if trade_state == "SUCCESS" else "pending",
        "paid_at": decrypted.get("success_time"),
        "amount_cents": amount.get("total"),
        "payload": {"event": payload, "resource": decrypted},
    }
