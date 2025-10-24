"""Aplicação backend do Nexus."""
from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

_shim_path = Path(__file__).resolve().parent
_backend = importlib.import_module("backend.app")
_backend_paths = list(getattr(_backend, "__path__", []))
if str(_shim_path) not in _backend_paths:
    __path__ = [str(_shim_path), *_backend_paths]  # type: ignore[assignment]
else:
    __path__ = _backend_paths  # type: ignore[assignment]

sys.modules.setdefault("app", sys.modules[__name__])

_module_overrides: dict[str, Path] = {
    "api": _shim_path / "api.py",
}
_loaded_overrides: dict[str, ModuleType] = {}

_state_machine_path = _shim_path / "orchestrator" / "state_machine.py"
if _state_machine_path.exists():
    spec = importlib.util.spec_from_file_location(
        "app.orchestrator.state_machine", _state_machine_path
    )
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        sys.modules.setdefault(spec.name, module)
        spec.loader.exec_module(module)  # type: ignore[call-arg]
        sys.modules.setdefault("backend.app.orchestrator.state_machine", module)
        orchestrator_module = importlib.import_module("backend.app.orchestrator")
        setattr(orchestrator_module, "state_machine", module)
        sys.modules.setdefault("app.orchestrator", orchestrator_module)
        _loaded_overrides["orchestrator.state_machine"] = module


def _load_override(name: str) -> ModuleType:
    cached = _loaded_overrides.get(name)
    if cached is not None:
        return cached
    path = _module_overrides[name]
    spec = importlib.util.spec_from_file_location(f"backend.app.{name}", path)
    if not spec or not spec.loader:
        raise AttributeError(f"Unable to load override module for {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[call-arg]
    sys.modules.setdefault(f"app.{name}", module)
    _loaded_overrides[name] = module
    return module


def __getattr__(name: str) -> Any:
    if name in _module_overrides:
        return _load_override(name)
    module = importlib.import_module(f"backend.app.{name}")
    sys.modules.setdefault(f"app.{name}", module)
    return module


def __dir__() -> list[str]:
    attributes = set(globals())
    attributes.update(
        name.split(".", 2)[1]
        for name in sys.modules
        if name.startswith("backend.app.") and "." in name
    )
    return sorted(attributes)
