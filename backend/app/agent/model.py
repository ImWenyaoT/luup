"""The sole Qwen/Bailian Responses wiring for the Python migration.

The model is explicit on every Agent, preventing a fallback to OPENAI_API_KEY.
`enable_thinking` is injected through the Python SDK's Responses `extra_body`;
this is the Bailian-specific switch verified by the TypeScript implementation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from agents import ModelSettings, OpenAIResponsesModel, set_tracing_disabled
from openai import AsyncOpenAI

QWEN_DEFAULT_MODEL_ID = "qwen3.7-plus"
QWEN_CONTEXT_WINDOW_TOKENS = 131_072


@dataclass(frozen=True)
class QwenSettings:
    base_url: str
    api_key: str
    model_id: str = QWEN_DEFAULT_MODEL_ID

    @classmethod
    def from_environment(cls) -> QwenSettings:
        base_url = os.environ.get("QWEN_BASE_URL", "").strip()
        api_key = os.environ.get("QWEN_API_KEY", "").strip()
        if not base_url or not api_key:
            raise RuntimeError("QWEN_BASE_URL 和 QWEN_API_KEY 必须同时配置；不会回退到 OpenAI 默认客户端。")
        model_id = os.environ.get("LUUP_MODEL_ID", "").strip() or QWEN_DEFAULT_MODEL_ID
        return cls(base_url=base_url, api_key=api_key, model_id=model_id)


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
