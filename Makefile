.PHONY: install lint format test run worker beat up build docker

install:
	poetry install

lint:
	poetry run ruff check .
	poetry run black --check .
	poetry run isort --check-only .
	poetry run mypy app utils

format:
	poetry run ruff check . --fix
	poetry run isort .
	poetry run black .

test:
	poetry run pytest

run:
	poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

worker:
	poetry run celery -A app.workers.celery_app worker --loglevel=info

beat:
	poetry run celery -A app.workers.celery_app beat --loglevel=info

docker-up:
	docker-compose up --build

docker-down:
	docker-compose down -v
