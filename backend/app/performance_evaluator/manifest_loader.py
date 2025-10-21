from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict


@dataclass(slots=True)
class PerformanceManifest:
    raw: Dict[str, Any]

    @property
    def manifest(self) -> Dict[str, Any]:
        return self.raw.get("runtime_evaluator", {})

    @property
    def metadata(self) -> Dict[str, Any]:
        return self.manifest.get("metadata", {})

    @property
    def metrics_targets(self) -> Dict[str, Any]:
        return self.manifest.get("metrics_targets", {})

    @property
    def runtime_tracking(self) -> Dict[str, Any]:
        return self.manifest.get("runtime_tracking", {})

    @property
    def agent_analysis(self) -> Dict[str, Any]:
        return self.manifest.get("agent_analysis", {})

    @property
    def data_validation(self) -> Dict[str, Any]:
        return self.manifest.get("data_validation", {})

    @property
    def null_metric_detection(self) -> Dict[str, Any]:
        return self.manifest.get("null_metric_detection", {})

    @property
    def optimization_plan(self) -> Dict[str, Any]:
        return self.manifest.get("optimization_plan", {})

    @property
    def benchmark_report(self) -> Dict[str, Any]:
        return self.manifest.get("benchmark_report", {})

    @property
    def auto_tuning(self) -> Dict[str, Any]:
        return self.manifest.get("auto_tuning", {})

    @property
    def logging_audit(self) -> Dict[str, Any]:
        return self.manifest.get("logging_audit", {})

    @property
    def ci_cd_integration(self) -> Dict[str, Any]:
        return self.manifest.get("ci_cd_integration", {})

    @property
    def final_criteria(self) -> Dict[str, Any]:
        return self.manifest.get("final_criteria", {})

    def to_dict(self) -> Dict[str, Any]:
        return self.manifest


def load_manifest(path: Path) -> PerformanceManifest:
    if not path.exists():
        raise FileNotFoundError(f"Performance manifest not found: {path}")

    content = json.loads(path.read_text(encoding="utf-8"))
    return PerformanceManifest(raw=content)
