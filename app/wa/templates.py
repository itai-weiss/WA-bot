from __future__ import annotations

from typing import Any, Dict

from app.wa.client import WhatsAppClient


def owner_notify_template_components(
    *,
    group_name: str,
    sender_name: str,
    snippet: str,
    cta_url: str,
) -> list[dict[str, Any]]:
    """Return components for the owner_notify template."""
    return [
        {
            "type": "body",
            "parameters": [
                {"type": "text", "text": group_name},
                {"type": "text", "text": sender_name},
                {"type": "text", "text": snippet},
            ],
        },
        {
            "type": "button",
            "sub_type": "url",
            "index": "0",
            "parameters": [
                {"type": "text", "text": cta_url},
            ],
        },
    ]


def send_owner_notify(
    client: WhatsAppClient,
    *,
    to: str,
    group_name: str,
    sender_name: str,
    snippet: str,
    cta_url: str,
) -> None:
    components = owner_notify_template_components(
        group_name=group_name, sender_name=sender_name, snippet=snippet, cta_url=cta_url
    )
    client.send_template(
        to=to,
        template_name="owner_notify",
        language="en_US",
        components=components,
    )
