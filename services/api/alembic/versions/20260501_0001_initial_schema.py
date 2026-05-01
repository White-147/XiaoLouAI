"""initial production schema

Revision ID: 20260501_0001
Revises:
Create Date: 2026-05-01 00:00:00+00:00
"""

from alembic import op
import sqlalchemy as sa

from app.models import Base

revision = "20260501_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = Base.metadata.schema
    if schema:
        op.execute(sa.text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
