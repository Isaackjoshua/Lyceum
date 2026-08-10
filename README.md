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
| **1** | Curriculum architect, streaming tutor chat, inline notes, per-module PDF | ✅ Done |
| **2** | Quizzes + mastery, FSRS flashcard review, inline visuals, dashboard | ✅ Done |
| **3** | Sandboxed widgets, context summarization, cost caps, backup/restore | ✅ Done |

All four phases are complete.

### What works today

- **Build a curriculum.** Give a subject and a goal. The architect asks one
  calibrating question, then drafts a syllabus. Every module, objective and
  estimate is editable — and reorderable — before anything is saved.
- **Get taught.** Open a module and the tutor diagnoses before it teaches, moves
  one step per turn, and holds the line when you ask it to just give you the
  answer. Replies stream, with markdown, KaTeX maths and highlighted code.
- **Track progress.** Tick objectives yourself, or let the tutor mark one met
  when you actually demonstrate it. Module status and progress bars follow.
- **Capture notes inline.** Select any passage in a tutor reply and save it as a
  typed, tagged note — type and title are guessed from the text. Notes live in a
  side drawer with search and per-type filters.
- **Export a study guide.** Any module exports to a typeset PDF: a Claude-written
  summary, your objectives with their status, and your own notes. Cover page,
  contents, page numbers, real KaTeX maths. Works offline apart from the summary.
- **Take a checkpoint.** The tutor offers one when a chunk of material is
  genuinely finished, or you can ask any time. Questions are scoped to what you
  actually covered; multiple choice grades locally, written and code answers get
  graded against a rubric with feedback that names the gap.
- **Review with spaced repetition.** Turn a module's notes into flashcards, then
  review them on an FSRS schedule. Grade Again/Hard/Good/Easy — the buttons show
  what each choice schedules. Reviewing works entirely offline.
- **See where you actually are.** The dashboard shows completion, a streak, time
  on task, per-module mastery, and the modules worth revisiting — derived from
  quiz scores and the cards you keep forgetting, not from time spent.
- **Diagrams inline.** When a concept has shape, the tutor draws it. Mermaid and
  SVG render in the transcript, sanitised before they touch the DOM.

- **Interact, not just look.** When moving something is the only way to see the
  point, the tutor can build a small widget. It runs in a sandboxed frame with
  no access to the app and no network at all.
- **Learn for as long as you like.** Long sessions fold older turns into a
  running summary, so context stays bounded and continuity is preserved. Each
  turn is summarised exactly once.
- **Know what it costs.** Per-session and per-month spend are shown from your
  own token usage. Set a monthly cap to be warned at 80% — and optionally
  blocked at 100%, though the default is to warn and keep teaching.
- **Own your data.** Back up to a single self-contained file, restore from one,
  archive curricula you are done with, or delete everything.

Mastery is deliberately evidence-based: it stays at zero until you take a
checkpoint or review some cards. Reading does not move it.

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
