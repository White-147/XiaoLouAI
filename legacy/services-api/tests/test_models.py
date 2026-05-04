from app.models import Base


def test_required_tables_exist() -> None:
    required = {
        "users",
        "projects",
        "assets",
        "tasks",
        "wallets",
        "wallet_ledger",
        "wallet_recharge_orders",
        "payment_events",
        "idempotency_keys",
        "video_replace_jobs",
        "provider_jobs",
        "outbox_events",
        "audit_logs",
    }
    assert required.issubset({table.name for table in Base.metadata.tables.values()})


def test_payment_uniqueness_constraints_exist() -> None:
    tables = {table.name: table for table in Base.metadata.tables.values()}
    orders = tables["wallet_recharge_orders"]
    events = tables["payment_events"]
    order_constraints = {constraint.name for constraint in orders.constraints}
    event_constraints = {constraint.name for constraint in events.constraints}

    assert "uq_wallet_recharge_idempotency_key" in order_constraints
    assert "uq_wallet_recharge_provider_trade" in order_constraints
    assert "uq_payment_events_provider_event" in event_constraints


def test_video_replace_job_maps_uuid_job_id_column() -> None:
    table = Base.metadata.tables["video_replace_jobs"]
    assert "job_id" in table.columns
    assert "id" not in table.columns
    assert table.columns["job_id"].primary_key
