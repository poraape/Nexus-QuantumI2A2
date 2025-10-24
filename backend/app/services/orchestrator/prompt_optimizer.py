"""Prompt optimization helpers with embedding cache reuse."""
from __future__ import annotations

import math
from collections import Counter
from typing import Callable, Mapping, MutableMapping, Sequence


EmbeddingVector = tuple[float, ...]


def _default_embedding(text: str) -> EmbeddingVector:
    tokens = [token for token in text.lower().split() if token]
    counts = Counter(tokens)
    if not counts:
        return (0.0,)
    magnitude = math.sqrt(sum(value * value for value in counts.values())) or 1.0
    return tuple(counts[token] / magnitude for token in sorted(counts))


class PromptOptimizer:
    """Selects the most relevant context chunks within a token budget."""

    def __init__(
        self,
        *,
        embedder: Callable[[str], EmbeddingVector] | None = None,
        cache: MutableMapping[str, EmbeddingVector] | None = None,
    ) -> None:
        self._embedder = embedder or _default_embedding
        self._cache: MutableMapping[str, EmbeddingVector] = cache or {}

    # ------------------------------------------------------------------
    # Embedding utilities
    # ------------------------------------------------------------------
    def _get_embedding(self, text: str) -> EmbeddingVector:
        key = text.strip()
        if key in self._cache:
            return self._cache[key]
        embedding = self._embedder(key)
        self._cache[key] = embedding
        return embedding

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, math.ceil(len(text) / 4))

    @staticmethod
    def _similarity(vec_a: EmbeddingVector, vec_b: EmbeddingVector) -> float:
        if len(vec_a) != len(vec_b):
            length = max(len(vec_a), len(vec_b))
            vec_a = tuple(list(vec_a) + [0.0] * (length - len(vec_a)))
            vec_b = tuple(list(vec_b) + [0.0] * (length - len(vec_b)))
        return sum(a * b for a, b in zip(vec_a, vec_b))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def optimize(
        self,
        prompt: str,
        context_chunks: Sequence[str],
        max_tokens: int,
    ) -> str:
        if max_tokens <= self._estimate_tokens(prompt):
            return prompt

        prompt_embedding = self._get_embedding(prompt)
        ranked_chunks = sorted(
            context_chunks,
            key=lambda chunk: self._similarity(prompt_embedding, self._get_embedding(chunk)),
            reverse=True,
        )

        selected: list[str] = []
        total_tokens = self._estimate_tokens(prompt)
        for chunk in ranked_chunks:
            chunk_tokens = self._estimate_tokens(chunk)
            if total_tokens + chunk_tokens > max_tokens:
                continue
            selected.append(chunk)
            total_tokens += chunk_tokens

        if not selected:
            return prompt

        separator = "\n\nContexto:\n"
        context = "\n---\n".join(selected)
        return f"{prompt}{separator}{context}"

    def estimate_tokens(self, text: str) -> int:
        return self._estimate_tokens(text)

    def cache_size(self) -> int:
        return len(self._cache)

    def warm_cache(self, pairs: Mapping[str, str]) -> None:
        for key, value in pairs.items():
            combined = f"{key}: {value}"
            self._get_embedding(combined)


__all__ = ["PromptOptimizer", "EmbeddingVector"]
