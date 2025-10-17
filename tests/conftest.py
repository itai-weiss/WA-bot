from __future__ import annotations

import os
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Generator

import pytest


@pytest.fixture(scope="session", autouse=True)
def configure_env() -> Generator[None, None, None]:
    os.environ.setdefault("WA_PHONE_NUMBER_ID", "123456789")
    os.environ.setdefault("WA_BUSINESS_ACCOUNT_ID", "987654321")
    os.environ.setdefault("WA_ACCESS_TOKEN", "test-token")
    os.environ.setdefault("OWNER_WA_ID", "owner-wa-id")
    os.environ.setdefault("VERIFY_TOKEN", "verify-token")
    os.environ.setdefault("BASE_URL", "https://example.com")
    os.environ.setdefault("TZ", "Asia/Jerusalem")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
    os.environ.setdefault("CELERY_BROKER_URL", "memory://")
    os.environ.setdefault("CELERY_RESULT_BACKEND", "memory://")
    os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
    os.environ.setdefault("X_ADMIN_TOKEN", "admin-token")

    from app.config import get_settings
    from app.db import reset_db_state

    reset_db_state()

    reset_db_state()
    get_settings.cache_clear()
    get_settings()

    yield

    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def fresh_database() -> Generator[None, None, None]:
    from app.db import create_all, drop_all

    drop_all()
    create_all()
    yield
    drop_all()


class DummyCelery:
    def __init__(self) -> None:
        self.sent = []
        self.control = SimpleNamespace(
            revoke=lambda task_id, terminate=False: self.sent.append(
                ("revoke", task_id)
            )
        )

    def send_task(self, name: str, args=None, kwargs=None, eta=None):
        task_id = f"task-{len(self.sent)}"
        self.sent.append(("send", name, args, kwargs, eta, task_id))
        return SimpleNamespace(id=task_id)


@pytest.fixture
def celery_stub(monkeypatch) -> DummyCelery:
    from app import scheduler

    dummy = DummyCelery()
    monkeypatch.setattr(scheduler, "_get_celery", lambda: dummy)
    return dummy


class DummyWAClient:
    def __init__(self, sent):
        self.sent = sent

    def send_text_message(self, **kwargs):
        self.sent.append(("text", kwargs))
        return {"messages": [{"id": "msg"}]}

    def send_interactive_message(self, **kwargs):
        self.sent.append(("interactive", kwargs))
        return {"messages": [{"id": "msg"}]}

    def send_template(self, **kwargs):
        self.sent.append(("template", kwargs))
        return {"messages": [{"id": "msg"}]}

    def close(self):
        pass


@pytest.fixture
def client_spy(monkeypatch):
    sent = []

    @contextmanager
    def factory():
        client = DummyWAClient(sent)
        yield client

    monkeypatch.setattr("app.main.whatsapp_client", factory)
    return sent
