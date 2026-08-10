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
│  SQLite (better-sqlite3)  ·  safeStorage key vault  ·  Anthropic API (TLS)  │
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
3. **Anthropic calls.** All of them originate in `harness/anthropicClient.ts`.
   The renderer's CSP does not even permit `connect-src` to Anthropic, so a
   compromised renderer cannot reach the API directly.

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

## The teaching harness

`src/main/harness/` is the product's engine; everything else is UI around it.

| Module | Responsibility |
|---|---|
| `anthropicClient.ts` | Thin SDK wrapper. Streaming, the tool-use loop, retry/backoff, error mapping, token usage emission. |
| `promptAssembler.ts` | Builds the system prompt per mode and composes the messages array. |
| `contextManager.ts` | Assembles the per-turn context block within a token budget; folds old turns into `state_summary` when it overflows. |
| `toolRegistry.ts` | Tool definitions plus their main-process executors. |
| `modes.ts` | Five operating modes, each a system prompt + allowed tools + model. |

*(Phase 0 implements `anthropicClient.ts` only — client construction, error
mapping, and the connection test. The rest lands in Phase 1.)*

### Modes

| Mode | Purpose | Default model | Tools |
|---|---|---|---|
| Curriculum architect | Topic + brief diagnostic → structured curriculum | Sonnet | `propose_curriculum` |
| Tutor | The main teaching loop | Sonnet (configurable) | `mark_objective`, `suggest_note`, `render_visual`, `propose_quiz` |
| Assessor | Generate a checkpoint quiz | Sonnet | `generate_quiz` |
| Card smith | Notes → flashcards | Haiku | `generate_flashcards` |
| Summarizer | Module summaries + `state_summary` | Haiku | — |

Cheap models do background structured work; the mid-tier model teaches. The
learner can bump the tutor to Opus for hard subjects.

### A tutor turn

1. Renderer sends the learner's message over IPC.
2. `session` service loads module, objectives, `state_summary`, note titles, and
   the last *N* verbatim messages.
3. `contextManager` assembles the request within a token budget.
4. `anthropicClient` streams; deltas relay to the renderer as they arrive.
5. Tool calls execute **in main**, persist their effects, and push a UI hint.
6. Transcript and state changes are written to SQLite.

Streaming events (main → renderer): `text_delta`, `tool_start`, `tool_result`,
`usage`, `done`, `error`.

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
- `tests/validate.test.ts` — IPC input validation and the model catalog,
  including cost arithmetic and the no-date-suffix rule.

The key vault was verified against the real OS keychain during Phase 0
acceptance: ciphertext at rest with no plaintext substring, a successful
decrypt round-trip, status payloads that never carry the key, and a clean
delete. That check needs a live Electron runtime, so it is not part of the
`npm test` suite.
