from __future__ import annotations

import pytest

from app.agent.model import QWEN_DEFAULT_MODEL_ID, QwenSettings, qwen_model_settings


def test_model_settings_keep_bailian_responses_compatibility_knobs() -> None:
    settings = qwen_model_settings(thinking=True)

    assert settings.extra_body == {"enable_thinking": True}
    assert settings.parallel_tool_calls is False
    assert settings.include_usage is None


def test_environment_requires_qwen_credentials_without_openai_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="QWEN_BASE_URL"):
        QwenSettings.from_environment()

    monkeypatch.setenv("QWEN_BASE_URL", "https://dashscope.example/v1")
    monkeypatch.setenv("QWEN_API_KEY", "test-only")
    assert QwenSettings.from_environment().model_id == QWEN_DEFAULT_MODEL_ID
