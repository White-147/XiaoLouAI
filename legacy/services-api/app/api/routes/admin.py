from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import AuditLog, WalletRechargeOrder
from app.schemas import AdminMakeupRechargeRequest, AuditLogRead, WalletRechargeOrderRead
from app.services.payments import PaymentError, admin_makeup_recharge_order

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _payment_http_error(exc: PaymentError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": str(exc)},
    )


@router.post(
    "/payments/recharge-orders/{order_id}/make-up",
    response_model=WalletRechargeOrderRead,
)
async def make_up_recharge_order(
    order_id: UUID,
    payload: AdminMakeupRechargeRequest,
    x_admin_actor_id: UUID | None = Header(default=None, alias="X-Admin-Actor-Id"),
    session: AsyncSession = Depends(get_session),
) -> WalletRechargeOrder:
    try:
        return await admin_makeup_recharge_order(
            session,
            order_id=order_id,
            reason=payload.reason,
            provider_trade_no=payload.provider_trade_no,
            paid_at=payload.paid_at,
            actor_id=x_admin_actor_id,
            metadata=payload.metadata,
        )
    except PaymentError as exc:
        raise _payment_http_error(exc) from exc


@router.get("/audit-logs", response_model=list[AuditLogRead])
async def list_audit_logs(
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
) -> list[AuditLog]:
    capped_limit = max(1, min(limit, 500))
    result = await session.scalars(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(capped_limit)
    )
    return list(result)
