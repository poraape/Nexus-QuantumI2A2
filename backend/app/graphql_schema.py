"""GraphQL schema exposed via Strawberry."""
from __future__ import annotations

import uuid
from typing import Optional

import strawberry
from strawberry.scalars import JSON

from .models import AnalysisJob
from .orchestrator import orchestrator


@strawberry.type
class AgentProgress:
    agent: str
    status: str
    step: Optional[str]
    current: Optional[int]
    total: Optional[int]


@strawberry.type
class AnalysisJobType:
    job_id: strawberry.ID
    status: str
    result: Optional[JSON]
    error: Optional[str]
    agent_states: list[AgentProgress]

    @staticmethod
    def from_model(job: AnalysisJob) -> "AnalysisJobType":
        agent_states = []
        for agent, payload in job.agent_states.items():
            progress = payload.get("progress", {}) if isinstance(payload, dict) else {}
            agent_states.append(
                AgentProgress(
                    agent=agent,
                    status=payload.get("status", "pending") if isinstance(payload, dict) else "pending",
                    step=progress.get("step"),
                    current=progress.get("current"),
                    total=progress.get("total"),
                )
            )
        return AnalysisJobType(
            job_id=strawberry.ID(str(job.id)),
            status=job.status.value,
            result=job.result_payload,
            error=job.error_message,
            agent_states=agent_states,
        )


@strawberry.type
class Query:
    @strawberry.field
    def analysis(self, job_id: strawberry.ID) -> Optional[AnalysisJobType]:
        job = orchestrator.get_job(uuid.UUID(str(job_id)))
        if not job:
            return None
        return AnalysisJobType.from_model(job)


schema = strawberry.Schema(query=Query)
