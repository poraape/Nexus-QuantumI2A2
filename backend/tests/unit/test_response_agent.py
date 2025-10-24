"""Unit tests for the response agent service."""
from __future__ import annotations

from backend.app.services.agents.response_agent import EfficiencyGuard, ResponseAgentService


class _DummyLLM:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object], str | None, dict[str, object] | None]] = []

    def run(
        self,
        prompt: str,
        schema: dict[str, object] | None = None,
        *,
        model: str | None = None,
        generation_config: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.calls.append((prompt, schema or {}, model, generation_config))
        return {"result": "ok"}


def test_efficiency_guard_clamps_temperature_and_tokens() -> None:
    llm = _DummyLLM()
    guard = EfficiencyGuard(max_temperature=0.5, min_temperature=0.1, max_output_tokens=2048, min_output_tokens=64)
    service = ResponseAgentService(
        llm=llm,
        default_model="gemini-pro",
        default_temperature=0.3,
        default_max_output_tokens=1024,
        guard=guard,
    )

    payload = service.generate_structured_response(
        prompt="hello",
        schema={"type": "object"},
        temperature=0.9,
        max_output_tokens=5000,
        model="custom-model",
    )

    assert payload == {"result": "ok"}
    assert len(llm.calls) == 1
    _, _, model, generation_config = llm.calls[0]
    assert model == "custom-model"
    assert generation_config is not None
    assert generation_config["temperature"] == 0.5
    assert generation_config["maxOutputTokens"] == 2048


def test_response_agent_uses_defaults_when_parameters_are_missing() -> None:
    llm = _DummyLLM()
    service = ResponseAgentService(llm=llm, default_temperature=0.2, default_max_output_tokens=512)

    service.generate_structured_response(prompt="hi", schema=None)

    assert len(llm.calls) == 1
    _, _, model, generation_config = llm.calls[0]
    assert model == "gemini-1.5-pro"
    assert generation_config == {"temperature": 0.2, "maxOutputTokens": 512, "candidateCount": 1}
