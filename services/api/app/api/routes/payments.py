from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import WalletRechargeOrder
from app.schemas import (
    PaymentWebhookResult,
    WalletRechargeCreate,
    WalletRechargeOrderRead,
)
from app.services.payment_signatures import (
    PaymentSignatureError,
    normalize_alipay_notification,
    normalize_wechat_notification,
)
from app.services.payments import PaymentError, create_recharge_order, process_payment_webhook

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _payment_http_error(exc: PaymentError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": str(exc)},
    )


@router.post(
    "/recharge-orders",
    response_model=WalletRechargeOrderRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_wallet_recharge_order(
    payload: WalletRechargeCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_session),
) -> WalletRechargeOrder:
    key = (payload.idempotency_key or idempotency_key or str(uuid4())).strip()
    try:
        return await create_recharge_order(
            session,
            owner_type=payload.owner_type,
            owner_id=payload.owner_id,
            provider=payload.provider,
            amount_cents=payload.amount_cents,
            credit_amount=payload.credit_amount,
            currency=payload.currency,
            idempotency_key=key,
            metadata=payload.metadata,
        )
    except PaymentError as exc:
        raise _payment_http_error(exc) from exc


@router.get("/recharge-orders/{order_id}", response_model=WalletRechargeOrderRead)
async def get_wallet_recharge_order(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> WalletRechargeOrder:
    order = await session.get(WalletRechargeOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="recharge order not found")
    return order


@router.post("/webhooks/alipay", include_in_schema=False)
async def alipay_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Response:
    form = await request.form()
    params = {key: str(value) for key, value in form.multi_items()}
    try:
        notification = normalize_alipay_notification(params, get_settings())
        await process_payment_webhook(session, notification=notification)
    except PaymentSignatureError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PaymentError as exc:
        raise _payment_http_error(exc) from exc
    return Response("success", media_type="text/plain")


@router.post(
    "/webhooks/wechat",
    response_model=PaymentWebhookResult,
    include_in_schema=False,
)
async def wechat_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    raw_body = await request.body()
    try:
        notification = normalize_wechat_notification(raw_body, request.headers, get_settings())
        return await process_payment_webhook(session, notification=notification)
    except PaymentSignatureError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PaymentError as exc:
        raise _payment_http_error(exc) from exc
