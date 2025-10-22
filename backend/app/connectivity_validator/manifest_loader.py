from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict


@dataclass(slots=True)
class ConnectivityManifest:
    """Dataclass wrapper around the validator manifest."""

    raw: Dict[str, Any]

    @property
    def manifest(self) -> Dict[str, Any]:
        return self.raw.get("manifest", {})

    @property
    def name(self) -> str:
        return self.manifest.get("name", "nexus_connectivity_validator")

    @property
    def environments(self) -> Dict[str, Any]:
        return self.manifest.get("env_matrix", {})

    @property
    def reporting(self) -> Dict[str, Any]:
        return self.manifest.get("reporting", {})

    @property
    def failure_signatures(self) -> Dict[str, str]:
        return self.manifest.get("failure_signatures", {})

    @property
    def auto_remediation(self) -> Dict[str, Any]:
        return self.manifest.get("auto_remediation", {})

    @property
    def topology(self) -> Dict[str, Any]:
        return self.manifest.get("topology", {})

    @property
    def endpoints(self) -> Dict[str, Any]:
        return self.manifest.get("endpoints", {})

    @property
    def compliance_security(self) -> Dict[str, Any]:
        return self.manifest.get("compliance_security", {})

    @property
    def healthchecks(self) -> Dict[str, Any]:
        return self.manifest.get("healthchecks", {})

    @property
    def metadata(self) -> Dict[str, Any]:
        return self.manifest.get("metadata", {})

    @property
    def resilience(self) -> Dict[str, Any]:
        return self.manifest.get("resilience", {})

    def to_dict(self) -> Dict[str, Any]:
        return self.raw


def load_manifest(path: Path) -> ConnectivityManifest:
    """Load the manifest JSON file from the given path."""
    if not path.exists():
        raise FileNotFoundError(f"Manifest file not found: {path}")

    with path.open("r", encoding="utf-8") as manifest_file:
        raw_manifest = json.load(manifest_file)

    return ConnectivityManifest(raw=raw_manifest)
