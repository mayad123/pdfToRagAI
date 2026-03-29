---
name: pdf-rag-docs-sync
description: >-
  pdf-to-rag: reconcile documentation with the codebase. Use after CLI, library API, MCP, or config
  changes; for full sync or DX-only polish (README, examples, Cursor files). Never invent features.
---

# pdf-rag documentation sync

**Goal:** Remove stale docs; align prose with code only.

## Source of truth (read in this order)

1. `package.json` — `name`, `version`, `description`, `bin`, `scripts`, `dependencies`, `exports`, `files`, `engines`
2. `src/cli.ts` + `src/commands/*.ts` — CLI subcommands and flags
3. `src/index.ts` — public library exports
4. `src/config/defaults.ts` — chunk size, overlap, store dir, model, topK, recursive
5. `src/mcp/server.ts` (+ `paths.ts`, `tool-results.ts` if needed) — tool names, args, structured outputs, error codes
6. `.cursor/commands/pdf-*.md` (including **`pdf-embeddings.md`**), `.cursor/agents/pdf-*.md`, `.cursor/skills/*/SKILL.md` — keep `docs/contributing/agents.md` and cross-links accurate

## Docs and config to align

- `README.md`
- `docs/README.md`, `docs/onboarding/mcp.md`, `docs/use/mcp.md`, `docs/use/cli-library.md`, `docs/architecture/overview.md`, `docs/management/roadmap.md`, `docs/management/project.md` (milestones / methodology narrative if reality changed)
- `docs/management/requirements.md` (if behavior vs F/N/D IDs changed)
- `docs/contributing/agents.md` (roles ↔ commands, agents, skills)
- `.cursor/rules/pdf-to-rag.mdc` (if layers or scripts changed materially)

## DX-only pass (when user wants tone/examples only)

- Focus on `README.md`, `docs/*`, `.cursor/commands/`, `.cursor/agents/`, examples in `docs/use/mcp.md`.
- Verify CLI/MCP claims against `src/cli.ts`, `src/commands/`, `src/mcp/server.ts`.
- Keep `package.json` `scripts` / `bin` listings in docs accurate (`build`, `dev`, `mcp:smoke`, `examples:smoke`, `examples:fixtures`, `eval:generate`, `eval:run`, `eval:compare`).
- Prefer copy-pasteable snippets (absolute-path placeholders for MCP where needed).
- If only tone is requested, keep structure/tables unless factually wrong.

## Rules

- **Do not** document unimplemented features.
- **Do not** edit `.cursor/plans/` unless the user explicitly asks.
- After claiming build/MCP health, run `npm run build` and `npm run mcp:smoke` (or instruct the user) and report real outcomes only.
- Prefer minimal edits; fix wrong paths, env names, missing `pdf-to-rag-mcp`, outdated tool lists.

## Deliverable

1. Apply edits in the repo.
2. Summarize: **file → what was stale → what changed.**
