from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.model import QWEN_DEFAULT_MODEL_ID, QwenSettings, qwen_model_settings

DOTENV = "QWEN_BASE_URL=https://dotenv.example/v1\nQWEN_API_KEY=dotenv-key\nLUUP_MODEL_ID=dotenv-model\n"


@pytest.fixture
def repo_with_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把仓根指到 tmp_path 并在那里放一个 `.env`；QWEN_* 一律先清空。"""
    (tmp_path / ".env").write_text(DOTENV, encoding="utf-8")
    monkeypatch.setenv("LUUP_REPO_ROOT", str(tmp_path))
    for name in ("QWEN_BASE_URL", "QWEN_API_KEY", "LUUP_MODEL_ID"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def test_model_settings_keep_bailian_responses_compatibility_knobs() -> None:
    settings = qwen_model_settings(thinking=True)

    assert settings.extra_body == {"enable_thinking": True}
    assert settings.parallel_tool_calls is False
    assert settings.include_usage is None


def test_environment_requires_qwen_credentials_without_openai_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 仓根指到一个没有 .env 的空目录：这就是 CI 的形态，凭据缺失必须照旧抛错。
    monkeypatch.setenv("LUUP_REPO_ROOT", str(tmp_path))
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="QWEN_BASE_URL"):
        QwenSettings.from_environment()

    monkeypatch.setenv("QWEN_BASE_URL", "https://dashscope.example/v1")
    monkeypatch.setenv("QWEN_API_KEY", "test-only")
    assert QwenSettings.from_environment().model_id == QWEN_DEFAULT_MODEL_ID


def test_dotenv_supplies_credentials_when_environment_is_empty(repo_with_dotenv: Path) -> None:
    settings = QwenSettings.from_environment()

    assert settings.base_url == "https://dotenv.example/v1"
    assert settings.api_key == "dotenv-key"
    assert settings.model_id == "dotenv-model"


def test_process_environment_wins_over_dotenv(repo_with_dotenv: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """用户关心的正是这条：`export` 的值必须压过 `.env` 里的同名值。"""
    monkeypatch.setenv("LUUP_MODEL_ID", "exported-model")
    monkeypatch.setenv("QWEN_API_KEY", "exported-key")

    settings = QwenSettings.from_environment()

    assert settings.model_id == "exported-model"
    assert settings.api_key == "exported-key"
    # 环境里没给的那一项仍然由 .env 兜底。
    assert settings.base_url == "https://dotenv.example/v1"


def test_dotenv_is_found_from_any_cwd(repo_with_dotenv: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """`.env` 由仓根解析，与进程 cwd 无关——backend/ 起 uvicorn 与仓根跑 CLI 读到同一份。"""
    elsewhere = tmp_path / "backend" / "deeper"
    elsewhere.mkdir(parents=True)

    seen = []
    for cwd in (elsewhere, Path(elsewhere.anchor)):
        monkeypatch.chdir(cwd)
        seen.append(QwenSettings.from_environment().api_key)

    assert seen == ["dotenv-key", "dotenv-key"]
