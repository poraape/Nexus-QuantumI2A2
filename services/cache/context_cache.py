"""Context-aware caching primitives with LRU eviction policy."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from threading import RLock
from typing import Generic, Hashable, Iterable, MutableMapping, Optional, TypeVar


K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """Simple thread-safe LRU cache.

    The implementation is intentionally lightweight to avoid bringing in
    external dependencies while supporting introspection by higher level
    services.
    """

    def __init__(self, capacity: int) -> None:
        if capacity <= 0:
            raise ValueError("LRUCache capacity must be greater than zero")
        self._capacity = capacity
        self._store: "OrderedDict[K, V]" = OrderedDict()
        self._lock = RLock()

    @property
    def capacity(self) -> int:
        return self._capacity

    def __contains__(self, key: K) -> bool:  # pragma: no cover - passthrough
        with self._lock:
            return key in self._store

    def __len__(self) -> int:  # pragma: no cover - passthrough
        with self._lock:
            return len(self._store)

    def items(self) -> Iterable[tuple[K, V]]:  # pragma: no cover - diagnostics helper
        with self._lock:
            return tuple(self._store.items())

    def get(self, key: K) -> Optional[V]:
        with self._lock:
            if key not in self._store:
                return None
            value = self._store.pop(key)
            self._store[key] = value
            return value

    def put(self, key: K, value: V) -> None:
        with self._lock:
            if key in self._store:
                self._store.pop(key)
            elif len(self._store) >= self._capacity:
                self._store.popitem(last=False)
            self._store[key] = value

    def pop(self, key: K) -> Optional[V]:
        with self._lock:
            return self._store.pop(key, None)

    def clear(self) -> None:  # pragma: no cover - utility method
        with self._lock:
            self._store.clear()


@dataclass
class CacheEntry(Generic[V]):
    """Represents a cached asset with basic provenance information."""

    value: V
    version: Optional[str] = None
    metadata: MutableMapping[str, object] = field(default_factory=dict)

    def is_valid(self, expected_version: Optional[str]) -> bool:
        if expected_version is None:
            return True
        return self.version == expected_version


class ContextCache:
    """Specialized cache for embeddings and summaries shared across agents."""

    def __init__(
        self,
        *,
        embedding_capacity: int = 512,
        summary_capacity: int = 512,
    ) -> None:
        self._embeddings: LRUCache[Hashable, CacheEntry[object]] = LRUCache(embedding_capacity)
        self._summaries: LRUCache[Hashable, CacheEntry[object]] = LRUCache(summary_capacity)
        self._lock = RLock()

    def _get_entry(
        self,
        cache: LRUCache[Hashable, CacheEntry[object]],
        key: Hashable,
        *,
        version: Optional[str] = None,
    ) -> Optional[object]:
        entry = cache.get(key)
        if entry is None:
            return None
        if not entry.is_valid(version):
            return None
        return entry.value

    def _set_entry(
        self,
        cache: LRUCache[Hashable, CacheEntry[object]],
        key: Hashable,
        value: object,
        *,
        version: Optional[str] = None,
        metadata: Optional[MutableMapping[str, object]] = None,
    ) -> CacheEntry[object]:
        entry = CacheEntry(value=value, version=version, metadata=metadata or {})
        cache.put(key, entry)
        return entry

    def get_embedding(self, key: Hashable, *, version: Optional[str] = None) -> Optional[object]:
        """Retrieve an embedding by key if it matches the provided version."""

        with self._lock:
            return self._get_entry(self._embeddings, key, version=version)

    def set_embedding(
        self,
        key: Hashable,
        value: object,
        *,
        version: Optional[str] = None,
        metadata: Optional[MutableMapping[str, object]] = None,
    ) -> CacheEntry[object]:
        with self._lock:
            return self._set_entry(self._embeddings, key, value, version=version, metadata=metadata)

    def drop_embedding(self, key: Hashable) -> Optional[CacheEntry[object]]:  # pragma: no cover - rarely used helper
        with self._lock:
            entry = self._embeddings.pop(key)
            return entry

    def get_summary(self, key: Hashable, *, version: Optional[str] = None) -> Optional[object]:
        """Retrieve a cached summary, ensuring the stored version still matches."""

        with self._lock:
            return self._get_entry(self._summaries, key, version=version)

    def set_summary(
        self,
        key: Hashable,
        value: object,
        *,
        version: Optional[str] = None,
        metadata: Optional[MutableMapping[str, object]] = None,
    ) -> CacheEntry[object]:
        with self._lock:
            return self._set_entry(self._summaries, key, value, version=version, metadata=metadata)

    def drop_summary(self, key: Hashable) -> Optional[CacheEntry[object]]:  # pragma: no cover - rarely used helper
        with self._lock:
            entry = self._summaries.pop(key)
            return entry

    def snapshot(self) -> dict[str, int]:
        """Expose basic occupancy stats for observability purposes."""

        with self._lock:
            return {
                "embeddings": len(self._embeddings),
                "summaries": len(self._summaries),
            }
