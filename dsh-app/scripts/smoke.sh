#!/usr/bin/env bash
# dsh 地基冒烟：三件事各验一次，全部走真实模型调用。
#   ① 百炼 route 通（中文问答）
#   ② session 日志落盘（jsonl.zstd，模型可见事实都在里面）
#   ③ 合成工具结构化输出在百炼上工作（subagent outputSchema → structured_output 工具）
#
# 用法：cd dsh-app && ./scripts/smoke.sh
# 凭据从仓根 .env 读入进程环境（`set -a` 导出，绝不回显）。
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ../.env ]]; then
  echo "smoke: 缺少仓根 .env（需要 QWEN_API_KEY / QWEN_BASE_URL）" >&2
  exit 1
fi

# 导出而不打印。dsh 的 !!js 表达式在组合期读 process.env，必须是真环境变量。
set -a
# shellcheck disable=SC1091
. ../.env
set +a

export DSH_HOME="$PWD/.dsh-home"
mkdir -p "$DSH_HOME"

DSH=(./node_modules/.bin/dsh --profile headless --patch ./cordis.patch.yml)

echo "== 0. 组合体检（无模型调用）=="
"${DSH[@]}" --dump-config >/dev/null
echo "组合可解析；bailian route 与默认模型已就位。"

echo
echo "== 1. 百炼 route + 会话落盘 =="
"${DSH[@]}" "用一句中文回答：北京到上海的高铁大约需要多少小时？只回答时长，不要解释。"

echo
echo "== 2. 结构化输出（合成工具，不依赖 response_format）=="
"${DSH[@]}" "必须使用 workflow 工具，不要自己直接回答。执行这个脚本：
const r = await agent('用一句中文回答：水在标准大气压下的沸点是多少摄氏度？并给出你对该答案的置信度(0到1之间的小数)', { schema: { type: 'object', properties: { answer: { type: 'string' }, confidence: { type: 'number' } }, required: ['answer', 'confidence'], additionalProperties: false } });
return r;
最后把 workflow 返回的 JSON 原样报告给我。"

echo
echo "== 3. 证据 =="
echo "会话日志根：$DSH_HOME/sessions"
find "$DSH_HOME/sessions" -name 'session.jsonl.zstd' -printf '  %p (%s bytes)\n'
echo "读取方式：zstd -dc <file> | jq ."
echo "验结构化输出是否真走了工具（而非模型自己拼 JSON）："
echo "  zstd -dc <child-session>/session.jsonl.zstd | grep structured_output"
