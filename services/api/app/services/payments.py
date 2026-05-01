import hashlib
import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import IdempotencyKey, PaymentEvent, WalletRechargeOrder
from app.services.audit import record_audit
from app.services.wallets import credit_wallet_once, get_or_create_wallet

FINAL_ORDER_STATUSES = {"paid", "failed", "expired", "cancelled", "refunded"}
ALLOWED_ORDER_TRANSITIONS = {
    "created": {"pending", "paid", "failed", "expired", "cancelled"},
    "pending": {"paid", "failed", "expired", "cancelled"},
    "paid": {"refunded"},
    "failed": set(),
    "expired": set(),
    "cancelled": set(),
    "refunded": set(),
}


class PaymentError(ValueError):
    status_code = 400
    code = "PAYMENT_ERROR"


class IdempotencyConflict(PaymentError):
    status_code = 409
    code = "IDEMPOTENCY_CONFLICT"


class PaymentStateError(PaymentError):
    status_code = 409
    code = "PAYMENT_STATE_ERROR"


class PaymentValidationError(PaymentError):
    status_code = 409
    code = "PAYMENT_VALIDATION_ERROR"


def request_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def assert_order_transition(current: str, target: str) -> None:
    if current == target:
        return
    if target not in ALLOWED_ORDER_TRANSITIONS.get(current, set()):
        raise PaymentStateError(f"cannot transition recharge order from {current} to {target}")


def make_provider_trade_no(order_id: uuid.UUID) -> str:
    return f"xl_{order_id.hex}"


def _parse_paid_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                parsed = datetime.strptime(raw, fmt)
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
            except ValueError:
                continue
    return datetime.now(tz=UTC)


async def create_recharge_order(
    session: AsyncSession,
    *,
    owner_type: str,
    owner_id: uuid.UUID,
    provider: str,
    amount_cents: int,
    credit_amount: Decimal,
    currency: str,
    idempotency_key: str,
    metadata: dict[str, Any] | None = None,
) -> WalletRechargeOrder:
    normalized_provider = provider.strip().lower()
    normalized_key = idempotency_key.strip()
    payload_for_hash = {
        "owner_type": owner_type,
        "owner_id": str(owner_id),
        "provider": normalized_provider,
        "amount_cents": amount_cents,
        "credit_amount": str(credit_amount),
        "currency": currency,
        "metadata": metadata or {},
    }
    fingerprint = request_hash(payload_for_hash)

    async with session.begin():
        idem = await session.scalar(
            select(IdempotencyKey).where(
                IdempotencyKey.scope == "wallet_recharge",
                IdempotencyKey.key == normalized_key,
            )
        )
        if idem:
            if idem.request_hash != fingerprint:
                raise IdempotencyConflict("idempotency key was already used with a different request")
            order_id = (idem.response_payload or {}).get("order_id")
            if order_id:
                existing = await session.get(WalletRechargeOrder, uuid.UUID(order_id))
                if existing:
                    return existing
            existing = await session.scalar(
                select(WalletRechargeOrder).where(
                    WalletRechargeOrder.idempotency_key == normalized_key
                )
            )
            if existing:
                return existing

        wallet = await get_or_create_wallet(
            session,
            owner_type=owner_type,
            owner_id=owner_id,
            currency=currency,
        )
        order_id = uuid.uuid4()
        order = WalletRechargeOrder(
            id=order_id,
            wallet_id=wallet.id,
            provider=normalized_provider,
            provider_trade_no=make_provider_trade_no(order_id),
            idempotency_key=normalized_key,
            status="pending",
            amount_cents=amount_cents,
            credit_amount=credit_amount,
            currency=currency,
            payload={
                "metadata": metadata or {},
                "provider_trade_no": make_provider_trade_no(order_id),
            },
        )
        session.add(order)
        session.add(
            IdempotencyKey(
                scope="wallet_recharge",
                key=normalized_key,
                request_hash=fingerprint,
                response_payload={"order_id": str(order.id)},
                status_code=201,
            )
        )
        await record_audit(
            session,
            action="wallet_recharge_order.created",
            resource_type="wallet_recharge_order",
            resource_id=str(order.id),
            payload={
                "wallet_id": str(wallet.id),
                "provider": normalized_provider,
                "amount_cents": amount_cents,
                "credit_amount": str(credit_amount),
            },
        )
        await session.flush()
        return order


async def mark_recharge_order_paid(
    session: AsyncSession,
    *,
    order: WalletRechargeOrder,
    provider_trade_no: str | None = None,
    paid_at: Any = None,
    payload: dict[str, Any] | None = None,
    actor_id: uuid.UUID | None = None,
    audit_action: str = "wallet_recharge_order.paid",
) -> bool:
    if order.status == "paid":
        await credit_wallet_once(
            session,
            wallet_id=order.wallet_id,
            source_type="wallet_recharge_order",
            source_id=str(order.id),
            amount_cents=order.amount_cents,
            credit_amount=order.credit_amount,
            payload=payload or {},
        )
        return False

    assert_order_transition(order.status, "paid")
    if provider_trade_no:
        order.provider_trade_no = provider_trade_no
    order.status = "paid"
    order.paid_at = _parse_paid_at(paid_at)
    order.payload = {
        **(order.payload or {}),
        "paid_payload": payload or {},
    }
    ledger_created = await credit_wallet_once(
        session,
        wallet_id=order.wallet_id,
        source_type="wallet_recharge_order",
        source_id=str(order.id),
        amount_cents=order.amount_cents,
        credit_amount=order.credit_amount,
        payload=payload or {},
    )
    await record_audit(
        session,
        actor_id=actor_id,
        action=audit_action,
        resource_type="wallet_recharge_order",
        resource_id=str(order.id),
        payload={
            "wallet_id": str(order.wallet_id),
            "provider": order.provider,
            "provider_trade_no": order.provider_trade_no,
            "ledger_created": ledger_created,
        },
    )
    return True


async def process_payment_webhook(
    session: AsyncSession,
    *,
    notification: dict[str, Any],
) -> dict[str, Any]:
    provider = str(notification["provider"]).strip().lower()
    event_id = str(notification["event_id"]).strip()
    provider_trade_no = notification.get("provider_trade_no")

    async with session.begin():
        existing_event = await session.scalar(
            select(PaymentEvent).where(
                PaymentEvent.provider == provider,
                PaymentEvent.event_id == event_id,
            )
        )
        if existing_event:
            order_id = (existing_event.payload or {}).get("order_id")
            return {
                "provider": provider,
                "event_id": event_id,
                "duplicate": True,
                "order_id": order_id,
                "status": "duplicate",
            }

        order = None
        if provider_trade_no:
            order = await session.scalar(
                select(WalletRechargeOrder)
                .where(
                    WalletRechargeOrder.provider == provider,
                    WalletRechargeOrder.provider_trade_no == provider_trade_no,
                )
                .with_for_update()
            )

        event_payload = notification.get("payload") or {}
        event = PaymentEvent(
            provider=provider,
            event_id=event_id,
            provider_trade_no=provider_trade_no,
            event_type=str(notification.get("event_type") or "unknown"),
            verified=True,
            payload={**event_payload, "order_id": str(order.id) if order else None},
        )
        session.add(event)

        if order is None:
            await record_audit(
                session,
                action="payment_webhook.order_missing",
                resource_type="payment_event",
                resource_id=event_id,
                payload={"provider": provider, "provider_trade_no": provider_trade_no},
            )
            return {
                "provider": provider,
                "event_id": event_id,
                "duplicate": False,
                "order_id": None,
                "status": "order_missing",
            }

        amount_cents = notification.get("amount_cents")
        if amount_cents is not None and int(amount_cents) != order.amount_cents:
            raise PaymentValidationError("payment webhook amount does not match order")

        if notification.get("status") == "paid":
            await mark_recharge_order_paid(
                session,
                order=order,
                provider_trade_no=provider_trade_no,
                paid_at=notification.get("paid_at"),
                payload=notification,
            )

        return {
            "provider": provider,
            "event_id": event_id,
            "duplicate": False,
            "order_id": order.id,
            "status": order.status,
        }


async def admin_makeup_recharge_order(
    session: AsyncSession,
    *,
    order_id: uuid.UUID,
    reason: str,
    provider_trade_no: str | None = None,
    paid_at: datetime | None = None,
    actor_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> WalletRechargeOrder:
    async with session.begin():
        order = await session.scalar(
            select(WalletRechargeOrder).where(WalletRechargeOrder.id == order_id).with_for_update()
        )
        if order is None:
            raise PaymentValidationError("recharge order not found")
        await mark_recharge_order_paid(
            session,
            order=order,
            provider_trade_no=provider_trade_no or order.provider_trade_no,
            paid_at=paid_at,
            actor_id=actor_id,
            audit_action="wallet_recharge_order.makeup_paid",
            payload={"reason": reason, "metadata": metadata or {}},
        )
        return order
