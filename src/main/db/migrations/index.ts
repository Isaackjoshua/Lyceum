import type { Database } from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

/**
 * Migrations run in ascending version order, each inside a transaction.
 * Never edit a shipped migration — add a new one.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    up: (db) => {
      db.exec(`
        CREATE TABLE curricula (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          title         TEXT NOT NULL,
          subject       TEXT NOT NULL,
          goal          TEXT NOT NULL,
          learner_level TEXT NOT NULL DEFAULT 'beginner'
                        CHECK (learner_level IN ('novice','beginner','intermediate','advanced')),
          status        TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','archived')),
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE TABLE modules (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          curriculum_id INTEGER NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
          title         TEXT NOT NULL,
          summary       TEXT,
          est_minutes   INTEGER,
          order_index   INTEGER NOT NULL DEFAULT 0,
          status        TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_progress','completed')),
          mastery       REAL NOT NULL DEFAULT 0
                        CHECK (mastery >= 0 AND mastery <= 1),
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        CREATE INDEX idx_modules_curriculum ON modules(curriculum_id);

        CREATE TABLE objectives (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
          text        TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met'))
        );
        CREATE INDEX idx_objectives_module ON objectives(module_id);

        CREATE TABLE sessions (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
          started_at    INTEGER NOT NULL,
          ended_at      INTEGER,
          state_summary TEXT
        );
        CREATE INDEX idx_sessions_module ON sessions(module_id);

        CREATE TABLE messages (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role       TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
          content    TEXT NOT NULL,
          meta_json  TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_messages_session ON messages(session_id);

        CREATE TABLE notes (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          curriculum_id  INTEGER REFERENCES curricula(id) ON DELETE SET NULL,
          module_id      INTEGER REFERENCES modules(id) ON DELETE SET NULL,
          session_id     INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
          message_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          type           TEXT NOT NULL CHECK (type IN
                         ('concept','definition','theorem','principle','insight','example','question')),
          title          TEXT NOT NULL,
          content        TEXT NOT NULL,
          annotation     TEXT,
          source_excerpt TEXT,
          tags_json      TEXT NOT NULL DEFAULT '[]',
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_notes_curriculum ON notes(curriculum_id);
        CREATE INDEX idx_notes_module ON notes(module_id);
        CREATE INDEX idx_notes_session ON notes(session_id);
        CREATE INDEX idx_notes_message ON notes(message_id);

        CREATE TABLE flashcards (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id    INTEGER REFERENCES notes(id) ON DELETE SET NULL,
          module_id  INTEGER REFERENCES modules(id) ON DELETE CASCADE,
          front      TEXT NOT NULL,
          back       TEXT NOT NULL,
          fsrs_json  TEXT NOT NULL DEFAULT '{}',
          due        INTEGER NOT NULL DEFAULT 0,
          suspended  INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_flashcards_note ON flashcards(note_id);
        CREATE INDEX idx_flashcards_module ON flashcards(module_id);
        CREATE INDEX idx_flashcards_due ON flashcards(due);

        CREATE TABLE reviews (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          flashcard_id INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
          reviewed_at  INTEGER NOT NULL,
          rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4)
        );
        CREATE INDEX idx_reviews_flashcard ON reviews(flashcard_id);

        CREATE TABLE quizzes (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          module_id  INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_quizzes_module ON quizzes(module_id);

        CREATE TABLE quiz_questions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          quiz_id      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
          type         TEXT NOT NULL CHECK (type IN ('mcq','short','code')),
          prompt       TEXT NOT NULL,
          options_json TEXT,
          answer       TEXT NOT NULL,
          explanation  TEXT NOT NULL,
          order_index  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id);

        CREATE TABLE quiz_attempts (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          quiz_id        INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
          taken_at       INTEGER NOT NULL,
          score          REAL NOT NULL,
          responses_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);

        CREATE TABLE events (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          ts           INTEGER NOT NULL,
          type         TEXT NOT NULL CHECK (type IN
                       ('session_start','session_end','review','quiz','note')),
          payload_json TEXT
        );
        CREATE INDEX idx_events_ts ON events(ts);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE usage_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          ts            INTEGER NOT NULL,
          session_id    INTEGER,
          mode          TEXT NOT NULL,
          model         TEXT NOT NULL,
          input_tokens  INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          estimated_usd REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_usage_ts ON usage_log(ts);
        CREATE INDEX idx_usage_session ON usage_log(session_id);
      `)
    }
  }
]
