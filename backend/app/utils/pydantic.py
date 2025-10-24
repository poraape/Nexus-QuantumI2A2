"""Compatibility helpers for working with Pydantic v1/v2."""
from __future__ import annotations

from typing import Any, MutableMapping


def model_dump(model: Any) -> MutableMapping[str, Any]:
    """Return a mapping representation regardless of Pydantic version."""

    if hasattr(model, "model_dump"):
        return model.model_dump()  # type: ignore[return-value]
    if hasattr(model, "dict"):
        return model.dict()  # type: ignore[return-value]
    raise AttributeError(f"Object {type(model)!r} does not support model_dump/dict")
