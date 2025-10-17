# WhatsApp Cloud Scheduler Bot

Production-ready FastAPI + Celery bot that schedules WhatsApp Cloud API posts to groups and forwards replies to the owner with a private reply shortcut.

## Features
- Natural language scheduling (`schedule "..." to <alias> at <time>`).
- Celery ETA scheduling with Redis broker/result backend.
- Reply correlation window (default 12h) that forwards group replies to the owner with a direct “Open chat” button.
- Structlog JSON logging, pydantic-settings configuration, and SQLite persistence via SQLAlchemy.
- Dockerized services (`api`, `worker`, `redis`) and Makefile helpers.
- Comprehensive pytest suite with httpx ASGI client and freezegun.

## Architecture
- **FastAPI** serves webhook endpoints and admin APIs.
- **Celery + Redis** handle delayed sends and periodic cleanup.
- **SQLite/SQLAlchemy** store jobs, group registry, reply correlations, and owner reply session state.
- **WhatsApp Cloud API** integration via `httpx` in `app/wa/`.

```
└── app/
    ├── main.py          # FastAPI app + webhook handlers
    ├── scheduler.py     # Job CRUD + Celery scheduling
    ├── workers.py       # Celery tasks (send, cleanup)
    ├── logic.py         # Correlation + owner session helpers
    ├── wa/              # WhatsApp HTTP client & payload builders
    └── …
```

## Requirements
- Python 3.11+
- Poetry (or use Docker)
- Redis 7+ (local or via docker-compose)
- WhatsApp Cloud API credentials (v19+)

## Configuration
Copy `.env.example` to `.env` and fill in your values:

```
cp .env.example .env
```

Key variables:

| Variable | Description |
| --- | --- |
| `WA_ACCESS_TOKEN` | Long-lived WhatsApp Cloud API token |
| `WA_PHONE_NUMBER_ID` | Business phone number ID |
| `WA_BUSINESS_ACCOUNT_ID` | Business account ID |
| `OWNER_WA_ID` | WhatsApp ID of the owner/operator |
| `VERIFY_TOKEN` | Token for webhook verification |
| `BASE_URL` | Public URL pointing to `/webhook/whatsapp` |
| `REDIS_URL` | Broker/result backend (`redis://redis:6379/0`) |
| `DATABASE_URL` | SQLAlchemy URL (default `sqlite:///./wa_bot.db`) |
| `X_ADMIN_TOKEN` | Token required for admin HTTP endpoints |

Optional tuning:
- `TZ` – default `Asia/Jerusalem`.
- `MESSAGE_WINDOW_HOURS` and `OWNER_REPLY_TIMEOUT_SECONDS` via settings class.

## Local Development

```bash
poetry install
poetry run uvicorn app.main:app --reload
poetry run celery -A app.workers.celery_app worker --loglevel=info
```

Use the Makefile:

```bash
make install
make lint
make test
make run
make worker
```

## Docker Compose

```bash
docker-compose up --build
```

Services:
- `api` → FastAPI (port `8000`)
- `worker` → Celery worker
- `redis` → Redis broker/result backend

## WhatsApp Cloud API Setup
1. Create or reuse a Meta app with WhatsApp product enabled.
2. Generate a permanent access token and business phone number ID.
3. Expose your local API (e.g., `ngrok http 8000`) or deploy publicly.
4. Set the webhook callback URL to `${BASE_URL}/webhook/whatsapp` in the Meta developer portal.
5. During verification, Meta will call `GET /webhook/whatsapp` with `hub.verify_token`; ensure it matches your `VERIFY_TOKEN`.
6. Add the bot number to the target groups and grant admin if needed.

## Command Flow
- Register group alias: `register group team 1203630xxx@g.us Team`
- Schedule: `schedule "Daily sync at 09:00" to team at today 08:55`
- List jobs: `list`
- Cancel job: `cancel 12`
- List registered groups: `groups`
- Remove group alias: `unregister group team`

When a scheduled message posts, any replies within the configured window trigger a forward to the owner containing the group/sender info plus a button linking to `https://wa.me/<E164>` so you can respond privately. If the WhatsApp 24h window is closed, the bot falls back to an `owner_notify` template (placeholder—fill with your approved template name/variables).

## API Endpoints
| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `GET` | `/healthz` | Liveness probe | None |
| `GET` | `/webhook/whatsapp` | Verification handshake | Meta |
| `POST` | `/webhook/whatsapp` | Message events | Meta |
| `GET` | `/jobs` | List scheduled jobs | `X-Admin-Token` |
| `DELETE` | `/jobs/{id}` | Cancel job | `X-Admin-Token` |
| `GET` | `/groups` | List registered groups | `X-Admin-Token` |

Example admin call:

```bash
curl -H "X-Admin-Token: admin-token" http://localhost:8000/jobs
```

## Testing

```bash
make test
```

Tests cover:
- Command parsing edge cases.
- Owner DM scheduling workflow.
- Group reply forwarding with private chat button payloads.
- Date parsing with timezone handling.

## Deployment Notes
- Ensure Redis and database are persistent in production (swap SQLite for Postgres/MySQL if desired).
- Rotate `WA_ACCESS_TOKEN` periodically and store securely (e.g. Vault, Kubernetes secret).
- Configure Celery workers with appropriate concurrency and monitoring (Flower, Prometheus).
- Serve FastAPI behind HTTPS for webhook security (nginx, Traefik, etc.).
