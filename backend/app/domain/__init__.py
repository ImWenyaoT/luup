"""Luup 的纯领域契约与确定性规则。

这里不依赖 FastAPI、Agent SDK、数据库或路由；Harness 只消费这些稳定输入输出。
"""

from .contracts import Proposal, Reference, Review, ScientistOutput
from .science125 import find_question, read_science125

__all__ = [
    "Proposal",
    "Reference",
    "Review",
    "ScientistOutput",
    "find_question",
    "read_science125",
]
