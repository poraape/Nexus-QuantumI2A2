from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import (
    AuthService,
    AuthorizationCodeStore,
    RefreshTokenStore,
    UserManager,
    get_current_user,
)
from .config import get_settings
from .services.audit import AuditLogger
from .services.crypto import EncryptedJsonStore, KMSClient, SecretVault
from .services.data_store import SensitiveDataStore
from .services.llm import LLMClient
from .services.masking import IdentifierMasker
from .services.ocr import OCRService
from .services.storage import SecureBucketClient

logger = logging.getLogger(__name__)


class AuthorizationRequest(BaseModel):
    username: str
    password: str
    code_challenge: str
    client_id: str = 'nexus-spa'


class RefreshRequest(BaseModel):
    refresh_token: str


class LLMGenerationRequest(BaseModel):
    prompt: str
    schema: Dict[str, Any]
    model: Optional[str] = None
    context_key: Optional[str] = Field(
        default=None,
        description='Identificador opcional para persistir o resultado de forma segura.'
    )


class ChatSessionRequest(BaseModel):
    system_instruction: str
    schema: Dict[str, Any]
    model: Optional[str] = None


class ChatMessageRequest(BaseModel):
    message: str


class SanitizeRequest(BaseModel):
    records: List[Dict[str, Any]]


class ChatSessionManager:
    def __init__(self) -> None:
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def create(self, payload: ChatSessionRequest, username: str) -> str:
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            'request': payload,
            'history': [],
            'owner': username,
        }
        return session_id

    def get(self, session_id: str, username: str) -> Dict[str, Any]:
        session = self.sessions.get(session_id)
        if not session or session['owner'] != username:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Sessão não encontrada.')
        return session


settings = get_settings()
kms = KMSClient(settings.kms_master_key)
vault_path = settings.data_dir / settings.vault_name
vault = SecretVault(vault_path, kms)
bootstrap_key = os.getenv('GEMINI_API_KEY')
if bootstrap_key:
    vault.store_secret(settings.gemini_api_key_name, bootstrap_key)
refresh_store = RefreshTokenStore(
    EncryptedJsonStore(settings.data_dir / settings.refresh_token_store, kms, 'refresh-tokens'),
    ttl_hours=settings.refresh_token_ttl_hours,
)
code_store = AuthorizationCodeStore(settings.data_dir / settings.authorization_code_store)
bucket_client = SecureBucketClient(
    bucket_name=settings.bucket_name,
    endpoint_url=settings.bucket_endpoint_url,
    region=settings.bucket_region,
    access_key=settings.bucket_access_key,
    secret_key=settings.bucket_secret_key,
)
audit_logger = AuditLogger(
    log_path=settings.data_dir / settings.audit_log_name,
    bucket=bucket_client,
    private_key_path=settings.data_dir / 'signing_key.pem',
)
user_manager = UserManager(settings.data_dir / 'users.json')
if settings.default_username and settings.default_password:
    if user_manager.create_user(settings.default_username, settings.default_password):
        audit_logger.log('auth', 'user.bootstrap', {'username': settings.default_username})
auth_service = AuthService(user_manager, code_store, refresh_store, audit_logger)
llm_client = LLMClient(vault, audit_logger)
ocr_service = OCRService(audit_logger)
masker = IdentifierMasker(audit_logger)
sensitive_store = SensitiveDataStore(settings.data_dir / 'sensitive.enc', kms, audit_logger)
chat_sessions = ChatSessionManager()

app = FastAPI(title='Nexus Quantum Backend', version='1.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.post('/auth/authorize')
async def authorize(request: AuthorizationRequest) -> Dict[str, str]:
    code = auth_service.authorize(request.username, request.password, request.code_challenge, request.client_id)
    return {'code': code}


@app.post('/auth/token')
async def exchange_token(
    grant_type: str = Form(...),
    code: str = Form(...),
    code_verifier: str = Form(...),
    client_id: str = Form('nexus-spa'),
) -> Dict[str, str]:
    if grant_type != 'authorization_code':
        raise HTTPException(status_code=400, detail='grant_type inválido para este endpoint.')
    return auth_service.exchange_token(code, code_verifier, client_id)


@app.post('/auth/refresh')
async def refresh_token(request: RefreshRequest) -> Dict[str, str]:
    return auth_service.refresh(request.refresh_token)


@app.post(f"{settings.api_base_path}/llm/generate-json")
async def generate_json(
    payload: LLMGenerationRequest,
    username: str = Depends(get_current_user),
) -> Dict[str, Any]:
    result = await llm_client.generate_structured_response(payload.prompt, payload.schema, payload.model)
    context_key = payload.context_key or f"llm-{hashlib.sha256(payload.prompt.encode('utf-8')).hexdigest()}"
    sensitive_store.persist(context_key, {
        'username': username,
        'result': result,
    })
    return {'result': result}


@app.post(f"{settings.api_base_path}/chat/sessions")
async def create_chat_session(
    payload: ChatSessionRequest,
    username: str = Depends(get_current_user),
) -> Dict[str, str]:
    session_id = chat_sessions.create(payload, username)
    audit_logger.log('chat', 'session.created', {'session_id': session_id, 'username': username})
    return {'session_id': session_id}


@app.post(f"{settings.api_base_path}/chat/sessions/{{session_id}}/messages")
async def send_chat_message(
    session_id: str,
    request: ChatMessageRequest,
    username: str = Depends(get_current_user),
) -> Dict[str, Any]:
    session = chat_sessions.get(session_id, username)
    payload: ChatSessionRequest = session['request']
    history: List[Dict[str, str]] = session['history']
    response = await llm_client.generate_chat_response(
        session_id=session_id,
        history=history,
        message=request.message,
        schema=payload.schema,
        system_instruction=payload.system_instruction,
        model=payload.model,
    )
    history.append({'role': 'user', 'content': request.message})
    history.append({'role': 'assistant', 'content': json.dumps(response)})
    audit_logger.log('chat', 'message.exchange', {'session_id': session_id})
    return {'response': response}


@app.post(f"{settings.api_base_path}/ocr")
async def run_ocr(
    file: UploadFile = File(...),
    username: str = Depends(get_current_user),
) -> Dict[str, str]:
    suffix = Path(file.filename or 'upload').suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        text = await ocr_service.extract_text(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    audit_logger.log('ocr', 'extracted', {'username': username, 'bytes': len(content)})
    return {'text': text}


@app.post(f"{settings.api_base_path}/sanitize")
async def sanitize_records(
    payload: SanitizeRequest,
    username: str = Depends(get_current_user),
) -> Dict[str, Any]:
    sanitized = masker.sanitize_records(payload.records)
    audit_logger.log('data', 'sanitized', {'username': username, 'count': len(payload.records)})
    return {'records': sanitized}


@app.get('/health')
async def health() -> Dict[str, str]:
    return {'status': 'ok'}
