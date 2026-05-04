from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OutboxEvent, Wallet, WalletLedger


async def get_or_create_wallet(
    session: AsyncSession,
    *,
    owner_type: str,
    owner_id: UUID,
    currency: str = "CNY",
) -> Wallet:
    wallet_id = uuid4()
    insert_result = await session.execute(
        insert(Wallet)
        .values(
            id=wallet_id,
            owner_type=owner_type,
            owner_id=owner_id,
            balance_cents=0,
            credit_balance=Decimal("0"),
            currency=currency,
            payload={
                "ownerType": owner_type,
                "ownerId": str(owner_id),
                "currency": currency,
                "status": "active",
            },
        )
        .on_conflict_do_nothing(
            index_elements=[Wallet.owner_type, Wallet.owner_id],
        )
        .returning(Wallet.id)
    )
    inserted_id = insert_result.scalar_one_or_none()
    if inserted_id:
        wallet = await session.get(Wallet, inserted_id)
        if wallet:
            return wallet

    wallet = await session.scalar(
        select(Wallet).where(Wallet.owner_type == owner_type, Wallet.owner_id == owner_id)
    )
    if wallet is None:
        raise ValueError("wallet not found after create")
    return wallet


async def credit_wallet_once(
    session: AsyncSession,
    *,
    wallet_id: UUID,
    source_type: str,
    source_id: str,
    amount_cents: int,
    credit_amount: Decimal,
    payload: dict[str, Any] | None = None,
) -> bool:
    wallet = await session.scalar(select(Wallet).where(Wallet.id == wallet_id).with_for_update())
    if wallet is None:
        raise ValueError("wallet not found")

    existing = await session.scalar(
        select(WalletLedger).where(
            WalletLedger.wallet_id == wallet_id,
            WalletLedger.source_type == source_type,
            WalletLedger.source_id == source_id,
        )
    )
    if existing:
        return False

    wallet.balance_cents = (wallet.balance_cents or 0) + amount_cents
    wallet.credit_balance = (wallet.credit_balance or Decimal("0")) + credit_amount

    ledger = WalletLedger(
        wallet_id=wallet.id,
        entry_type="credit",
        amount_cents=amount_cents,
        credit_amount=credit_amount,
        source_type=source_type,
        source_id=source_id,
        payload=payload or {},
    )
    session.add(ledger)
    session.add(
        OutboxEvent(
            aggregate_type="wallet",
            aggregate_id=str(wallet.id),
            event_type="wallet.credited",
            payload={
                "wallet_id": str(wallet.id),
                "source_type": source_type,
                "source_id": source_id,
                "amount_cents": amount_cents,
                "credit_amount": str(credit_amount),
            },
        )
    )
    return True
