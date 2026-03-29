# pdf-to-rag documentation

Docs are grouped by purpose. The **published npm tarball** includes everything under `docs/` (see `package.json` `files`).

## Site map

```mermaid
flowchart TB
  subgraph use [use — operators and integrators]
    U1[cli-library.md]
    U2[mcp.md]
  end
  subgraph onb [onboarding — first run]
    O1[mcp.md]
  end
  subgraph mgt [management — planning and specs]
    M1[requirements.md]
    M2[roadmap.md]
    M3[project.md]
  end
  subgraph arch [architecture — codebase]
    A1[overview.md]
  end
  subgraph con [contributing — Cursor and roles]
    C1[agents.md]
  end
  ROOT[README.md this file]
  ROOT --> use
  ROOT --> onb
  ROOT --> mgt
  ROOT --> arch
  ROOT --> con
```

| Section | Path | Audience |
|---------|------|----------|
| **Use** | [use/cli-library.md](./use/cli-library.md), [use/mcp.md](./use/mcp.md), [use/comparison.md](./use/comparison.md) | CLI, library imports, MCP hosts, ecosystem positioning; HTTP MCP also serves multi-page browser UI under `public/` (see [use/mcp.md § Web demo UI](./use/mcp.md#web-demo-ui-f19)) |
| **Onboarding** | [onboarding/mcp.md](./onboarding/mcp.md) | First MCP setup from a clone or install |
| **Management** | [management/requirements.md](./management/requirements.md), [management/roadmap.md](./management/roadmap.md) (**Phase 7 implementation playbook** for D6–D10 / F19 execution order), [management/project.md](./management/project.md) | **Requirements** (F/N/D), **phases** (0–7), **summary**, portfolio priorities, **testing methodology**, embedding reference |
| **Architecture** | [architecture/overview.md](./architecture/overview.md) | Layers, `src/` layout, ingest/query flows |
| **Contributing** | [contributing/agents.md](./contributing/agents.md) | Rules vs skills vs commands; `/pdf-*`; subagent roles |

Start with the root [README.md](../README.md) for install, CLI examples, and library snippet.

**Cursor (this repo):** Passive rules in [`.cursor/rules/`](../.cursor/rules/). Procedural **skills** in [`.cursor/skills/`](../.cursor/skills/) (`pdf-rag-*`). Manual **`/pdf-*` commands** in [`.cursor/commands/`](../.cursor/commands/). Subagents in [`.cursor/agents/`](../.cursor/agents/). Hooks: [`.cursor/hooks.json`](../.cursor/hooks.json) ([Cursor hooks](https://cursor.com/docs/hooks)). Full doc sync: **`/pdf-update-docs`**.

See [contributing/agents.md](./contributing/agents.md) for how rules, skills, and commands fit together ([reference article](https://www.ibuildwith.ai/blog/cursor-rules-skills-and-commands-oh-my-when-to-use-each/)).
