# luup Agent App

This project is built on the OpenAI Agents SDK (`@openai/agents`), driving Qwen (Bailian) through its OpenAI-compatible Responses endpoint. Before writing agent code, consult the SDK docs at <https://openai.github.io/openai-agents-js/> (a source clone lives at `../oss/openai-agents-js` for exact signatures). Model wiring facts live in `agent/lib/model.ts` — read them before touching anything model-related.

## Project docs

- Acceptance criteria (the verification anchor): `docs/design/criteria.md`
- Architecture (master-verify loop, DAG, no-RAG literature layer): `docs/design/architecture.md`
- Competition spec: `docs/specs/`

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `ImWenyaoT/luup`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
