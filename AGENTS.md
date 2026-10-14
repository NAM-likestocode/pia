# Pia

Windows desktop helper for a non-technical older German user. Read `README.md` and `docs/protocol.md` first.

## Hard rules

- The model must never get a tool that deletes, moves, renames, runs commands, or reaches outside the Pia folder. `tests/pia.test.ts` pins the exact tool list. Change it only on purpose.
- Every file path from the model goes through `Jail.resolve` (`helper/src/jail.ts`). Every overwrite goes through `History.save` first.
- Limits live in `helper/src/budget.ts` and are enforced in code (`Pia.guard`), not only in the prompt.
- pi runs with an empty `ResourceLoader`: no extensions, skills, prompt templates, context files or MCP. Never switch to `DefaultResourceLoader`, because her folder could then inject instructions.
- Everything she sees is simple German with "du". Helper texts go in `helper/src/strings.ts`, window texts in `ui/src/strings.ts`. `tests/strings.test.ts` rejects technical words. Only the `helper` namespaces (for the son) are exempt.
- The window gets no Tauri permissions beyond `core:default`, `updater:default` and `process:allow-restart`.

## Commands

- `npm test`: all tests. They use pi's fake model, so they need no network or login.
- `npm run typecheck`
- `npx vite`: window only, with a fake helper.
- `npm run dev`: the full app.
