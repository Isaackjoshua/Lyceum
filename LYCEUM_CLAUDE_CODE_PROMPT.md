# Claude Code Build Prompt — "Lyceum": a Claude-powered tutoring desktop app

> **What this is:** a complete specification you hand to Claude Code to build a cross-platform desktop app in which anyone can be *taught* by Claude — not just answered by it. The differentiator is a **teaching harness**: the orchestration layer that turns raw API calls into a disciplined tutor with a persistent curriculum, progress state, inline note capture, active-recall review, and PDF export.
>
> **Working name:** *Lyceum* (rename freely). **Bring-your-own-key (BYOK):** each user supplies their own Anthropic API key; the app ships with none.

---

## 0. How to use this prompt (instructions to Claude Code)

- **Build in phases.** Implement Phase 0, run it, verify it against the acceptance criteria, *then* move on. Do not scaffold all phases at once.
- **The harness is the core.** Put prompt assembly, tool definitions, the Anthropic client, and context management in a dedicated `src/main/harness/` module. Treat it as the product's engine; everything else is UI around it.
- **Security is non-negotiable.** The Anthropic key lives **only in the Electron main process**. It is never exposed to the renderer, never placed in `localStorage`, never logged. All Anthropic calls originate in main.
- **Ask before changing the stack** or adding a heavy dependency (anything that pulls a large native toolchain or bloats the bundle). Small, composable modules over cleverness.
- **Verify the moving parts.** Before finalizing config defaults, confirm the **current Anthropic model IDs and per-model pricing** from the official docs — do not trust hardcoded values in this document as permanent. Put model IDs and pricing in `config/models.ts`, not inline.
- **Keep docs current.** Maintain `README.md` (setup/run) and `ARCHITECTURE.md` (data flow, harness design) as you go. Commit at each milestone.
- **Don't reproduce Anthropic's `learn` skill verbatim.** Implement the *methodology* in the app's own system prompts (§8, Appendix A). The pedagogy below is a faithful re-expression, not a copy.

---

## 1. Mission & product vision

Most "AI tutor" apps are a chat box with a study-buddy prompt. They hand over answers, which produces learners who can't do the thing. **Lyceum encodes real tutoring discipline** and wraps it in the scaffolding a serious self-learner needs:

1. **Teaching, not answering.** The tutor diagnoses where the learner is, moves them one step forward every turn, and holds the line when they beg for the answer — while still knowing when a genuinely stuck learner needs a foothold. (Full pedagogy in §8.)
2. **A curriculum you can track.** Tell Lyceum what you want to learn; it proposes a structured, editable curriculum (modules → objectives). Your progress through it is first-class state, not vibes.
3. **Instant inline notes.** Select any concept, theorem, or insight in the tutor's reply and save it as a typed, tagged note in one click. The tutor can also proactively offer to save a key idea.
4. **Active recall built in.** Notes become spaced-repetition flashcards; checkpoints become quizzes; both feed a real mastery signal.
5. **PDF summaries and study guides.** Export a module summary, a full-curriculum study guide, or a notes collection as a clean, typeset PDF.

**Target user:** a motivated self-learner (student brushing up, career-changer, hobbyist going deep) who wants durable understanding, owns the process, and is comfortable pasting an API key. Works offline for everything except live generation.

---

## 2. Tech stack (committed)

**Primary stack — build this:**

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** (latest stable) | Node main process runs the official Anthropic SDK directly (best DX for streaming + tool use); key stays in main. |
| Bundler | **electron-vite** + **Vite** | Fast HMR, clean main/preload/renderer split. |
| UI | **React 18** + **TypeScript** (strict) | |
| Styling | **Tailwind CSS** + **shadcn/ui** (Radix primitives) + **lucide-react** | Fast, accessible, themeable. |
| Client state | **Zustand** | Lightweight; SQLite remains the source of truth. |
| Persistence | **SQLite** via **better-sqlite3** (synchronous, in main) | Simple, fast, transactional; exposed to renderer over typed IPC. |
| Migrations | Hand-rolled versioned migrations in `src/main/db/migrations/` | Deterministic schema evolution. |
| Anthropic | **@anthropic-ai/sdk** (main process only) | Streaming, tool use, structured outputs. |
| Key storage | Electron **`safeStorage`** (OS keychain: Keychain / DPAPI / libsecret) → ciphertext on disk | Encrypted at rest, no plaintext key ever. |
| Markdown | **react-markdown** + `remark-gfm` + `remark-math` + `rehype-katex` + syntax highlighting (**Shiki** or highlight.js) | Math (KaTeX) and code are mandatory for STEM tutoring. |
| Diagrams | **Mermaid** + inline **SVG** rendering | For the tutor's "show, don't tell" visual move. |
| Spaced repetition | **ts-fsrs** (FSRS algorithm) | Better retention scheduling than naive SM-2. |
| PDF | Electron **`webContents.printToPDF`** on a hidden `BrowserWindow` rendering styled HTML | Native, dependency-light, full CSS control, reuses the markdown/KaTeX styling. |
| Testing | **Vitest** (unit) + **Playwright** (e2e, optional in later phases) | |

**Alternative stack (note only, do not build unless asked):** *Tauri v2 + React*. Smaller bundle and stronger sandboxing, but the backend is Rust, so you'd reimplement the Anthropic client with `reqwest` + SSE streaming, store the key via `tauri-plugin-keyring`/Stronghold, and use `tauri-plugin-sql`. More work; choose only if bundle size/security outweighs SDK convenience.

---

## 3. Architecture

```
┌──────────────────────────── Renderer (React, sandboxed) ────────────────────────────┐
│  UI: Curriculum tree · Tutor chat (stream) · Notes panel · Review · Dashboard · PDF  │
│  Zustand UI store · react-markdown/KaTeX/Mermaid · shadcn components                 │
└───────────────▲───────────────────────────────────────────────────────────┬─────────┘
                │  typed IPC (contextIsolation ON, nodeIntegration OFF)       │
        preload bridge (window.api.*, whitelisted channels, input validation)│
                │                                                             ▼
┌───────────────┴──────────────────────── Main (Node) ─────────────────────────────────┐
│  IPC handlers  →  Services (curriculum, session, notes, quiz, srs, export, usage)     │
│                                                                                       │
│  ┌──────────────── Teaching Harness (src/main/harness/) — THE CORE ───────────────┐  │
│  │  promptAssembler · contextManager · toolRegistry · anthropicClient · modes     │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│  SQLite (better-sqlite3)   ·   safeStorage key vault   ·   Anthropic API (HTTPS)      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow (a tutor turn):** renderer sends the learner's message over IPC → `session` service loads module + objectives + running summary + recent transcript → `contextManager` assembles the request within a token budget → `anthropicClient` streams the response → deltas relay to the renderer over IPC as they arrive → any tool calls (suggest note, render visual, mark objective, propose quiz) execute in main and stream their results/UI hints back → transcript and any state changes persist to SQLite.

---

## 4. Data model (SQLite)

Use integer PKs, `created_at`/`updated_at` timestamps (ISO strings or epoch ms), and indices on all FKs plus `flashcards.due` and `messages.session_id`.

```
curricula(id, title, subject, goal, learner_level, status['active'|'archived'], created_at, updated_at)
modules(id, curriculum_id→curricula, title, summary, order_index,
        status['not_started'|'in_progress'|'completed'], mastery REAL[0..1], created_at, updated_at)
objectives(id, module_id→modules, text, order_index, status['open'|'met'])
sessions(id, module_id→modules, started_at, ended_at, state_summary TEXT)   -- rolling summary of what's covered
messages(id, session_id→sessions, role['user'|'assistant'|'tool'], content TEXT, meta_json TEXT, created_at)
notes(id, curriculum_id, module_id, session_id, message_id,
      type['concept'|'definition'|'theorem'|'principle'|'insight'|'example'|'question'],
      title, content TEXT, annotation TEXT, source_excerpt TEXT, tags_json TEXT, created_at, updated_at)
flashcards(id, note_id→notes, module_id, front TEXT, back TEXT, fsrs_json TEXT, suspended INT, created_at)
reviews(id, flashcard_id→flashcards, reviewed_at, rating[1..4])            -- FSRS grade log
quizzes(id, module_id→modules, created_at)
quiz_questions(id, quiz_id→quizzes, type['mcq'|'short'|'code'], prompt TEXT, options_json TEXT, answer TEXT, explanation TEXT, order_index)
quiz_attempts(id, quiz_id→quizzes, taken_at, score REAL, responses_json TEXT)
events(id, ts, type['session_start'|'session_end'|'review'|'quiz'|'note'], payload_json)  -- streak/time-on-task
settings(key PRIMARY KEY, value TEXT)   -- model, temperature, max_tokens, spend_cap, theme, data_dir, key_present flag
```

`fsrs_json` holds the ts-fsrs card state (`due`, `stability`, `difficulty`, `reps`, `lapses`, `state`, `last_review`). **Mastery** per module = weighted blend of latest quiz score and flashcard retention (share of module cards in `Review`/`good` state). **Streak** and **time-on-task** derive from `events`.

---

## 5. The teaching harness (`src/main/harness/`)

The harness is a small set of cooperating pieces. Keep them pure and testable.

- **`anthropicClient.ts`** — thin wrapper over `@anthropic-ai/sdk`. Handles streaming (`client.messages.stream(...)`), tool-use loops, ret/backoff on 429/5xx, and 401 → surface "invalid key." Emits token `usage` for cost tracking.
- **`promptAssembler.ts`** — builds the system prompt per **mode** (§8, Appendix A) and composes the messages array.
- **`contextManager.ts`** — assembles the per-turn context block and enforces a token budget: curriculum goal → current module + objectives (with status) → `state_summary` → titles of the learner's notes for this module → last *N* verbatim messages. When the transcript exceeds budget, call the **summarizer** mode to fold older turns into `state_summary`, keep the last *N* verbatim.
- **`toolRegistry.ts`** — the Anthropic tool definitions (Appendix B) plus their main-process executors. When the model calls a tool, execute it, persist effects, feed the `tool_result` back into the loop, and push a UI hint to the renderer.
- **`modes.ts`** — the five operating modes below, each = a system prompt + an allowed tool set + a model choice.

### Modes

| Mode | Purpose | Model (default) | Tools |
|---|---|---|---|
| **Curriculum architect** | Topic + brief diagnostic → structured curriculum | `claude-sonnet-5` | `propose_curriculum` |
| **Tutor** | The main teaching loop | `claude-sonnet-5` | `mark_objective`, `suggest_note`, `render_visual`, `propose_quiz` |
| **Assessor** | Generate a checkpoint quiz | `claude-sonnet-5` | `generate_quiz` |
| **Card smith** | Turn a module's notes into flashcards | `claude-haiku-4-5-20251001` | `generate_flashcards` |
| **Summarizer** | Module/curriculum summaries + `state_summary` updates | `claude-haiku-4-5-20251001` | — |

> Use the cheaper model for background/structured tasks (cards, summaries) and the mid model for live tutoring. Allow the user to bump the tutor to `claude-opus-4-8` for hard subjects in Settings. **Confirm these IDs against current docs before shipping.**

### Streaming contract (main → renderer)
Emit typed IPC events during a tutor turn: `text_delta` (token chunks), `tool_start`/`tool_result` (with a renderer hint payload — e.g., a note chip to show, a visual to render, an objective to check off), `usage` (tokens), `done`, `error`. The renderer renders progressively.

---

## 6. Feature specifications

### 6.1 Curriculum creation & tracking
- **Onboarding a topic.** Learner enters a subject + goal (e.g., "understand backprop well enough to implement it"). The **Curriculum architect** asks *one or two* calibrating questions to locate level, then returns a structured curriculum via `propose_curriculum`. **Never dump the curriculum without a quick diagnostic** — this mirrors the pedagogy and produces a syllabus that fits the learner.
- **Review & edit.** Show the proposal as an editable tree (add/remove/reorder modules and objectives, edit titles/estimates) before saving. Saved curricula appear in a left sidebar.
- **Progress.** Each module has a status and a mastery bar; each objective is a checkbox. Objectives are marked **met** either by the learner or by the tutor calling `mark_objective` when the learner demonstrably gets it. A module flips to `completed` when all objectives are met (offer, don't force).

### 6.2 The tutoring session (the heart)
- Open a module → a `session` starts → chat with the **Tutor**. Streamed responses render markdown, KaTeX math, highlighted code, and inline visuals.
- The tutor follows §8: diagnose → one step forward per turn (one question + one scaffold) → adapt to impatient vs. stuck → declare done when the learner can explain it back.
- Tutor may, *in service of the pedagogy*, call: `render_visual` (structure worth seeing), `suggest_note` (a genuinely key concept just landed), `mark_objective` (learner demonstrated it), `propose_quiz` (natural checkpoint reached).
- A "New session" continues the same module later; `state_summary` carries continuity across sessions without replaying the whole transcript.

### 6.3 Inline note capture (signature feature)
- **Select-to-save:** selecting text inside any assistant message pops a floating toolbar → **Save note** → a modal with: **type** (concept/definition/theorem/principle/insight/example/question), an auto-suggested **title**, the captured **excerpt** (read-only), your own **annotation**, and **tags**. Back-references to the source message/module are stored automatically.
- **Save whole message** in one click.
- **Proactive:** `suggest_note` renders an inline "Save this concept?" chip beside the relevant passage; one click saves it (pre-filled type/title).
- **Notes panel** (side drawer): filter by curriculum/module/type/tag, full-text search, edit/delete, and **"Turn into flashcards."**

### 6.4 Quizzes & mastery
- At a checkpoint (learner request or `propose_quiz`), the **Assessor** generates a mixed quiz (MCQ / short-answer / small code) via `generate_quiz`, scoped to the module's objectives and covered material.
- Learner takes it in-app; MCQs auto-graded; short/code answers graded by a quick model call against the rubric/`answer` with explanations. Store the attempt; update module **mastery**.

### 6.5 Spaced-repetition review
- **Card smith** turns notes into `front/back` flashcards (Q→A, cloze on definitions/theorems). Learner can edit/suspend cards.
- **Review mode:** FSRS schedules due cards; learner self-grades (Again/Hard/Good/Easy → 1–4); `ts-fsrs` updates the card and logs a `review`. Dashboard shows the **due count**; review works fully offline.

### 6.6 Progress dashboard
- Overall curriculum completion %; per-module mastery heatmap.
- **Streak** (consecutive days with a session or review) and **time-on-task** (from `events`).
- **Weak areas:** low-scoring quizzes and high-lapse cards surfaced with a "study these" shortcut.

### 6.7 PDF export
- **Module summary:** Claude-generated summary + objectives (with met/open status) + your notes for the module + a compact key-cards appendix.
- **Curriculum study guide:** all modules, chained, with a cover page and table of contents.
- **Notes export:** any selected notes → PDF.
- Implementation: render a styled HTML template (reuse markdown + KaTeX CSS) in a hidden `BrowserWindow`, call `printToPDF`, save via the native dialog. Typeset cleanly: cover, TOC, page numbers, readable serif body, monospace code.

### 6.8 Settings / BYOK
- **API key:** input (masked), stored via `safeStorage`, with a **Test connection** button (small live call). Key never leaves main.
- **Model & generation:** tutor model, temperature, max tokens.
- **Cost controls:** running token usage per session and a rolling total; an estimated cost using per-model rates from `config/models.ts`; an optional **monthly spend cap** that warns (and can block generation) when approached.
- **Data:** location, **backup/restore** (copy the SQLite file), **export/import**, and **delete all**.
- **Appearance:** light/dark/system, font-size scaling.

---

## 7. UI / screens

- **App shell:** left sidebar (curricula → modules tree with status dots + mastery bars; Review; Dashboard; Settings), main pane, right-side Notes drawer (toggle).
- **New Curriculum:** topic/goal input → diagnostic Q&A → editable proposed tree → save.
- **Session view:** transcript (streamed, rich), composer, in-message selection toolbar, inline note chips and rendered visuals, a "checkpoint" affordance.
- **Notes drawer:** searchable/filterable list, editor, "→ flashcards."
- **Review view:** one card at a time, reveal, self-grade, progress counter.
- **Dashboard:** completion, streak, time-on-task, mastery heatmap, weak areas, due-for-review.
- **Settings:** as in §6.8.

Keyboard-first where sensible (send, save-note, reveal/grade in review). Accessible: focus management, ARIA labels, sufficient contrast, resizable text.

---

## 8. Teaching methodology (encode this into the Tutor system prompt)

This is what makes Lyceum a *tutor*, not a chat wrapper. Express it in the app's own words (Appendix A is a ready draft).

1. **Diagnose before teaching.** Locate the learner first. If their message already shows their level or names their confusion, skip to the right move. Otherwise ask **one** calibrating question — never three.
2. **One step forward, every turn.** Each reply carries **one** focused question and **one** small scaffold that advances the learner no matter how they answer (a narrowing hint, a *parallel* worked example with narrated reasoning, a small visual, a restatement of what they got right). Never a wall of questions; never an empty turn. Keep turns short.
3. **Know when you're done.** When the learner explains it back, applies it to a new case, or stops needing hints — say so, summarize, and point to what's next. Don't probe past understanding.
4. **Hold the line under pressure — but read the learner.** "Just tell me" from an *engaged* learner who has the pieces = impatience: give a sharper hint or a parallel example and keep them doing the last step. The *same words* from someone repeating a wrong idea or shutting down = stuck: give a concrete foothold (do the first step, name the rule), then let them drive again. A deadline stated **up front** with a concrete blocker is a real fire-and-forget request — answer directly, offer depth later. A deadline that appears **only after** questioning is usually impatience in costume — hold the line, more directly.
5. **Move fluidly across the toolkit:** guided discovery (learner has the blocks) · direct explanation (new concept, beginner, or "just lay it out" topical requests) · parallel worked example with narration (teach procedure without doing their work) · inline visual (the concept has shape) · reflective pause (summarize back / predict / invent an example) · resource creation (they asked for a quiz/cards/guide — just make it).
6. **Show, don't just tell — sparingly.** Use `render_visual` when structure, process, or comparison is best *seen*. Show **one** relationship or step, not the finished mechanism (a fully animated solution hands over as much as typing the answer). No decorative visuals; skip them for pure procedure, notation, and quick confirmations.
7. **Academic integrity, contextually.** Self-learners have no grader — teach fully, answers included. If work will be **submitted/assessed**, don't produce final answers to graded problems or text to be turned in; teach with distinct examples, work parallel problems, review their attempt and point at what to reconsider. When unsure, ask.
8. **Tone.** Warm, direct, intellectually engaged, willing to push back. Treat the learner as a capable adult. No emoji, no cheerleading. Praise specifically and only when earned. If their reasoning is wrong or weak, say so kindly and concretely. When unsure of your own step, pause and say so — a confident walk to a wrong answer is the worst outcome.

**Failure modes to prevent:** over-questioning before teaching; hints that are the answer with extra steps; treating fluent jargon as a request for an essay instead of tutoring (it sets the *level*, not the *format*); visuals that overdeliver; hollow "Great question!"; fake neutrality about quality; and refusing to engage because something *might* be homework.

---

## 9. Project structure

```
lyceum/
├─ package.json  ·  electron.vite.config.ts  ·  tailwind.config.ts
├─ config/models.ts              # model IDs + pricing (VERIFY vs docs)
├─ src/
│  ├─ main/
│  │  ├─ index.ts                # app lifecycle, window, CSP
│  │  ├─ ipc/                    # typed handlers, channel whitelist
│  │  ├─ db/                     # better-sqlite3, migrations/, queries
│  │  ├─ security/keyVault.ts    # safeStorage wrapper (NEVER exposes plaintext)
│  │  ├─ services/               # curriculum, session, notes, quiz, srs, export, usage
│  │  ├─ harness/                # anthropicClient, promptAssembler, contextManager,
│  │  │                          #   toolRegistry, modes, prompts/  ← THE CORE
│  │  └─ pdf/                    # HTML template + printToPDF driver
│  ├─ preload/index.ts           # window.api bridge (contextIsolation)
│  ├─ shared/types.ts            # IPC + domain types shared main↔renderer
│  └─ renderer/
│     ├─ App.tsx  ·  routes/
│     ├─ stores/                 # Zustand
│     ├─ components/             # chat, markdown, NoteCapture, VisualRenderer, review, dashboard
│     └─ styles/                 # tailwind + markdown/katex theme (shared with PDF)
├─ README.md  ·  ARCHITECTURE.md
└─ tests/
```

---

## 10. Build plan (phased — verify each before advancing)

**Phase 0 — Scaffold & plumbing.** electron-vite + React + TS(strict) + Tailwind + shadcn; secure window (contextIsolation on, nodeIntegration off, CSP); typed IPC bridge; SQLite + migration runner; `keyVault` via `safeStorage`; Settings screen with key input + **Test connection**; app shell + routing.

**Phase 1 — MVP teaching loop (usable product).** Curriculum architect (topic → diagnostic → `propose_curriculum` → editable tree → saved & shown in sidebar); Tutor chat with **streaming** + markdown/KaTeX/code; manual objective checkboxes + module status; **inline note capture** (select→save) + Notes drawer; **per-module PDF summary** export.

**Phase 2 — Active learning.** Quiz generation + in-app attempts + grading → mastery; flashcards from notes + **FSRS review mode** + due dashboard; **inline visuals** (`render_visual`: SVG + Mermaid) and proactive **`suggest_note`** chips; **progress dashboard** (completion, streak, time, weak areas).

**Phase 3 — Polish & power.** Sandboxed **interactive HTML widgets** (iframe with strict sandbox/CSP) for the visual move; context **summarization** for long sessions; **cost tracking + spend cap**; backup/export-import; dark mode + font scaling; multi-curriculum management; (note/stub) optional local-model backend switch behind the same harness interface.

---

## 11. Acceptance criteria (per phase)

- **P0:** app launches; a saved key survives restart, is stored as ciphertext, and is never readable from the renderer or logs; Test connection succeeds/fails correctly; a migration creates the schema.
- **P1:** entering a topic yields a diagnostic then a structured, editable, persisted curriculum; opening a module streams a tutor reply that follows §8 (asks before dumping; one step per turn); selecting text saves a typed note that reappears in the drawer; a module summary exports as a clean PDF.
- **P2:** a checkpoint quiz generates, is answerable, scores, and updates mastery; notes convert to cards; review schedules and reschedules via FSRS and works offline; a structural concept renders as an inline diagram; the dashboard shows real completion/streak/weak-area data.
- **P3:** long sessions stay within the token budget via summarization with no loss of continuity; cost tracking is accurate and the cap warns/blocks; backup restores cleanly.

---

## 12. Non-functional requirements

- **Security:** contextIsolation on, sandbox on, nodeIntegration off, strict CSP; whitelist and validate every IPC channel; key confined to main; no secrets in logs; interactive widgets run in sandboxed iframes.
- **Resilience:** exponential backoff + jitter on 429/5xx; 401 → prompt re-enter key; graceful stream-interruption recovery; clear inline errors.
- **Offline:** notes browsing, flashcard review, and PDF export of existing content all work with no network. Only live tutoring/generation requires the API — degrade clearly.
- **Cost:** background tasks use the cheap model; usage surfaced per session; optional spend cap.
- **Performance:** index FKs + `flashcards.due` + `messages.session_id`; virtualize long lists; lazy-load transcripts.
- **Accessibility:** keyboard nav, focus rings, ARIA labels, contrast, resizable text.

---

## Appendix A — Tutor system prompt (starter draft, app-owned)

```
You are the tutor inside Lyceum, a learning app. Your job is not to answer the
learner's question but to help them be able to answer it themselves — this time and
next time. Handing over answers produces a learner who can't do the thing; asking
only questions produces one who gives up. Live in the space between.

DIAGNOSE FIRST. If the learner's message already shows their level or names their
confusion, go straight to the right move. Otherwise ask exactly ONE calibrating
question, then teach. Never open with three questions.

ONE STEP PER TURN. Each reply carries one focused question and one small scaffold
that moves them forward no matter how they answer — a narrowing hint, a PARALLEL
worked example with the reasoning narrated (never their exact assigned problem), a
small visual, or a restatement of what they already have right. Never a wall of
questions; never an empty turn. Keep turns short.

READ PRESSURE. "Just tell me" from an engaged learner who has the pieces is
impatience — give a sharper hint or a parallel example and keep them doing the last
step; don't cave. The same words from someone repeating a wrong idea or shutting down
is stuck — give ONE concrete foothold, then let them drive. A deadline stated up front
with a concrete blocker is a real request: answer directly, offer depth later. A
deadline that appears only after you start asking questions is usually impatience —
hold the line, more directly.

MOVES. Shift fluidly: guided discovery when they have the building blocks; direct
explanation for new concepts, beginners, or "just lay it out" topical asks; parallel
worked example to teach procedure without doing their work; reflective pause (ask them
to summarize back, predict, or invent an example) to cement it.

SHOW, DON'T JUST TELL — SPARINGLY. When a concept has shape, call render_visual with
ONE relationship, step, or comparison — not the finished mechanism. Keep your teaching
and your question in your own words around the visual. No decorative visuals; skip them
for pure procedure, notation, and quick confirmations.

INTEGRITY. If the learner is self-teaching, help fully, answers included. If the work
will be submitted or graded, don't produce final answers or text to be turned in —
teach with distinct examples, work parallel problems, and review their own attempt.
When unsure whether it's graded, ask.

KNOW WHEN DONE. When they explain it back, apply it to a new case, or stop needing
hints — say so, summarize what they covered, and point to what's next.

TONE. Warm, direct, intellectually engaged, willing to push back. Treat them as a
capable adult. No emoji, no cheerleading. Praise specifically and only when earned. If
their reasoning is wrong or weak, say so kindly and concretely. If you're unsure of a
step, pause and say so.

TOOLS. Use mark_objective when they demonstrably meet a learning objective; suggest_note
when a genuinely key concept lands (not every turn); render_visual per the rule above;
propose_quiz at a natural checkpoint. Use tools in service of teaching, never as busywork.

CONTEXT. The current curriculum goal, module, its objectives and statuses, a running
summary of what's been covered, and the learner's saved notes for this module are
provided below. Teach toward the open objectives.
```

*(The Curriculum-architect, Assessor, Card-smith, and Summarizer prompts are separate, shorter system prompts in `src/main/harness/prompts/`.)*

---

## Appendix B — Tool schemas (Anthropic tool use)

```jsonc
// propose_curriculum  (Curriculum architect)
{
  "name": "propose_curriculum",
  "description": "Return a structured, editable curriculum for the learner's goal and level.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "subject": { "type": "string" },
      "goal": { "type": "string" },
      "learner_level": { "type": "string", "enum": ["novice","beginner","intermediate","advanced"] },
      "modules": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "summary": { "type": "string" },
            "est_minutes": { "type": "integer" },
            "objectives": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["title","objectives"]
        }
      }
    },
    "required": ["title","subject","goal","learner_level","modules"]
  }
}

// suggest_note  (Tutor)
{
  "name": "suggest_note",
  "description": "Offer to save a genuinely key concept the learner just encountered.",
  "input_schema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["concept","definition","theorem","principle","insight","example","question"] },
      "title": { "type": "string" },
      "content": { "type": "string" },
      "source_excerpt": { "type": "string" }
    },
    "required": ["type","title","content"]
  }
}

// mark_objective  (Tutor)
{
  "name": "mark_objective",
  "description": "Mark a learning objective as met once the learner demonstrably understands it.",
  "input_schema": {
    "type": "object",
    "properties": {
      "objective_id": { "type": "integer" },
      "evidence": { "type": "string", "description": "One line on how they demonstrated it." }
    },
    "required": ["objective_id","evidence"]
  }
}

// render_visual  (Tutor)
{
  "name": "render_visual",
  "description": "Render ONE relationship, step, or comparison inline. Not the finished mechanism.",
  "input_schema": {
    "type": "object",
    "properties": {
      "format": { "type": "string", "enum": ["svg","mermaid","html"] },
      "code": { "type": "string" },
      "caption": { "type": "string" }
    },
    "required": ["format","code"]
  }
}

// propose_quiz  (Tutor)  → triggers Assessor
{
  "name": "propose_quiz",
  "description": "Signal a natural checkpoint; offer a short mastery check on the current module.",
  "input_schema": {
    "type": "object",
    "properties": { "module_id": { "type": "integer" }, "focus": { "type": "string" } },
    "required": ["module_id"]
  }
}

// generate_quiz  (Assessor)
{
  "name": "generate_quiz",
  "description": "Produce a mixed quiz scoped to the module's objectives and covered material.",
  "input_schema": {
    "type": "object",
    "properties": {
      "questions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": { "type": "string", "enum": ["mcq","short","code"] },
            "prompt": { "type": "string" },
            "options": { "type": "array", "items": { "type": "string" } },
            "answer": { "type": "string" },
            "explanation": { "type": "string" }
          },
          "required": ["type","prompt","answer","explanation"]
        }
      }
    },
    "required": ["questions"]
  }
}

// generate_flashcards  (Card smith)
{
  "name": "generate_flashcards",
  "description": "Turn a module's notes into active-recall cards (Q→A and cloze).",
  "input_schema": {
    "type": "object",
    "properties": {
      "cards": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": { "front": { "type": "string" }, "back": { "type": "string" }, "note_id": { "type": "integer" } },
          "required": ["front","back"]
        }
      }
    },
    "required": ["cards"]
  }
}
```

---

## Appendix C — Streaming tutor turn (main process, TypeScript sketch)

```ts
// src/main/harness/anthropicClient.ts (illustrative — adapt to current SDK)
import Anthropic from "@anthropic-ai/sdk";

export async function runTutorTurn(deps: {
  apiKey: string;            // from keyVault, main process only
  model: string;            // from config/models.ts
  system: string;           // assembled Tutor system prompt
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  emit: (evt: TurnEvent) => void;   // relays to renderer over IPC
}) {
  const client = new Anthropic({ apiKey: deps.apiKey });

  const stream = client.messages.stream({
    model: deps.model,
    max_tokens: 2048,
    system: deps.system,
    tools: deps.tools,
    messages: deps.messages,
  });

  stream.on("text", (delta) => deps.emit({ type: "text_delta", delta }));
  stream.on("error", (err) => deps.emit({ type: "error", message: String(err) }));

  const final = await stream.finalMessage();
  deps.emit({ type: "usage", usage: final.usage });

  // Handle any tool_use blocks: execute in main, persist effects, push UI hints,
  // then feed tool_result back and continue the loop until stop_reason !== "tool_use".
  // Retry 429/5xx with exponential backoff + jitter; surface 401 as "invalid key".
  return final;
}
```

---

## Appendix D — Notes & caveats

- **Model IDs / pricing:** the defaults in this doc (`claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-8`) reflect a point in time. **Confirm current IDs and prices in the official Anthropic docs** and centralize them in `config/models.ts`.
- **`learn` skill licensing:** the pedagogy in §8/Appendix A is re-expressed in the app's own words. If you ever intend to bundle Anthropic's `learn` skill file *verbatim*, check its license first; you don't need to — implementing the method is what matters.
- **Anthropic usage:** the app is BYOK and calls the API directly, which keeps each user within their own account and Anthropic's usage policies. Don't ship a shared key.
