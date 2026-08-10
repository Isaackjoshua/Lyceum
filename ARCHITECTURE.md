# Architecture

## The shape of the thing

```
┌──────────────────────── Renderer (React, sandboxed) ────────────────────────┐
│  Curriculum tree · Tutor chat · Notes panel · Review · Dashboard · Settings  │
│  Zustand UI store · react-markdown/KaTeX/Mermaid · Radix components          │
└───────────────▲──────────────────────────────────────────────────┬──────────┘
                │  typed IPC (contextIsolation ON, nodeIntegration OFF)
        preload bridge (window.api.*, whitelisted channels)        │
                │                                                  ▼
┌───────────────┴───────────────────── Main (Node) ───────────────────────────┐
│  IPC handlers → validation → services (curriculum, session, notes, quiz,    │
│                                        srs, export, usage)                  │
│                                                                             │
│  ┌────────────── Teaching Harness (src/main/harness/) — THE CORE ────────┐  │
│  │  promptAssembler · contextManager · toolRegistry · anthropicClient    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  SQLite (better-sqlite3) · safeStorage key vault · model providers (TLS)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

The governing rule: **the renderer is untrusted**. It has no Node, no network
access of its own, and no way to name an IPC channel that isn't on the preload
whitelist. Everything privileged — the API key, the database, outbound HTTPS —
lives in main.

---

## Process boundaries

### Main (`src/main/`)

Owns three things the renderer must never touch:

1. **The API key.** `security/keyVault.ts` is the only module that can decrypt
   it. `getApiKey()` is called exclusively from within main. There is no IPC
   channel that returns the key — `key:getStatus` returns presence, encryption
   availability, and the last four characters, and nothing else.
2. **The database.** `db/index.ts` opens one SQLite file in `userData`, applies
   pragmas (`WAL`, `foreign_keys = ON`), and runs pending migrations before the
   first window opens.
3. **Model calls.** All of them originate in `harness/llm.ts` and its
   providers. The renderer's CSP permits no outbound origin at all, so a
   compromised renderer cannot reach any provider directly.

### Preload (`src/preload/`)

A frozen `window.api` object built from the `IPC` channel constants in
`shared/types.ts`. It is compiled to **CommonJS** (`index.cjs`) because
sandboxed preload scripts cannot be ES modules.

### Renderer (`src/renderer/`)

React 18 + TypeScript, Tailwind, Radix primitives. Zustand holds UI state only;
SQLite remains the source of truth, and every mutation round-trips through IPC.

---

## IPC contract

Handlers never reject. Each returns a discriminated envelope:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
```

so a main-process failure surfaces as a rendered message rather than an
unhandled promise rejection carrying a stack trace into the UI. The wrapper in
`ipc/index.ts` catches, maps the error to learner-readable prose via
`describeApiError`, logs it in main, and returns `{ ok: false }`.

Input validation lives in `ipc/validate.ts`, deliberately free of Electron
imports so it is directly unit-testable. Unknown keys in a settings patch are
dropped rather than written — a renderer cannot smuggle an `apiKey` field into
the settings table.

---

## Data model

One SQLite file. Integer primary keys, epoch-millisecond timestamps, indices on
every foreign key plus `flashcards.due` and `messages.session_id`.

```
curricula ──< modules ──< objectives
                 │
                 ├──< sessions ──< messages
                 ├──< quizzes ──< quiz_questions
                 │                └──< quiz_attempts
                 └──< flashcards ──< reviews
notes ──> curricula, modules, sessions, messages   (back-references)
events                                             (streak, time-on-task)
settings                                           (key/value, JSON-encoded)
usage_log                                          (per-call token + cost)
```

**Mastery** per module is a weighted blend of the latest quiz score and
flashcard retention. **Streak** and **time-on-task** derive from `events`.
CHECK constraints enforce every enum at the database level, so an invalid
status cannot be written even by a bug in the service layer.

### Migrations

`db/migrations/index.ts` exports an ordered array of `{ version, name, up }`.
The runner compares `PRAGMA user_version` against the highest migration and
applies each pending one inside a transaction, bumping the version as it goes.

**Never edit a shipped migration — add a new one.** Migration SQL is tested
against Node's built-in `node:sqlite` (`tests/migrations.test.ts`), because
better-sqlite3 is compiled for Electron's ABI and cannot be loaded by a plain
`node` test runner.

---

## Providers

Lyceum is not native to any one vendor. `harness/providers/` holds the whole
vendor-specific surface; everything above it — modes, prompts, context
assembly, tool execution, the services — works in terms of a `provider:model`
reference and never learns who answered.

| Module | Responsibility |
|---|---|
| `providers/types.ts` | The contract: `runTurn` (streaming + tool loop) and `runSimple`. |
| `providers/anthropic.ts` | Claude, via the Anthropic SDK. Prompt-cache breakpoints, adaptive thinking, effort. |
| `providers/openaiCompatible.ts` | Everything else, via the OpenAI SDK plus a base URL. |
| `providers/toolEmulation.ts` | Tool calling for models that lack it. |
| `llm.ts` | Dispatch, and error mapping across both SDKs. |

**Two implementations cover every provider.** The OpenAI chat-completions
format is the lingua franca: OpenAI, Moonshot, OpenRouter, Groq, Together,
Ollama and LM Studio all speak it, so they differ only by base URL and model
id. Adding another such provider is a row in `config/providers.ts`, not code.

### Model references and capabilities

A model is addressed as `provider:model` — `anthropic:claude-sonnet-5`,
`ollama:llama3.1:8b`. Parsing splits on the *first* colon only, because Ollama
tags contain their own.

`config/models.ts` carries capability flags per model, and they are load
bearing rather than decorative: `effort` and `adaptiveThinking` are Anthropic
parameters that are a 400 anywhere else, so they are gated on the flag rather
than sent hopefully. A model the learner typed themselves is not in the
catalog; it gets synthesised defaults that assume native tools and no pricing.

### Tool calling on models that do not have it

Lyceum leans on tools: they are how objectives get marked, how curricula and
quizzes acquire structure, and how notes become cards. Plenty of good
open-weight models cannot emit structured tool calls.

Rather than disabling half the app on those models, `toolEmulation.ts`
describes a JSON protocol in the system prompt and parses the calls back out
of the reply. Callers above the provider layer never know the difference.

The subtle part is streaming. A fence can straddle a chunk boundary, so the
provider holds back any trailing text that could be the start of one, and stops
forwarding deltas entirely once a fence opens — otherwise the learner watches
raw JSON scroll past mid-explanation. A malformed block loses its action but is
still stripped from the visible text.

This is strictly a fallback, and Settings says so when a chosen model is in
that category.

### Keys

One encrypted key per provider, each its own `<provider>.key.enc` under
`userData`, with the same guarantees as before: `safeStorage`, `0600`, refuse
rather than fall back to plaintext, never over IPC. Providers marked
`auth: 'none'` (a local runtime) are always "ready" and store nothing.

A pre-multi-provider install is migrated on first launch: the old
`anthropic.key.enc` is renamed, and bare model ids in settings are read as
`anthropic:` references.

---

## The teaching harness

`src/main/harness/` is the product's engine; everything else is UI around it.

| Module | Responsibility |
|---|---|
| `llm.ts` | Provider dispatch. Streaming, the tool-use loop, retry/backoff, error mapping, token usage. |
| `promptAssembler.ts` | Builds the system prompt per mode and composes the messages array. |
| `contextManager.ts` | Assembles the per-turn context block within a token budget; folds old turns into `state_summary` when it overflows. |
| `toolRegistry.ts` | Tool definitions plus their main-process executors. |
| `modes.ts` | Five operating modes, each a system prompt + allowed tools + model. |

`prompts/` holds the system prompts themselves — `tutor.ts` is the pedagogy and
is the single most product-defining file in the repo.

### Modes

| Mode | Purpose | Default model | Tools |
|---|---|---|---|
| Curriculum architect | Topic + brief diagnostic → structured curriculum | tutor | `propose_curriculum` |
| Tutor | The main teaching loop | tutor | `mark_objective`, `suggest_note`, `render_visual`, `propose_quiz` |
| Assessor | Generate a checkpoint quiz | tutor | `generate_quiz` |
| Grader | Score one free-text answer | background | — |
| Card smith | Notes → flashcards | background | `generate_flashcards` |
| Summarizer | Module summaries + `state_summary` | background | — |

Modes name a **role**, not a model. The learner configures two — one for
teaching, one for background work — and they may be on different providers
entirely. Keeping the mapping in one table makes the cost profile of the whole
app legible at a glance.

### A tutor turn

1. Renderer sends the learner's message over IPC.
2. `session` service loads module, objectives, `state_summary`, note titles, and
   the last *N* verbatim messages.
3. `contextManager` assembles the request within a token budget.
4. `anthropicClient` streams; deltas relay to the renderer as they arrive.
5. Tool calls execute **in main**, persist their effects, and push a UI hint.
6. Transcript and state changes are written to SQLite.

Streaming events (main → renderer): `text_delta`, `tool_start`, `tool_result`,
`usage`, `done`, `error`. Every event carries the `requestId` of the turn that
produced it, so a late event from a cancelled turn is discarded rather than
appended to the transcript.

**Tools are gated on the UI that renders them.** A tool is only listed in a
mode's `tools` when the app can actually render its result — offering the model
a tool whose output would be silently dropped makes the tutor look broken. All
four tutor tools are live as of Phase 2.

**Ordering is chosen for prompt caching.** The system prompt is two blocks: the
frozen pedagogy (identical across every turn of every session, and marked
`cache_control: ephemeral`) followed by the volatile per-turn context block.

**Per-model request tuning is gated on capability flags.** `output_config.effort`
and `thinking: {type: 'adaptive'}` are rejected outright by models that predate
them, so `config/models.ts` carries `supportsEffort` / `supportsAdaptiveThinking`
and `tuningFor()` only sends what the selected model accepts. Sampling parameters
(`temperature`, `top_p`, `top_k`) are never sent — current models reject them.

### Context budget

`planBudget` keeps the most recent turns verbatim and folds the rest into the
session's `state_summary` via the cheap model.

Three rules matter:

- **The fold runs after the turn is delivered**, so the learner never waits on
  background bookkeeping.
- **`minKeep` recent messages survive** even when they exceed the budget,
  because dropping the immediate exchange would break the conversation.
- **A watermark (`sessions.folded_through_id`) makes folding idempotent.** Only
  messages newer than the watermark are ever summarised, and the watermark
  advances only in the same write as the summary that covers them — so a failed
  fold retries rather than silently losing turns.

That last one was a real defect through Phase 2: the budget was re-planned over
the entire transcript each turn, so already-folded messages were folded *again*
every subsequent turn. That burned tokens on the same text repeatedly and let
the summary drift, since each pass rewrote the previous pass's output.

### Cost tracking and the spend cap

Every billable call writes to `usage_log` with its mode, model, token counts and
an estimated cost derived from `config/models.ts`. `services/usage.ts` rolls
that up per session and per calendar month.

The cap deliberately defaults to **warn, not block**. Warning fires at 80%;
blocking only happens if the learner explicitly asked for it, because refusing
to answer mid-explanation is a worse failure than a slightly larger bill. Where
blocking does apply, it is checked *before* the request rather than partway
through — `submitQuiz` checks once up front rather than letting a cap trip
between questions and score the remainder zero. PDF export degrades instead:
a study guide without its generated summary still exports.

### Backup and restore

`VACUUM INTO` writes the backup rather than copying the file. The database runs
in WAL mode, so a plain file copy can miss committed pages still sitting in the
`-wal` sidecar; `VACUUM INTO` produces a single, self-contained, compacted
snapshot. (The verification harness asserts exactly this: a summary written
moments earlier is present in the backup.)

Restore is deliberately cautious:

1. The candidate is opened read-only and checked — is it a database, is it a
   *Lyceum* database, and is its schema version one this build understands? A
   newer-schema backup is refused rather than half-migrated.
2. Only then is the live database closed, **copied aside** to
   `lyceum.replaced.sqlite`, and replaced. Stale `-wal`/`-shm` sidecars are
   removed, since they belong to the old database and would corrupt the new one.
3. The app quits. Every prepared statement still points at the replaced file, so
   restarting is the only honest option.

### Sandboxed interactive widgets

`render_visual` with `format: "html"` runs in an iframe whose isolation rests on
three independent things:

| Layer | What it stops |
|---|---|
| `sandbox="allow-scripts"` **without** `allow-same-origin` | Opaque origin: no `window.parent`, no app storage, no same-origin anything |
| A CSP inside the document (`default-src 'none'`, inline script/style only) | All network access — fetch, XHR, websockets, remote images and fonts |
| The app's own top-level CSP | Remote origins generally |

**Never add `allow-same-origin` alongside `allow-scripts`** — together they let
the frame remove its own sandbox attribute.

Height is negotiated over `postMessage`, and the host authenticates messages by
comparing `event.source` against the frame's `contentWindow`. It cannot use
`event.origin`, which is the string `"null"` for an opaque origin and therefore
proves nothing.

### PDF export

### Mastery

Mastery is a blend, not a completion percentage:

```
quiz only     -> best quiz score
cards only    -> flashcard retention
both          -> 0.7 * best quiz score + 0.3 * retention
neither       -> 0
```

Quiz score dominates because it is a direct measurement; retention is slower and
noisier. When one signal is absent the other carries full weight, so a learner
who has taken a checkpoint but made no cards is not capped at 70%. Retention is
the share of a module's cards that have reached the FSRS `Review` state with at
most two lapses. **Mastery measures evidence, not effort** — reading and talking
to the tutor never move it.

### Spaced repetition

`services/srs.ts` wraps `ts-fsrs` in pure functions over card state, so the
scheduling logic is testable without a database. Card state is stored as JSON in
`flashcards.fsrs_json`, with the `due` timestamp mirrored into an indexed
`flashcards.due` column so the due query is a range scan.

Two decisions worth knowing:

- **Intervals shown on the grading buttons are computed in main by FSRS**, never
  guessed by the UI, so the number the learner sees is the number they get.
- **Review works entirely offline.** No API call is involved in scheduling —
  only card *generation* needs the network.

### Rendering model-authored diagrams

`render_visual` output is markup written by a model and injected into the DOM,
so it goes through `renderer/lib/sanitiseSvg.ts` — its own module precisely so
the policy is unit-testable (`tests/sanitise.test.ts`). Scripts, event handlers,
`foreignObject`, `iframe`, `image`, `use` and navigation attributes are all
stripped. Mermaid additionally runs at `securityLevel: 'strict'`, and its output
is sanitised again on the way in.

> A trap this caught: Mermaid renders node and edge labels inside
> `<foreignObject>` by default. Stripping that tag — correctly — produced
> diagrams with perfectly drawn but completely empty boxes. The fix is
> `htmlLabels: false`, which makes Mermaid emit native `<text>` instead, so the
> sanitiser and the labels can coexist.

### PDF export

Markdown is rendered to HTML in main (`marked`), maths is pre-rendered with
KaTeX, and the KaTeX stylesheet and its fonts are inlined as data URIs. The
resulting document is fully self-contained, so the hidden print window runs with
`javascript: false` and fetches nothing.

> A subtle trap worth recording: KaTeX's CSS references its families by their
> underscored names (`font-family: KaTeX_Main`). An earlier version of the
> inliner rewrote the underscore to a space while generating `@font-face` rules,
> which matched nothing and silently fell back to a serif — maths rendered, but
> with wrong glyphs. The family name must be passed through verbatim.

---

## Model configuration

`config/models.ts` is the **only** place a model ID or price appears. Nothing
else in the codebase hardcodes either. IDs are bare aliases with no date
suffix; a test asserts this, because a suffixed ID would 404.

---

## Security decisions worth knowing

| Decision | Why |
|---|---|
| Refuse to store the key when `safeStorage` is unavailable | A plaintext fallback is worse than a clear error. |
| Preload emitted as CommonJS | Sandboxed preload scripts cannot be ES modules. |
| CSP omits `connect-src` for Anthropic | The renderer has no business reaching the API; only main does. |
| `setPermissionRequestHandler` denies everything | Lyceum needs no camera, microphone, or geolocation. |
| `setWindowOpenHandler` denies and shells out | Prevents an in-app browser window with app privileges. |
| `will-navigate` blocked off-origin | Stops a malicious link from replacing the app UI. |
| Key file written `0600` | Defence in depth beneath the OS encryption layer. |

---

## Testing

- `tests/migrations.test.ts` — schema shape, indices, cascade deletes, CHECK
  constraint enforcement, version bookkeeping.
- `tests/validate.test.ts` — IPC input validation (settings, curriculum
  proposals, notes, architect transcripts) and the model catalog, including cost
  arithmetic and the no-date-suffix rule.
- `tests/harness.test.ts` — context budgeting, the context block's contents, and
  coercion of the model's `propose_curriculum` output.
- `tests/pdf.test.ts` — markdown/maths rendering, code-fence protection against
  the maths regex, HTML escaping, and self-containment of the print document.
- `tests/srs.test.ts` — FSRS round-tripping, interval ordering, lapse counting,
  growth over successive reviews, retention, and streak arithmetic.
- `tests/quiz.test.ts` — coercion of `generate_quiz` and `generate_flashcards`
  output, and parsing of the grader's verdict.
- `tests/sanitise.test.ts` — the SVG sanitiser policy, under jsdom.
- `tests/providers.test.ts` — the emulated tool protocol (extraction, hostile
  input, partial fences) and catalog invariants, including that no non-Anthropic
  model claims an Anthropic-only parameter.

Two things need a live Electron runtime and so sit outside `npm test`; both were
run as throwaway harnesses at their phase's acceptance:

- **Phase 0, key vault** against the real OS keychain — ciphertext at rest with
  no plaintext substring, decrypt round-trip, status payloads that never carry
  the key, clean delete.
- **Phase 1, persistence and print** — curriculum/objective/session/note round
  trips through better-sqlite3, and `printToPDF` producing a real PDF with the
  KaTeX font subsets actually embedded (verified via `/BaseFont` entries, which
  is what caught the font-family bug above).
- **Phase 2, quiz/card/dashboard round trips** — quiz insert and attempt, the
  mastery blend at each of its branches, duplicate suppression on regenerated
  cards, a review moving a card out of the due queue, and the dashboard's
  counts, streak and weak-area detection. This is what caught the weak-area
  filter keying on module status instead of evidence.

- **Phase 3, watermark/cap/backup** — fold watermark advancing monotonically and
  removing folded turns from the window, the cap warning at 80% without blocking
  and blocking only when asked, `VACUUM INTO` capturing WAL-resident writes, and
  restore refusing a non-database, a foreign database, and a newer-schema backup.
- **Phase 3, widget isolation** — a seeded widget probed its own sandbox and
  reported the result on screen: `parent.document`, `parent.localStorage`, its
  own `localStorage`, the `window.api` bridge, `fetch`, `XHR` and remote images
  were all blocked. The first version of that probe was wrong (it checked
  `fetch` synchronously, which always reads as reachable) — worth remembering
  that a green result is only as good as the probe behind it.

- **Phase 4, providers** — a fake OpenAI-compatible server stood up in-process
  exercised the whole non-Anthropic path with no key and no network: tool
  arguments arriving fragmented across chunks and being reassembled, the
  emulated protocol parsing a call out of prose, a fence deliberately split
  across chunk boundaries never leaking raw JSON into the stream, usage
  accumulating across tool round trips, and both misconfiguration paths (no
  base URL, no key) failing with a message a learner can act on.

The live teaching loop itself — streaming, the tool loop, the architect's
diagnostic — requires a funded API key and is exercised manually. That is now
true per provider: the Anthropic path and the OpenAI-compatible path are
verified against a fake server, but neither has been run against the real
vendor endpoints.

---

## Adding a provider

Most providers need no code at all — add a row to `config/providers.ts` with a
base URL and whether it needs a key, plus optional model presets in
`config/models.ts`. Anything speaking the OpenAI chat-completions format works
from there.

A genuinely different wire format (a vendor with its own SDK and message shape)
means a third implementation of `Provider` in `harness/providers/`, registered
in the dispatcher in `llm.ts`. Nothing above that layer changes.
