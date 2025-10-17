from __future__ import annotations

from typing import Any, Dict, Optional

import httpx
import structlog

from app.config import get_settings
from app.wa import payloads

logger = structlog.get_logger(__name__)

GRAPH_BASE_URL = "https://graph.facebook.com"
GRAPH_VERSION = "v19.0"


class WhatsAppClient:
    """Simple wrapper around the WhatsApp Cloud API."""

    def __init__(
        self,
        *,
        access_token: str | None = None,
        phone_number_id: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        settings = get_settings()
        self.phone_number_id = phone_number_id or settings.wa_phone_number_id
        self.access_token = access_token or settings.wa_access_token
        self.timeout = timeout

        base_url = f"{GRAPH_BASE_URL}/{GRAPH_VERSION}/{self.phone_number_id}"
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
        )

    def close(self) -> None:
        self._client.close()

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        logger.info("wa.request", path=path, payload=payload)
        response = self._client.post(path, json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "wa.error",
                path=path,
                status_code=exc.response.status_code,
                content=exc.response.text,
            )
            raise
        return response.json()

    def send_text_message(
        self,
        *,
        to: str,
        text: str,
        recipient_type: str = "individual",
        preview_url: bool = False,
        context_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = payloads.text_message(
            to=to,
            text=text,
            recipient_type=recipient_type,
            preview_url=preview_url,
            context_message_id=context_message_id,
        )
        return self._post("/messages", payload)

    def send_interactive_message(
        self,
        *,
        to: str,
        header: Optional[str],
        body: str,
        buttons: list[dict[str, Any]],
        recipient_type: str = "individual",
    ) -> Dict[str, Any]:
        payload = payloads.interactive_buttons(
            to=to,
            header=header,
            body=body,
            buttons=buttons,
            recipient_type=recipient_type,
        )
        return self._post("/messages", payload)

    def send_template(
        self,
        *,
        to: str,
        template_name: str,
        language: str = "en_US",
        components: Optional[list[dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        payload = payloads.template_message(
            to=to,
            template_name=template_name,
            language=language,
            components=components or [],
        )
        return self._post("/messages", payload)

    def mark_as_read(self, *, message_id: str) -> Dict[str, Any]:
        payload = payloads.mark_as_read(message_id=message_id)
        return self._post("/messages", payload)


def get_client() -> WhatsAppClient:
    """Return a singleton-like client instance."""
    return WhatsAppClient()
