"""
Microsoft Foundry Direct Model Client

Uses the OpenAI SDK against the Azure OpenAI-compatible endpoint.

Endpoint pattern:
    https://<resource>.openai.azure.com/openai/v1/

Auth:
    ManagedIdentityCredential → token used as api_key
    Scope: https://cognitiveservices.azure.com/.default
"""

import logging

from azure.identity import ManagedIdentityCredential
from openai import OpenAI

from config import settings

logger = logging.getLogger(__name__)

FOUNDRY_AUTH_SCOPE = "https://cognitiveservices.azure.com/.default"

_credential = None


def validate_config() -> list[str]:
    """Check that required env vars exist. Returns list of missing var names."""
    return settings.validate()


def _get_credential():
    """Get Azure credential via User-Assigned Managed Identity."""
    if not settings.managed_identity_client_id:
        raise ValueError("MANAGED_IDENTITY_CLIENT_ID environment variable is required")
    return ManagedIdentityCredential(client_id=settings.managed_identity_client_id)


def _get_token() -> str:
    global _credential
    if _credential is None:
        _credential = _get_credential()
    token = _credential.get_token(FOUNDRY_AUTH_SCOPE)
    return token.token


def _get_client() -> OpenAI:
    """Build OpenAI client with MSI token and Foundry endpoint."""
    if not settings.foundry_endpoint:
        raise ValueError("FOUNDRY_ENDPOINT environment variable is required")
    return OpenAI(
        base_url=settings.foundry_endpoint,
        api_key=_get_token(),
    )


def complete(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 1000,
) -> str:
    """
    Call Foundry model with chat messages, return assistant response text.
    """
    client = _get_client()

    completion = client.chat.completions.create(
        model=settings.foundry_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    return completion.choices[0].message.content
