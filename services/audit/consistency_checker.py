"""Ferramentas de auditoria para verificar consistência de relatórios fiscais."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List
import math


@dataclass
class Difference:
    """Representa uma divergência quantitativa entre cenários analisados."""

    record_id: str
    metric: str
    baseline: float
    candidate: float
    delta: float
    percentage_delta: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "metric": self.metric,
            "baseline": self.baseline,
            "candidate": self.candidate,
            "delta": self.delta,
            "percentage_delta": self.percentage_delta,
        }


class ConsistencyChecker:
    """Executa comparações estatísticas entre execuções do pipeline fiscal."""

    def __init__(self, tolerance: float = 0.05) -> None:
        self.tolerance = tolerance

    @staticmethod
    def _normalize_records(records: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
        normalized: Dict[str, Dict[str, float]] = {}
        for record in records:
            record_id = str(record.get("record_id") or record.get("id"))
            if not record_id:
                continue

            metrics: Dict[str, float] = {}
            for key, value in record.items():
                if key in {"record_id", "id", "metadata"}:
                    continue
                if isinstance(value, (int, float)):
                    metrics[key] = float(value)
            normalized[record_id] = metrics
        return normalized

    def _calculate_percentage_delta(self, baseline: float, candidate: float) -> float:
        if baseline == 0:
            if candidate == 0:
                return 0.0
            return math.inf
        return abs(candidate - baseline) / abs(baseline)

    def validate(
        self,
        baseline: Iterable[Dict[str, Any]],
        candidate: Iterable[Dict[str, Any]],
    ) -> List[Difference]:
        base = self._normalize_records(baseline)
        cand = self._normalize_records(candidate)
        differences: List[Difference] = []

        for record_id, base_metrics in base.items():
            candidate_metrics = cand.get(record_id, {})
            for metric, base_value in base_metrics.items():
                candidate_value = candidate_metrics.get(metric)
                if candidate_value is None:
                    differences.append(
                        Difference(
                            record_id,
                            metric,
                            base_value,
                            math.nan,
                            math.nan,
                            math.inf,
                        )
                    )
                    continue

                delta = candidate_value - base_value
                pct_delta = self._calculate_percentage_delta(base_value, candidate_value)
                if pct_delta > self.tolerance:
                    differences.append(
                        Difference(
                            record_id,
                            metric,
                            base_value,
                            candidate_value,
                            delta,
                            pct_delta,
                        )
                    )

        for record_id in cand.keys() - base.keys():
            for metric, value in cand[record_id].items():
                differences.append(
                    Difference(record_id, metric, 0.0, value, value, math.inf)
                )

        return differences

    def generate_report(
        self,
        baseline: Iterable[Dict[str, Any]],
        candidate: Iterable[Dict[str, Any]],
    ) -> Dict[str, Any]:
        baseline_list = list(baseline)
        candidate_list = list(candidate)
        differences = self.validate(baseline_list, candidate_list)
        status = "ok" if not differences else "divergent"
        max_delta = max((diff.percentage_delta for diff in differences), default=0.0)

        report = {
            "status": status,
            "tolerance": self.tolerance,
            "differences": [diff.to_dict() for diff in differences],
            "summary": (
                "Nenhuma divergência encontrada." if not differences else f"Foram encontradas {len(differences)} divergências. Maior variação relativa: {max_delta:.2%}."
            ),
            "metadata": {
                "baseline_records": len(baseline_list),
                "candidate_records": len(candidate_list),
            },
        }
        return report


def validate_pipeline_outputs(
    baseline: Iterable[Dict[str, Any]],
    candidate: Iterable[Dict[str, Any]],
    tolerance: float = 0.05,
) -> Dict[str, Any]:
    """Facilita o uso rápido do verificador de consistência."""

    checker = ConsistencyChecker(tolerance=tolerance)
    return checker.generate_report(baseline, candidate)


__all__ = ["ConsistencyChecker", "Difference", "validate_pipeline_outputs"]
