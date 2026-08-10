"""《科学假设与研究计划》的 Pydantic 契约。

字段约束来自迁移时冻结的 Luup 工件契约。模型默认忽略未知字段，
这是 Zod `z.object()` 默认 strip unknown keys 的等价行为；不要在这一层把未来的
Agent 输出兼容性改成额外字段错误。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

# "2401.12345" / "2401.12345v2" / "astro-ph/0601001"
ARXIV_ID_PATTERN = r"^([0-9]{4}\.[0-9]{4,5}(v[0-9]+)?|[a-z-]+(\.[A-Z]{2})?/[0-9]{7}(v[0-9]+)?)$"

NonEmptyStr = Annotated[str, Field(min_length=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Reference(ContractModel):
    arxiv_id: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("arxivId", "arxiv_id"),
            serialization_alias="arxivId",
            pattern=ARXIV_ID_PATTERN,
        ),
    ]
    title: NonEmptyStr
    authors: Annotated[list[NonEmptyStr], Field(min_length=1)]
    year: Annotated[int, Field(ge=1990, le=2026)]
    relevance: NonEmptyStr


class Datasets(ContractModel):
    source: Annotated[str, Field(min_length=20)]
    target: Annotated[str, Field(min_length=20)]


class Experiments(ContractModel):
    baselines: Annotated[list[NonEmptyStr], Field(min_length=1)]
    metrics: Annotated[list[NonEmptyStr], Field(min_length=1)]
    design: Annotated[str, Field(min_length=50)]


class Proposal(ContractModel):
    problem_statement: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("problemStatement", "problem_statement"),
            serialization_alias="problemStatement",
            min_length=50,
        ),
    ]
    rationale: Annotated[str, Field(min_length=100)]
    technical_details: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("technicalDetails", "technical_details"),
            serialization_alias="technicalDetails",
            min_length=50,
        ),
    ]
    datasets: Datasets
    paper_title: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("paperTitle", "paper_title"),
            serialization_alias="paperTitle",
            min_length=10,
            max_length=300,
        ),
    ]
    paper_abstract: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("paperAbstract", "paper_abstract"),
            serialization_alias="paperAbstract",
            min_length=150,
        ),
    ]
    methods: Annotated[str, Field(min_length=100)]
    experiments: Experiments
    results: Annotated[str, Field(min_length=100)]
    references: Annotated[list[Reference], Field(min_length=5)]


class Evidence(ContractModel):
    claim: NonEmptyStr
    arxiv_id: Annotated[
        str,
        Field(
            validation_alias=AliasChoices("arxivId", "arxiv_id"),
            serialization_alias="arxivId",
            pattern=ARXIV_ID_PATTERN,
        ),
    ]
    relevance: NonEmptyStr


class ScientistOutput(ContractModel):
    evidence: Annotated[list[Evidence], Field(min_length=5)]
    proposal: Proposal


class ReviewFinding(ContractModel):
    issue: NonEmptyStr
    checked_with: Annotated[
        NonEmptyStr,
        Field(
            validation_alias=AliasChoices("checkedWith", "checked_with"),
            serialization_alias="checkedWith",
        ),
    ]


class Review(ContractModel):
    verdict: Literal["pass", "revise"]
    findings: Annotated[list[ReviewFinding], Field(min_length=1)]
    required_changes: list[NonEmptyStr] = Field(
        validation_alias=AliasChoices("requiredChanges", "required_changes"),
        serialization_alias="requiredChanges",
    )

    @model_validator(mode="after")
    def validate_verdict_changes(self) -> Review:
        if self.verdict == "pass" and self.required_changes:
            raise ValueError("pass 时 requiredChanges 必须为空")
        if self.verdict == "revise" and not self.required_changes:
            raise ValueError("revise 时 requiredChanges 必须非空")
        return self
