"""Prompt preparation utilities with semantic compression and adaptive chaining."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Sequence

from services.cache import ContextCache
from services.ingestion import PreprocessedDocument


@dataclass(frozen=True)
class ChainPlan:
    """Represents the adaptive strategy used before calling the LLM."""

    strategy: str
    steps: Sequence[str]


@dataclass(frozen=True)
class OptimizedPrompt:
    """Encapsulates a compressed prompt and its provenance."""

    prompt: str
    summaries: Sequence[str]
    plan: ChainPlan
    fingerprint: str


class PromptOptimizer:
    """Generates concise prompts leveraging cached summaries when available."""

    def __init__(
        self,
        cache: ContextCache,
        *,
        compression_ratio: float = 0.35,
    ) -> None:
        if not 0 < compression_ratio <= 1:
            raise ValueError("compression_ratio must be between 0 and 1")
        self._cache = cache
        self._compression_ratio = compression_ratio

    def optimize(
        self,
        query: str,
        documents: Sequence[PreprocessedDocument],
        *,
        force_refresh: bool = False,
    ) -> OptimizedPrompt:
        summaries: list[str] = []
        for doc in documents:
            summary = None if force_refresh else self._cache.get_summary(doc.document_id, version=doc.digest)
            if summary is None:
                summary = self._compress_text(doc.normalized_text)
                metadata: dict[str, object] = {"document_id": doc.document_id}
                if hasattr(doc.metadata, "get"):
                    source = doc.metadata.get("source")  # type: ignore[index]
                    if source is not None:
                        metadata["source"] = source
                self._cache.set_summary(
                    doc.document_id,
                    summary,
                    version=doc.digest,
                    metadata=metadata,
                )
            summaries.append(summary)

        plan = self._plan_for(query, summaries)
        prompt_body = self._build_prompt_body(query, summaries, plan)
        fingerprint = self._fingerprint(query, documents, plan)
        return OptimizedPrompt(
            prompt=prompt_body,
            summaries=tuple(summaries),
            plan=plan,
            fingerprint=fingerprint,
        )

    def _compress_text(self, text: str) -> str:
        sentences = re.split(r"(?<=[.!?])\s+", text)
        if not sentences:
            return text
        target_count = max(1, int(len(sentences) * self._compression_ratio))
        selected = sentences[:target_count]
        return " ".join(selected)

    def _plan_for(self, query: str, summaries: Sequence[str]) -> ChainPlan:
        if any(keyword in query.lower() for keyword in ("sintet", "resumo", "overview")):
            steps = [
                "Consolidar evidências relevantes",
                "Validar consistência temporal",
                "Produzir síntese executiva",
            ]
            strategy = "summarization"
        elif any(token in query.lower() for token in ("classific", "categoria", "tipo")):
            steps = [
                "Extrair características chave",
                "Aplicar taxonomia conhecida",
                "Justificar a classificação",
            ]
            strategy = "classification"
        else:
            steps = [
                "Identificar fatos centrais",
                "Mapear implicações fiscais",
                "Gerar resposta estruturada",
            ]
            strategy = "analysis"
        return ChainPlan(strategy=strategy, steps=tuple(steps))

    def _build_prompt_body(self, query: str, summaries: Sequence[str], plan: ChainPlan) -> str:
        plan_section = "\n".join(f"- {step}" for step in plan.steps)
        context = "\n".join(f"Documento {idx + 1}: {summary}" for idx, summary in enumerate(summaries))
        return (
            "Você é um assistente fiscal especializado. Siga o plano abaixo antes de responder.\n"
            f"Plano ({plan.strategy}):\n{plan_section}\n\n"
            f"Contexto disponível:\n{context}\n\n"
            f"Pergunta: {query}\n"
            "Responda com precisão e cite os documentos utilizados."
        )

    def _fingerprint(
        self,
        query: str,
        documents: Sequence[PreprocessedDocument],
        plan: ChainPlan,
    ) -> str:
        digest_source = "|".join([query, plan.strategy, *sorted(doc.digest for doc in documents)])
        return hashlib.sha256(digest_source.encode("utf-8")).hexdigest()
