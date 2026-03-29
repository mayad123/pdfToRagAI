# Git hooks (versioned)

Hooks in this directory are **not** active until Git is told to use them.

## Enable (once per clone)

```bash
npm run hooks:install
```

That runs `git config core.hooksPath .hooks` (path is relative to the repository root).

## Hooks

| File | Purpose |
|------|---------|
| `pre-commit` | Runs **`npm run build`** then **`npm test`** so broken TypeScript or failing unit tests cannot be committed. |

**Not** run in the hook (run manually or in CI when needed): `npm run mcp:smoke`, `npm run examples:smoke`, `npm run examples:fixtures` — they are heavier or need more setup.

## Bypass

```bash
SKIP_HOOKS=1 git commit -m "message"
```

Use sparingly (e.g. WIP commits you will fix before push).
