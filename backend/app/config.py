"""Application configuration using environment variables."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseSettings, Field, validator


class Settings(BaseSettings):
    api_base_path: str = Field("/api", env="API_BASE_PATH")

    # Core infrastructure
    database_url: str = Field("sqlite:///backend_data/app.db", env="DATABASE_URL")
    redis_url: str = Field("redis://localhost:6379/0", env="REDIS_URL")
    storage_path: Path = Field(Path("backend_storage"), env="STORAGE_PATH")
    webhook_timeout_seconds: int = Field(10, env="WEBHOOK_TIMEOUT_SECONDS")

    # Observability / telemetry
    telemetry_service_name: str = Field("nexus-backend", env="TELEMETRY_SERVICE_NAME")
    telemetry_environment: str = Field("development", env="TELEMETRY_ENVIRONMENT")
    telemetry_enabled: bool = Field(True, env="TELEMETRY_ENABLED")
    telemetry_export_interval_ms: int = Field(15000, env="TELEMETRY_EXPORT_INTERVAL_MS")
    otel_exporter_otlp_endpoint: str = Field("http://localhost:4318", env="OTEL_EXPORTER_OTLP_ENDPOINT")
    otel_exporter_otlp_headers: Optional[str] = Field(None, env="OTEL_EXPORTER_OTLP_HEADERS")

    # OAuth2 / JWT configuration
    jwt_secret_key: str = Field(..., env="JWT_SECRET_KEY")
    jwt_algorithm: str = Field("HS256", env="JWT_ALGORITHM")
    jwt_expires_minutes: int = Field(30, env="JWT_EXPIRES_MINUTES")
    refresh_token_ttl_hours: int = Field(24, env="REFRESH_TOKEN_TTL_HOURS")

    access_token_cookie_name: str = Field("nexus_session", env="ACCESS_TOKEN_COOKIE_NAME")
    refresh_token_cookie_name: str = Field("nexus_session_refresh", env="REFRESH_TOKEN_COOKIE_NAME")
    cookie_domain: Optional[str] = Field(None, env="COOKIE_DOMAIN")
    cookie_secure: bool = Field(True, env="COOKIE_SECURE")
    cookie_samesite: str = Field("none", env="COOKIE_SAMESITE")

    # PKCE clients (comma separated list of allowed client ids)
    oauth_client_ids: list[str] = Field(["nexus-spa"], env="OAUTH_CLIENT_IDS")

    # CORS configuration
    cors_allow_origins: list[str] = Field(
        ["https://app.nexus-i2a2.local", "https://*.trusted.corp"],
        env="CORS_ALLOW_ORIGINS",
    )

    rate_limit_requests: int = Field(120, env="RATE_LIMIT_REQUESTS")
    rate_limit_window_seconds: int = Field(60, env="RATE_LIMIT_WINDOW_SECONDS")

    # Paths
    data_dir: Path = Field(Path("backend_data"), env="BACKEND_DATA_DIR")
    audit_log_name: str = Field("audit_log.jsonl", env="AUDIT_LOG_NAME")
    vault_name: str = Field("vault.enc", env="VAULT_NAME")
    refresh_token_store: str = Field("refresh_tokens.enc", env="REFRESH_TOKEN_STORE")
    authorization_code_store: str = Field("authorization_codes.json", env="AUTH_CODE_STORE")

    # SPA session proxy configuration
    spa_username: str = Field(..., env="SPA_AUTH_USERNAME")
    spa_password: str = Field(..., env="SPA_AUTH_PASSWORD")
    spa_client_id: str = Field("nexus-spa", env="SPA_AUTH_CLIENT_ID")
    spa_session_store: str = Field("spa_session.enc", env="SPA_SESSION_STORE")

    # Secret management
    kms_master_key: str = Field(..., env="KMS_MASTER_KEY")
    gemini_api_key_name: str = Field("gemini_api_key", env="GEMINI_API_KEY_NAME")

    # LLM configuration
    llm_model: str = Field("gemini-2.0-flash", env="LLM_MODEL")
    llm_endpoint: Optional[str] = Field(None, env="LLM_ENDPOINT")

    # OCR configuration
    ocr_language: str = Field("por", env="OCR_LANGUAGE")

    # Secure bucket (S3/MinIO)
    bucket_endpoint_url: Optional[str] = Field(None, env="BUCKET_ENDPOINT_URL")
    bucket_name: Optional[str] = Field(None, env="BUCKET_NAME")
    bucket_region: Optional[str] = Field(None, env="BUCKET_REGION")
    bucket_access_key: Optional[str] = Field(None, env="BUCKET_ACCESS_KEY")
    bucket_secret_key: Optional[str] = Field(None, env="BUCKET_SECRET_KEY")

    # Default user bootstrap
    default_username: Optional[str] = Field(None, env="DEFAULT_ADMIN_USERNAME")
    default_password: Optional[str] = Field(None, env="DEFAULT_ADMIN_PASSWORD")

    class Config:
        env_file = ".env"
        case_sensitive = False

    @validator("oauth_client_ids", pre=True)
    def split_client_ids(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @validator("cors_allow_origins", pre=True)
    def split_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @validator("cookie_samesite", pre=True)
    def normalize_samesite(cls, value: str) -> str:
        if not value:
            return "lax"
        normalized = value.strip().lower()
        allowed = {"lax", "none", "strict"}
        if normalized not in allowed:
            raise ValueError("COOKIE_SAMESITE must be one of: lax, none, strict")
        return normalized


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings
