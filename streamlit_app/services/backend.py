"""HTTP clients for MAS backend services."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional

import requests
from requests import Response, Session
from tenacity import RetryError, retry, retry_if_exception_type, stop_after_attempt, wait_exponential

DEFAULT_TIMEOUT = 30


class BackendError(RuntimeError):
    """Raised when the MAS backend returns an error response."""


@dataclass
class BackendConfig:
    base_url: str
    api_prefix: str = "/api"
    timeout: int = DEFAULT_TIMEOUT

    def endpoint(self, path: str) -> str:
        prefix = self.api_prefix if self.api_prefix.startswith("/") else f"/{self.api_prefix}"
        return f"{self.base_url.rstrip('/')}{prefix}{path}"


class BackendClient:
    """Client responsible for orchestrator and LLM endpoints."""

    def __init__(self, config: BackendConfig) -> None:
        self.config = config
        self.session: Session = requests.Session()

    # --- Internal helpers -------------------------------------------------
    def _raise_for_status(self, response: Response) -> None:
        if response.ok:
            return
        try:
            payload = response.json()
        except ValueError:
            payload = {"detail": response.text}
        message = payload.get("detail") if isinstance(payload, dict) else response.text
        raise BackendError(message or f"Request failed with status {response.status_code}")

    def _post(self, path: str, **kwargs: Any) -> Response:
        try:
            response = self.session.post(
                self.config.endpoint(path),
                timeout=self.config.timeout,
                **kwargs,
            )
        except requests.RequestException as exc:  # noqa: PERF203 - explicit translation
            raise BackendError("Falha de rede ao contatar o backend.") from exc
        self._raise_for_status(response)
        return response

    def _get(self, path: str, **kwargs: Any) -> Response:
        try:
            response = self.session.get(
                self.config.endpoint(path),
                timeout=self.config.timeout,
                **kwargs,
            )
        except requests.RequestException as exc:  # noqa: PERF203 - explicit translation
            raise BackendError("Falha de rede ao contatar o backend.") from exc
        self._raise_for_status(response)
        return response

    # --- Public API -------------------------------------------------------
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=1, max=5),
        retry=retry_if_exception_type((BackendError, requests.RequestException)),
        reraise=True,
    )
    def create_session(self) -> Dict[str, Any]:
        response = self._post("/session")
        return response.json()

    def start_analysis(self, files: Iterable[Any], webhook_url: str | None = None) -> Dict[str, Any]:
        form_files = []
        for file in files:
            file_bytes = file.getvalue() if hasattr(file, "getvalue") else file.read()
            form_files.append(
                (
                    "files",
                    (
                        getattr(file, "name", "upload.bin"),
                        file_bytes,
                        getattr(file, "type", "application/octet-stream"),
                    ),
                )
            )
        data = {"webhook_url": webhook_url} if webhook_url else None
        response = self._post("/analysis", files=form_files, data=data)
        return response.json()

    def get_job(self, job_id: str) -> Dict[str, Any]:
        response = self._get(f"/analysis/{job_id}")
        return response.json()

    def get_progress(self, job_id: str) -> Dict[str, Any]:
        response = self._get(f"/analysis/{job_id}/progress")
        return response.json()

    def start_chat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = self._post("/chat/sessions", json=payload)
        return response.json()

    def send_chat(self, session_id: str, message: str) -> Dict[str, Any]:
        response = self._post(f"/chat/sessions/{session_id}/messages", json={"message": message})
        return response.json()

    def generate_json(self, prompt: str, schema: Dict[str, Any], model: str = "gemini-2.0-flash") -> Dict[str, Any]:
        response = self._post(
            "/llm/generate-json",
            json={"prompt": prompt, "schema": schema, "model": model},
        )
        return response.json()


class IntegrationClient:
    """Client for ERP integration status endpoints (Node.js service)."""

    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session: Session = requests.Session()

    def _handle(self, response: Response) -> Dict[str, Any]:
        if response.ok:
            return response.json()
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text}
        message = payload.get("error") if isinstance(payload, dict) else response.text
        raise BackendError(message or f"Integration API failure ({response.status_code})")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=1, max=5),
        retry=retry_if_exception_type(requests.RequestException),
        reraise=True,
    )
    def _fetch_status_with_retry(self) -> Response:
        return self.session.get(
            f"{self.base_url}/api/integrations/status", timeout=self.timeout
        )

    def fetch_status(self) -> Dict[str, Any]:
        try:
            response = self._fetch_status_with_retry()
        except RetryError as exc:
            raise BackendError("Serviço de integrações indisponível no momento.") from exc
        return self._handle(response)

    def enqueue_import(self, erp: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.session.post(
                f"{self.base_url}/api/integrations/{erp.lower()}/import",
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:  # noqa: PERF203 - explicit translation
            raise BackendError("Falha de rede ao enviar job de importação.") from exc
        return self._handle(response)

    def enqueue_export(self, erp: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.session.post(
                f"{self.base_url}/api/integrations/{erp.lower()}/export",
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:  # noqa: PERF203 - explicit translation
            raise BackendError("Falha de rede ao enviar job de exportação.") from exc
        return self._handle(response)


def ensure_session(client: BackendClient) -> Optional[Dict[str, Any]]:
    """Create a backend session if one is not active."""
    try:
        return client.create_session()
    except RetryError as exc:
        raise BackendError("Não foi possível estabelecer sessão com o backend.") from exc
    except requests.RequestException as exc:  # noqa: PERF203 - explicit translation
        raise BackendError("Falha de rede ao contatar o backend.") from exc
