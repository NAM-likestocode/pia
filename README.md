# Pia

Pia is a small Windows app that gives someone who is not comfortable with computers a patient AI helper, using your ChatGPT subscription, with firm limits on what it can do.

She can ask Pia to:

- write letters and documents (Word or PDF)
- make lists and spreadsheets (Excel or CSV)
- build small, self-contained web pages
- explain photos and screenshots, and warn about scams
- open the right Windows settings page and walk her through it step by step

Everything Pia says is in simple German and addresses her with "du".

## What Pia cannot do

These limits are enforced in code, not only requested in the instructions:

| Limit | How |
|---|---|
| Only one folder (`Dokumente\Pia`) | Every path goes through `helper/src/jail.ts`, which refuses `..`, drive letters, network paths, `:` streams, reserved names, hidden names, 8.3 short names, and symlinks/junctions. |
| Nothing is deleted | There is no delete, move or rename tool. Every change copies the old version into a hidden history folder, and every version can be brought back, from the app or by asking Pia. |
| No commands or programs | pi runs with **no** built-in tools: no shell, no read/write/edit, no extensions, skills, MCP or context files. A test checks the exact tool list. Windows settings come from a fixed list of `ms-settings:` pages. PC info uses fixed commands. Only document, table, web and image files can be opened. |
| Small by default | Each request may make 3 new files and take 15 steps. More requires her to tap **"Ja, mach das"** on a plain-language question, and there is a hard ceiling beyond that. You can change these in the helper settings. |
| No reach into your ChatGPT | She signs in with a device code that **you** approve on your phone, so her browser is never logged into your ChatGPT account. The Codex API that Pia uses cannot see your ChatGPT chats. Her conversations are stored only on her PC. |
| Usage limits explained | When the subscription limit is reached, Pia says exactly when she will be back ("In 2 Stunden und 15 Minuten bin ich wieder da (um 16:40 Uhr)"), shows a countdown, and sends nothing until then. |

## How it is built

```
ui/          window: plain TypeScript + Vite, shown by Tauri (WebView2 on Windows)
src-tauri/   Rust shell: window, starts the helper, passes messages, installs updates
helper/      Bun-compiled executable: pi SDK + Pia's tools, folder lock, limits
docs/        protocol between window and helper; German setup guide
```

The window cannot run programs or touch files. It can only send messages to the helper (`helper_send`), check for and install updates, and restart the app. See [`docs/protocol.md`](docs/protocol.md).

The stored ChatGPT login is encrypted with AES-256-GCM. The key is kept in the Windows Credential Manager.

## Develop

Requirements: Node 24+, Rust (stable), and the Tauri Linux dependencies (`webkit2gtk-4.1`) when developing on Linux.

```sh
npm ci
npm test                 # unit and end-to-end tests (fake model, no network)
npm run typecheck
npx vite                 # window only, with a built-in fake helper, at http://localhost:1420
npm run dev              # the real app: builds the helper, starts Tauri
```

`npm run helper -- --data-dir /tmp/pia-data --workspace /tmp/Pia` runs the helper from source. Send it JSON lines on stdin, starting with a `boot` line (see the protocol doc).

## Release a new version

One-time setup:

1. The updater signing key is in `~/.tauri/pia.key`, with its password in `~/.tauri/pia.key.password`. Keep both safe: without them you cannot ship updates to the installed app.
2. Add both as repository secrets:
   ```sh
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/pia.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/pia.key.password
   ```

For each release:

1. Bump `version` in `package.json`.
2. If older versions must not be used any more, also raise `minimumVersion` in `update-policy.json`. Older copies will then show only the update button.
3. Commit, then run `git tag v1.2.3 && git push --tags`.

GitHub Actions builds the Windows installer and publishes it with a signed `latest.json`. Pia checks for updates at start and every 4 hours, and shows "Es gibt eine neue Version von Pia. [Jetzt aktualisieren]".

## First install on her PC

See [`docs/einrichtung.md`](docs/einrichtung.md).

## License

MIT
