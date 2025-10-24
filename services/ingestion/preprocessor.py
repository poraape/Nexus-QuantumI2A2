"""Offline normalization pipeline with incremental indexing awareness."""
from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass
from typing import Callable, Iterable, Mapping, MutableMapping, Optional, Sequence

from services.cache import ContextCache


@dataclass(frozen=True)
class DocumentPayload:
    """Raw document used during ingestion."""

    document_id: str
    content: str
    metadata: Mapping[str, object] | None = None


@dataclass(frozen=True)
class PreprocessedDocument:
    """Normalized representation of a document with provenance info."""

    document_id: str
    normalized_text: str
    digest: str
    metadata: Mapping[str, object]


@dataclass
class PreprocessingResult:
    """Outcome of the preprocessing stage."""

    documents: Sequence[PreprocessedDocument]
    pending_embeddings: Sequence[PreprocessedDocument]
    reused_embeddings: MutableMapping[str, object]

    def digests(self) -> Sequence[str]:
        return tuple(document.digest for document in self.documents)


Normalizer = Callable[[str], str]


def _default_normalizers() -> tuple[Normalizer, ...]:
    def nfkc(text: str) -> str:
        return unicodedata.normalize("NFKC", text)

    def lowercase(text: str) -> str:
        return text.lower()

    def strip_extra_whitespace(text: str) -> str:
        return " ".join(text.split())

    return (nfkc, lowercase, strip_extra_whitespace)


class IngestionPreprocessor:
    """Applies offline normalization and controls incremental indexing."""

    def __init__(
        self,
        cache: ContextCache,
        normalizers: Optional[Iterable[Normalizer]] = None,
    ) -> None:
        self._cache = cache
        steps = tuple(normalizers) if normalizers is not None else _default_normalizers()
        if not steps:
            raise ValueError("At least one normalization step is required")
        self._normalizers: tuple[Normalizer, ...] = steps

    def normalize(self, text: str) -> str:
        normalized = text
        for transform in self._normalizers:
            normalized = transform(normalized)
        return normalized

    def _digest(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def prepare_batch(
        self,
        documents: Sequence[DocumentPayload],
        *,
        force_refresh: bool = False,
    ) -> PreprocessingResult:
        preprocessed: list[PreprocessedDocument] = []
        pending_embeddings: list[PreprocessedDocument] = []
        reused_embeddings: MutableMapping[str, object] = {}

        for item in documents:
            metadata = dict(item.metadata or {})
            normalized_text = self.normalize(item.content)
            digest = self._digest(normalized_text)
            pre_doc = PreprocessedDocument(
                document_id=item.document_id,
                normalized_text=normalized_text,
                digest=digest,
                metadata=metadata,
            )
            preprocessed.append(pre_doc)

            cached_embedding = None if force_refresh else self._cache.get_embedding(item.document_id, version=digest)
            if cached_embedding is None:
                pending_embeddings.append(pre_doc)
            else:
                reused_embeddings[item.document_id] = cached_embedding

        return PreprocessingResult(
            documents=tuple(preprocessed),
            pending_embeddings=tuple(pending_embeddings),
            reused_embeddings=reused_embeddings,
        )

    def persist_embeddings(
        self,
        embeddings: Mapping[str, object],
        *,
        version_map: Mapping[str, str],
    ) -> None:
        for document_id, embedding in embeddings.items():
            version = version_map.get(document_id)
            if version is None:
                raise KeyError(f"Missing digest for document {document_id}")
            self._cache.set_embedding(
                document_id,
                embedding,
                version=version,
                metadata={"document_id": document_id},
            )
