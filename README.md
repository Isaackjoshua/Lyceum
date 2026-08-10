# Lyceum

A cross-platform desktop app where anyone can be **taught** by Claude — not just
answered by it.

Most "AI tutor" apps are a chat box with a study-buddy prompt. They hand over
answers, which produces learners who can't do the thing. Lyceum's differentiator
is the **teaching harness**: an orchestration layer that turns raw API calls into
a disciplined tutor with a persistent curriculum, tracked progress, inline note
capture, active-recall review, and PDF export.

**Bring your own key.** Lyceum ships with no Anthropic API key. You supply your
own; it is encrypted by your operating system's keychain and never leaves your
machine except in calls to Anthropic, billed to your own account.

---

## Status

| Phase | Scope | State |
|---|---|---|
| **0** | Scaffold, secure window, typed IPC, SQLite + migrations, key vault, Settings | ✅ Done |
| 1 | Curriculum architect, streaming tutor chat, inline notes, per-module PDF | Next |
| 2 | Quizzes + mastery, FSRS flashcard review, inline visuals, dashboard | Planned |
| 3 | Sandboxed widgets, context summarization, cost caps, backup/restore | Planned |

---

## Requirements

- **Node.js 20.11+** (developed on 22.x)
- **npm 10+**
- An Anthropic API key from <https://console.anthropic.com>
- A working OS keychain:
  - macOS — Keychain (built in)
  - Windows — DPAPI (built in)
  - Linux — `gnome-keyring` or `kwallet` must be running

If no keychain is available, Lyceum **refuses to store your key** rather than
writing it to disk in plaintext.

## Setup

```bash
npm install     # also rebuilds better-sqlite3 for Electron's ABI
npm run dev     # launch with hot reload
```

Other scripts:

```bash
npm run build       # typecheck + bundle main, preload and renderer
npm start           # preview the production build
npm test            # unit tests (Vitest)
npm run typecheck   # strict TS across both tsconfigs
npm run dist        # package a distributable via electron-builder
```

### Linux: one-time sandbox setup

Chromium's setuid sandbox helper must be owned by root. If the app aborts with
*"The SUID sandbox helper binary was found, but is not configured correctly"*,
run once per `npm install`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

This is a local development-environment requirement; packaged builds handle it
through the installer.

---

## First run

1. Launch the app and open **Settings**.
2. Paste your `sk-ant-…` key and press **Save**. It is encrypted immediately.
3. Press **Test connection** — Lyceum makes one tiny call (a few tokens on the
   cheapest model) to prove the key works.
4. Pick a tutor model and effort level. Background work (flashcards, summaries)
   always uses the cheapest model regardless of this setting.

Your database lives at the path shown under **Settings → Data**. Back it up by
copying that single `.sqlite` file.

---

## Where things live

```
lyceum/
├─ config/models.ts       # model IDs + pricing — the only place these appear
├─ src/
│  ├─ main/               # Node. Owns the key, the database, and all API calls.
│  │  ├─ db/              #   better-sqlite3 + versioned migrations
│  │  ├─ security/        #   safeStorage key vault
│  │  ├─ ipc/             #   typed handlers + input validation
│  │  └─ harness/         #   THE CORE: Anthropic client, prompts, tools
│  ├─ preload/            # contextBridge whitelist (window.api)
│  ├─ shared/types.ts     # the main <-> renderer contract
│  └─ renderer/           # React UI. No Node, no network, no key.
└─ tests/                 # Vitest
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data flow and the harness
design.

---

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- A strict Content-Security-Policy; no remote script, no remote origins
- Every IPC channel is whitelisted in the preload bridge and validated in main
- The API key is confined to the main process and is never logged, never sent
  over IPC, and never written in plaintext
- External links open in the system browser; in-app navigation off-origin is
  blocked; all permission requests are denied

## License

MIT
