# versus-shapes

- **Package Manager:** pnpm
- **Linter:** oxlint
- **Formatter:** prettier

## After Editing

After editing files, check for type errors, and then format and lint only the files changed for the current task.

```sh
# Example
pnpm typecheck
# Run format and lint for only files modified
pnpm exec prettier --write src/main.ts src/shaders/fragment.ts
pnpm lint -- src/main.ts src/collision.ts
```

Avoid unless explicitly approved:

```sh
pnpm format
pnpm lint
```
