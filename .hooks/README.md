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
| `pre-commit` | Runs `npm run build` so broken TypeScript cannot be committed. |

## Bypass

```bash
SKIP_HOOKS=1 git commit -m "message"
```

Use sparingly (e.g. WIP commits you will fix before push).
