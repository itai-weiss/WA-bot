from __future__ import annotations

from typing import Any, Dict, Optional


def base_payload(to: str, recipient_type: str = "individual") -> Dict[str, Any]:
    return {
        "messaging_product": "whatsapp",
        "to": to,
        "recipient_type": recipient_type,
    }


def text_message(
    *,
    to: str,
    text: str,
    recipient_type: str = "individual",
    preview_url: bool = False,
    context_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    payload = base_payload(to, recipient_type)
    payload["type"] = "text"
    payload["text"] = {"body": text, "preview_url": preview_url}
    if context_message_id:
        payload["context"] = {"message_id": context_message_id}
    return payload


def interactive_buttons(
    *,
    to: str,
    body: str,
    buttons: list[dict[str, Any]],
    recipient_type: str = "individual",
    header: Optional[str] = None,
) -> Dict[str, Any]:
    payload = base_payload(to, recipient_type)
    payload["type"] = "interactive"
    interactive: Dict[str, Any] = {
        "type": "button",
        "body": {"text": body},
        "action": {"buttons": buttons},
    }
    if header:
        interactive["header"] = {"type": "text", "text": header}
    payload["interactive"] = interactive
    return payload


def template_message(
    *,
    to: str,
    template_name: str,
    language: str,
    components: list[dict[str, Any]],
) -> Dict[str, Any]:
    payload = base_payload(to)
    payload["type"] = "template"
    payload["template"] = {
        "name": template_name,
        "language": {"code": language},
        "components": components,
    }
    return payload


def mark_as_read(*, message_id: str) -> Dict[str, Any]:
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
    }
    return payload
