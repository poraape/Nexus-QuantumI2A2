"""Lightweight tenacity stub used in offline test environments."""
from __future__ import annotations

from typing import Any, Callable, TypeVar

TFunc = TypeVar("TFunc", bound=Callable[..., Any])


class _RetryState:
    __slots__ = ("attempts",)

    def __init__(self, attempts: int) -> None:
        self.attempts = attempts


def retry(*args: Any, **kwargs: Any) -> Callable[[TFunc], TFunc]:
    def decorator(func: TFunc) -> TFunc:
        return func

    return decorator


def stop_after_attempt(attempts: int) -> _RetryState:
    return _RetryState(attempts)


def wait_exponential_jitter(**kwargs: Any) -> None:
    return None


__all__ = ["retry", "stop_after_attempt", "wait_exponential_jitter"]
