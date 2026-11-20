# Working rules

- Node >= 22.18 runs `.ts` directly via type stripping. So: no `enum`, no `namespace`, no constructor
  parameter properties, use `import type` for types, and always import with the `.ts` extension.
- Zero runtime dependencies. Use node built-ins (`node:test`, `node:child_process`, `node:fs`).
- Determinism matters: the map of commit N must not depend on how you got there or on later commits. Sort
  with the codepoint `cmp()` in `lib/snapshot.ts`, never `localeCompare`.
- Bump `LAYOUT_VERSION` in `lib/layout.ts` whenever the map of a given history changes; it is part of the
  cache key.
- Keep `SKILL.md` in step with the CLI: every option and both file formats are documented there.
- Tests: `npm test` (node:test, `test/*.test.ts`), on temp repos built with real git.
- Taste or judgment calls: make a reasonable default, note it in NOTES.md, keep going.
