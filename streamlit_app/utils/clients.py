"""Helpers to lazily instantiate backend clients across Streamlit pages."""
from __future__ import annotations

import streamlit as st

from ..services.backend import BackendClient, BackendConfig, IntegrationClient
from ..state import ensure_state

_BACKEND_CLIENT_KEY = "_backend_client"
_INTEGRATION_CLIENT_KEY = "_integration_client"


def get_backend_client() -> BackendClient:
    state = ensure_state()
    client: BackendClient | None = st.session_state.get(_BACKEND_CLIENT_KEY)
    if (
        client is None
        or client.config.base_url.rstrip("/") != state.backend_url.rstrip("/")
        or client.config.api_prefix.rstrip("/") != state.backend_api_prefix.rstrip("/")
    ):
        st.session_state[_BACKEND_CLIENT_KEY] = BackendClient(
            BackendConfig(
                base_url=state.backend_url,
                api_prefix=state.backend_api_prefix,
            )
        )
    return st.session_state[_BACKEND_CLIENT_KEY]


def get_integration_client() -> IntegrationClient:
    state = ensure_state()
    client: IntegrationClient | None = st.session_state.get(_INTEGRATION_CLIENT_KEY)
    if client is None or client.base_url.rstrip("/") != state.mas_url.rstrip("/"):
        st.session_state[_INTEGRATION_CLIENT_KEY] = IntegrationClient(state.mas_url)
    return st.session_state[_INTEGRATION_CLIENT_KEY]
