from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseSettings, Field, validator


class Settings(BaseSettings):
    api_base_path: str = Field('/api', env='API_BASE_PATH')

    # OAuth2 / JWT configuration
    jwt_secret_key: str = Field(..., env='JWT_SECRET_KEY')
    jwt_algorithm: str = Field('HS256', env='JWT_ALGORITHM')
    jwt_expires_minutes: int = Field(30, env='JWT_EXPIRES_MINUTES')
    refresh_token_ttl_hours: int = Field(24, env='REFRESH_TOKEN_TTL_HOURS')

    # PKCE clients (comma separated list of allowed client ids)
    oauth_client_ids: list[str] = Field(['nexus-spa'], env='OAUTH_CLIENT_IDS')

    # Paths
    data_dir: Path = Field(Path('backend_data'), env='BACKEND_DATA_DIR')
    audit_log_name: str = Field('audit_log.jsonl', env='AUDIT_LOG_NAME')
    vault_name: str = Field('vault.enc', env='VAULT_NAME')
    refresh_token_store: str = Field('refresh_tokens.enc', env='REFRESH_TOKEN_STORE')
    authorization_code_store: str = Field('authorization_codes.json', env='AUTH_CODE_STORE')

    # Secret management
    kms_master_key: str = Field(..., env='KMS_MASTER_KEY')
    gemini_api_key_name: str = Field('gemini_api_key', env='GEMINI_API_KEY_NAME')

    # LLM configuration
    llm_model: str = Field('gemini-2.0-flash', env='LLM_MODEL')
    llm_endpoint: Optional[str] = Field(None, env='LLM_ENDPOINT')

    # OCR configuration
    ocr_language: str = Field('por', env='OCR_LANGUAGE')

    # Secure bucket (S3/MinIO)
    bucket_endpoint_url: Optional[str] = Field(None, env='BUCKET_ENDPOINT_URL')
    bucket_name: Optional[str] = Field(None, env='BUCKET_NAME')
    bucket_region: Optional[str] = Field(None, env='BUCKET_REGION')
    bucket_access_key: Optional[str] = Field(None, env='BUCKET_ACCESS_KEY')
    bucket_secret_key: Optional[str] = Field(None, env='BUCKET_SECRET_KEY')

    # Default user bootstrap
    default_username: Optional[str] = Field(None, env='DEFAULT_ADMIN_USERNAME')
    default_password: Optional[str] = Field(None, env='DEFAULT_ADMIN_PASSWORD')

    class Config:
        env_file = '.env'
        case_sensitive = False

    @validator('oauth_client_ids', pre=True)
    def split_client_ids(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [v.strip() for v in value.split(',') if v.strip()]
        return value


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
