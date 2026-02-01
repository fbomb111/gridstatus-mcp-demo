"""Centralized configuration — all env vars in one place."""

import os


class Settings:
    """Application settings loaded from environment variables."""

    def __init__(self):
        self.cors_origins: list[str] = os.getenv("CORS_ORIGINS", "*").split(",")
        self.git_sha: str = os.getenv("GIT_SHA", "unknown")
        self.environment: str = os.getenv("ENVIRONMENT", "local")

        # Azure Foundry
        self.foundry_endpoint: str | None = os.getenv("FOUNDRY_ENDPOINT")
        self.foundry_model: str = os.getenv("FOUNDRY_MODEL_DEPLOYMENT", "gpt-4.1")
        self.managed_identity_client_id: str | None = os.getenv("MANAGED_IDENTITY_CLIENT_ID")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def validate(self) -> list[str]:
        """Return list of missing required env vars for AI features."""
        required = ["FOUNDRY_ENDPOINT", "MANAGED_IDENTITY_CLIENT_ID"]
        return [var for var in required if not getattr(self, _attr_for(var))]


settings = Settings()


def _attr_for(env_var: str) -> str:
    """Map env var name to Settings attribute name."""
    mapping = {
        "FOUNDRY_ENDPOINT": "foundry_endpoint",
        "MANAGED_IDENTITY_CLIENT_ID": "managed_identity_client_id",
    }
    return mapping.get(env_var, env_var.lower())
