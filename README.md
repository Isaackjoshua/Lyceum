# Lyceum

A cross-platform desktop app where anyone can be **taught** by Claude — not just
answered by it.

Most "AI tutor" apps are a chat box with a study-buddy prompt. They hand over
answers, which produces learners who can't do the thing. Lyceum's differentiator
is the **teaching harness**: an orchestration layer that turns raw API calls into
a disciplined tutor with a persistent curriculum, tracked progress, inline note
capture, active-recall review, and PDF export.

**Bring your own key, and your own model.** Lyceum ships with no API key and is
not tied to any one vendor. Use Claude, GPT, Kimi, or an open-weight model
running on your own machine — keys are encrypted by your operating system's
keychain and never leave your computer except in calls to the provider you
chose, billed to your own account.

---

## Status

| Phase | Scope | State |
|---|---|---|
| **0** | Scaffold, secure window, typed IPC, SQLite + migrations, key vault, Settings | ✅ Done |
| **1** | Curriculum architect, streaming tutor chat, inline notes, per-module PDF | ✅ Done |
| **2** | Quizzes + mastery, FSRS flashcard review, inline visuals, dashboard | ✅ Done |
| **3** | Sandboxed widgets, context summarization, cost caps, backup/restore | ✅ Done |
| **4** | Multi-provider support: OpenAI, Kimi, OpenRouter, Groq, local models | ✅ Done |

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
- A key from at least one provider — or nothing at all, if you run models
  locally with Ollama or LM Studio
- A working OS keychain (not needed for local-only use):
  - macOS — Keychain (built in)
  - Windows — DPAPI (built in)
  - Linux — `gnome-keyring` or `kwallet` must be running

If no keychain is available, Lyceum **refuses to store your key** rather than
writing it to disk in plaintext. Local providers still work in that case,
since they need no key.

## Providers

| Provider | Needs a key | Notes |
|---|---|---|
| Anthropic | yes | Claude models. The strongest tutoring quality today. |
| OpenAI | yes | GPT models. |
| Moonshot | yes | Kimi models. Ids move quickly — type the current one. |
| OpenRouter | yes | One key, hundreds of models including most open-weight ones. |
| Groq | yes | Open-weight models, very fast. |
| Together AI | yes | Hosted open-weight models. |
| Ollama | **no** | Runs on your machine. Free and works offline. |
| Custom | usually | Any other OpenAI-compatible endpoint. |

You pick two models in Settings: one for **tutoring** and one for **background
work** (summaries, flashcards, grading). They can be on different providers —
teach on Claude and run background jobs on a local model, for instance.

Model ids for the aggregators and local runtimes are typed in by you rather
than picked from a fixed list, because those catalogs change far faster than
this app does. The presets are a starting point, not a closed set.

**A caveat worth knowing.** Lyceum leans on tool calling — it is how the tutor
marks objectives, how curricula and quizzes get their structure, and how notes
become flashcards. Most current models support it natively. For models that do
not, Lyceum falls back to a prompted-JSON protocol that works but is less
reliable; Settings tells you when a chosen model is in that category.

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

## Building an installable version

```bash
npm run dist:linux   # AppImage + .deb  → release/
npm run dist:win     # NSIS installer + portable .exe
npm run dist:mac     # .dmg + .zip
npm run dist:dir     # unpacked directory only, for a quick check
```

Artifacts land in `release/`. electron-builder can only produce a macOS build on
macOS; Windows builds cross-compile from Linux but are unsigned, so SmartScreen
will warn on first run.

### Installing on Linux

The `.deb` is the path that needs no fiddling:

```bash
sudo apt install ./release/Lyceum-0.1.0-linux-amd64.deb
lyceum
```

Its install script deals with the Chromium sandbox for you. That is worth a word
of explanation, because it is the one thing most likely to go wrong.

Chromium isolates its renderer processes either with an unprivileged user
namespace or with a setuid helper, and it refuses to start with neither — a hard
abort, not a quiet downgrade. Ubuntu 24.04 and later set
`kernel.apparmor_restrict_unprivileged_userns=1`, which denies user namespaces to
any binary without an AppArmor profile granting them. So on a current Ubuntu the
install script writes `/etc/apparmor.d/lyceum`, a four-line profile granting that
one permission to that one binary, and the namespace sandbox works normally.
Where AppArmor is older or absent, it falls back to the setuid helper instead.
Removing the package removes the profile.

The **AppImage** has no install step, so neither fix can be applied for you.
On Ubuntu 24.04+ you will need to either install the same profile by hand
(pointing the path at wherever you keep the AppImage) or run it with
`--no-sandbox`, which is a real reduction in isolation and not recommended for
everyday use. The AppImage also needs FUSE 2 — `sudo apt install libfuse2t64` —
or it can be run as `./Lyceum-*.AppImage --appimage-extract-and-run`.

If you are on a distribution without these restrictions, both artifacts run as-is.

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
  q
  we

## License

MIT
