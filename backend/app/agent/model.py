"""The sole Qwen/Bailian Responses wiring for the Python migration.

The model is explicit on every Agent, preventing a fallback to OPENAI_API_KEY.
`enable_thinking` is injected through the Python SDK's Responses `extra_body`;
this is the Bailian-specific switch verified by the TypeScript implementation.
"""

from __future__ import annotations

from agents import ModelSettings, OpenAIResponsesModel, set_tracing_disabled
from openai import AsyncOpenAI
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.runs import repo_root

QWEN_DEFAULT_MODEL_ID = "qwen3.7-plus"

QWEN_THINKING_ENABLED = False
"""The single truth for Bailian's `enable_thinking`.

It reaches the model through `qwen_model_settings` and reaches usage.jsonl through
`SpecialistResult.thinking`. Two independent literals is how the accounting once
claimed thinking was on while every request sent it off.
"""


class QwenSettings(BaseSettings):
    """接线所需的三个值；直接构造只认显式入参，`from_environment` 才去读环境与仓根 `.env`。

    优先级由 pydantic-settings 的默认源顺序保证：显式入参 > 系统环境变量 > `.env` 文件。
    也就是说 `.env` 只是兜底，`export QWEN_API_KEY=...` 永远压过文件里的同名值。
    """

    model_config = SettingsConfigDict(
        env_ignore_empty=True,
        extra="ignore",
        frozen=True,
        populate_by_name=True,
    )

    base_url: str = Field(default="", validation_alias="QWEN_BASE_URL")
    api_key: str = Field(default="", validation_alias="QWEN_API_KEY")
    model_id: str = Field(default=QWEN_DEFAULT_MODEL_ID, validation_alias="LUUP_MODEL_ID")

    @field_validator("base_url", "api_key", mode="after")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("model_id", mode="after")
    @classmethod
    def _strip_model_id(cls, value: str) -> str:
        return value.strip() or QWEN_DEFAULT_MODEL_ID

    @classmethod
    def from_environment(cls) -> QwenSettings:
        # `.env` 的位置由仓根决定，所以每次调用现算：`LUUP_REPO_ROOT` 可能在进程启动后才被设置，
        # 而 cwd（backend/ 起 uvicorn、backend/ 跑 CLI、测试从别处跑）不参与解析。
        settings = cls(_env_file=repo_root() / ".env")
        if not settings.base_url or not settings.api_key:
            raise RuntimeError("QWEN_BASE_URL 和 QWEN_API_KEY 必须同时配置；不会回退到 OpenAI 默认客户端。")
        return settings


def qwen_model(settings: QwenSettings) -> OpenAIResponsesModel:
    """Create an HTTP Responses model pointed only at Bailian."""
    set_tracing_disabled(True)
    client = AsyncOpenAI(api_key=settings.api_key, base_url=settings.base_url)
    return OpenAIResponsesModel(model=settings.model_id, openai_client=client)


def qwen_model_settings(*, thinking: bool) -> ModelSettings:
    """Preserve the existing no-thinking default without adding Chat-only knobs."""
    return ModelSettings(
        extra_body={"enable_thinking": thinking},
        parallel_tool_calls=False,
    )
