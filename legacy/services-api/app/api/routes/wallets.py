from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Wallet
from app.schemas import WalletRead

router = APIRouter(prefix="/api/wallets", tags=["wallets"])


@router.get("/{wallet_id}", response_model=WalletRead)
async def get_wallet(wallet_id: UUID, session: AsyncSession = Depends(get_session)) -> Wallet:
    wallet = await session.get(Wallet, wallet_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="wallet not found")
    return wallet
