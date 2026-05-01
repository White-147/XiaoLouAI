import base64
import json
from datetime import UTC, datetime

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.payment_signatures import (
    build_alipay_sign_content,
    normalize_alipay_notification,
    normalize_wechat_notification,
)
from app.services.payments import PaymentStateError, assert_order_transition, request_hash


def _rsa_pair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


def test_request_hash_is_stable() -> None:
    left = {"amount_cents": 100, "metadata": {"b": 2, "a": 1}}
    right = {"metadata": {"a": 1, "b": 2}, "amount_cents": 100}
    assert request_hash(left) == request_hash(right)


def test_order_state_machine_rejects_invalid_transition() -> None:
    with pytest.raises(PaymentStateError):
        assert_order_transition("paid", "failed")


def test_alipay_notification_signature_and_normalization() -> None:
    private_pem, public_pem = _rsa_pair()
    params = {
        "app_id": "app-1",
        "seller_id": "seller-1",
        "notify_id": "notify-1",
        "notify_time": datetime.now(tz=UTC).strftime("%Y-%m-%d %H:%M:%S"),
        "out_trade_no": "xl_order",
        "trade_no": "ali-trade-1",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "12.34",
    }
    private_key = serialization.load_pem_private_key(private_pem.encode("utf-8"), password=None)
    signature = private_key.sign(
        build_alipay_sign_content(params).encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    params["sign"] = base64.b64encode(signature).decode("utf-8")
    params["sign_type"] = "RSA2"

    notification = normalize_alipay_notification(
        params,
        Settings(
            alipay_public_key=public_pem,
            alipay_app_id="app-1",
            alipay_seller_id="seller-1",
        ),
    )

    assert notification["provider"] == "alipay"
    assert notification["status"] == "paid"
    assert notification["provider_trade_no"] == "xl_order"
    assert notification["amount_cents"] == 1234


def test_wechat_signature_decrypt_and_normalization() -> None:
    private_pem, public_pem = _rsa_pair()
    api_v3_key = "0123456789abcdef0123456789abcdef"
    resource_payload = {
        "out_trade_no": "xl_order",
        "transaction_id": "wx-trade-1",
        "trade_state": "SUCCESS",
        "success_time": "2026-05-01T12:00:00+08:00",
        "amount": {"total": 1234, "currency": "CNY"},
    }
    nonce = "0123456789ab"
    associated_data = "transaction"
    ciphertext = AESGCM(api_v3_key.encode("utf-8")).encrypt(
        nonce.encode("utf-8"),
        json.dumps(resource_payload, separators=(",", ":")).encode("utf-8"),
        associated_data.encode("utf-8"),
    )
    payload = {
        "id": "evt-1",
        "event_type": "TRANSACTION.SUCCESS",
        "resource": {
            "algorithm": "AEAD_AES_256_GCM",
            "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
            "nonce": nonce,
            "associated_data": associated_data,
        },
    }
    raw_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(datetime.now(tz=UTC).timestamp()))
    header_nonce = "nonce-1"
    message = f"{timestamp}\n{header_nonce}\n{raw_body.decode('utf-8')}\n".encode("utf-8")
    private_key = serialization.load_pem_private_key(private_pem.encode("utf-8"), password=None)
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())

    notification = normalize_wechat_notification(
        raw_body,
        {
            "Wechatpay-Timestamp": timestamp,
            "Wechatpay-Nonce": header_nonce,
            "Wechatpay-Signature": base64.b64encode(signature).decode("utf-8"),
        },
        Settings(
            wechat_pay_platform_public_key=public_pem,
            wechat_pay_api_v3_key=api_v3_key,
        ),
    )

    assert notification["provider"] == "wechat"
    assert notification["event_id"] == "evt-1"
    assert notification["status"] == "paid"
    assert notification["amount_cents"] == 1234


def test_payment_routes_are_registered() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/payments/recharge-orders" in paths
    assert "/api/admin/payments/recharge-orders/{order_id}/make-up" in paths
