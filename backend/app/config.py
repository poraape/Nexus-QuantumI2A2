"""Application configuration using environment variables."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AnyUrl, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central application settings."""

    app_name: str = Field(default="Nexus Quantum Backend")
    environment: str = Field(default="development")

    backend_host: str = Field(default="0.0.0.0")
    backend_port: int = Field(default=8000)

    allowed_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    postgres_user: str = Field(default="postgres")
    postgres_password: str = Field(default="postgres")
    postgres_host: str = Field(default="localhost")
    postgres_port: int = Field(default=5432)
    postgres_db: str = Field(default="nexus_quantum")

    redis_url: AnyUrl = Field(default="redis://localhost:6379/0")

    storage_path: Path = Field(default=Path("./backend/storage"))

    webhook_timeout_seconds: float = Field(default=5.0)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""

    settings = Settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()
