"""Asynchronous controller orchestrating cache-aware hybrid agent execution."""
from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Awaitable, Callable, Mapping, MutableMapping, Optional, Sequence

from services.cache import ContextCache
from services.ingestion import DocumentPayload, IngestionPreprocessor, PreprocessedDocument

from .prompt_optimizer import ChainPlan, PromptOptimizer


LLMCallable = Callable[[str, ChainPlan], Awaitable[object] | object]
EmbeddingCallable = Callable[[Sequence[PreprocessedDocument]], Awaitable[Mapping[str, object]] | Mapping[str, object]]


@dataclass(frozen=True)
class AsyncAgentExecutionResult:
    """Result payload describing how an agent execution completed."""

    response: object
    from_cache: bool
    plan: ChainPlan
    prompt: str
    fingerprint: str
    summaries: Sequence[str]
    embeddings: Mapping[str, object]


class AsyncAgentController:
    """Coordinates preprocessing, caching and LLM execution for agents."""

    def __init__(
        self,
        *,
        cache: ContextCache,
        preprocessor: IngestionPreprocessor,
        prompt_optimizer: PromptOptimizer,
        llm_callable: LLMCallable,
        embedder: Optional[EmbeddingCallable] = None,
    ) -> None:
        self._cache = cache
        self._preprocessor = preprocessor
        self._prompt_optimizer = prompt_optimizer
        self._llm_callable = llm_callable
        self._embedder = embedder

    async def run(
        self,
        query: str,
        documents: Sequence[DocumentPayload],
        *,
        force_refresh: bool = False,
    ) -> AsyncAgentExecutionResult:
        preprocessing = self._preprocessor.prepare_batch(documents, force_refresh=force_refresh)
        embedding_index: MutableMapping[str, object] = dict(preprocessing.reused_embeddings)

        if preprocessing.pending_embeddings:
            if self._embedder is None:
                raise RuntimeError("Pending embeddings require an embedder to be configured")
            new_embeddings = await self._resolve(self._embedder(preprocessing.pending_embeddings))
            if not isinstance(new_embeddings, Mapping):
                raise TypeError("Embedder must return a mapping of document_id to embedding")
            missing = [
                doc.document_id
                for doc in preprocessing.pending_embeddings
                if doc.document_id not in new_embeddings
            ]
            if missing:
                raise KeyError(f"Embedder did not return embeddings for: {', '.join(missing)}")
            version_map = {doc.document_id: doc.digest for doc in preprocessing.pending_embeddings}
            self._preprocessor.persist_embeddings(new_embeddings, version_map=version_map)
            embedding_index.update(new_embeddings)

        optimized = self._prompt_optimizer.optimize(
            query,
            preprocessing.documents,
            force_refresh=force_refresh,
        )

        cache_key = self._response_cache_key(optimized.fingerprint)
        if not force_refresh:
            cached_response = self._cache.get_summary(cache_key, version=optimized.fingerprint)
            if cached_response is not None:
                return AsyncAgentExecutionResult(
                    response=cached_response,
                    from_cache=True,
                    plan=optimized.plan,
                    prompt=optimized.prompt,
                    fingerprint=optimized.fingerprint,
                    summaries=optimized.summaries,
                    embeddings=dict(embedding_index),
                )

        raw_response = await self._resolve(self._llm_callable(optimized.prompt, optimized.plan))
        self._cache.set_summary(
            cache_key,
            raw_response,
            version=optimized.fingerprint,
            metadata={
                "type": "agent_response",
                "strategy": optimized.plan.strategy,
            },
        )
        return AsyncAgentExecutionResult(
            response=raw_response,
            from_cache=False,
            plan=optimized.plan,
            prompt=optimized.prompt,
            fingerprint=optimized.fingerprint,
            summaries=optimized.summaries,
            embeddings=dict(embedding_index),
        )

    async def _resolve(self, value: Awaitable[object] | Mapping[str, object] | object) -> object:
        if inspect.isawaitable(value):
            return await value  # type: ignore[return-value]
        return value

    def _response_cache_key(self, fingerprint: str) -> str:
        return f"response::{fingerprint}"
