"""Agent = Model + Harness；harness 是运行时角色不是子目录（同 eve）：
orchestrator/artifacts/verifier 即 harness 本体，tools/ 由它执行。无 FastAPI 依赖。"""

from .orchestrator import Harness, RunOutcome
from .verifier import FileReferenceVerifier

__all__ = ["FileReferenceVerifier", "Harness", "RunOutcome"]
