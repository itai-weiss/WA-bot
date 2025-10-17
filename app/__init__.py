from app.config import get_settings  # noqa: F401
from utils.logging import setup_logging

setup_logging()

__all__ = ["get_settings", "setup_logging"]
