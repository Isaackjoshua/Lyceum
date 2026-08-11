import type {
  Curriculum,
  CurriculumDetail,
  CurriculumProposal,
  CurriculumSummary,
  Module,
  ModuleStatus,
  Objective,
  ObjectiveStatus
} from '@shared/types.js'
import { getDatabase } from '../index.js'

/* ------------------------------------------------------------- row types */

interface CurriculumRow {
  id: number
  title: string
  subject: string
  goal: string
  learner_level: Curriculum['learnerLevel']
  status: Curriculum['status']
  created_at: number
  updated_at: number
}

interface ModuleRow {
  id: number
  curriculum_id: number
  title: string
  summary: string | null
  est_minutes: number | null
  order_index: number
  status: ModuleStatus
  mastery: number
  created_at: number
  updated_at: number
}

interface ObjectiveRow {
  id: number
  module_id: number
  text: string
  order_index: number
  status: ObjectiveStatus
}

const toCurriculum = (r: CurriculumRow): Curriculum => ({
  id: r.id,
  title: r.title,
  subject: r.subject,
  goal: r.goal,
  learnerLevel: r.learner_level,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toModule = (r: ModuleRow): Module => ({
  id: r.id,
  curriculumId: r.curriculum_id,
  title: r.title,
  summary: r.summary,
  estMinutes: r.est_minutes,
  orderIndex: r.order_index,
  status: r.status,
  mastery: r.mastery,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toObjective = (r: ObjectiveRow): Objective => ({
  id: r.id,
  moduleId: r.module_id,
  text: r.text,
  orderIndex: r.order_index,
  status: r.status
})

/* --------------------------------------------------------------- writes */

/** Persists a proposal (possibly edited by the learner) as a real curriculum. */
export function saveCurriculum(proposal: CurriculumProposal): number {
  const db = getDatabase()
  const now = Date.now()

  const insert = db.transaction(() => {
    const curriculumId = db
      .prepare(
        `INSERT INTO curricula (title, subject, goal, learner_level, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        proposal.title,
        proposal.subject,
        proposal.goal,
        proposal.learnerLevel,
        now,
        now
      ).lastInsertRowid as number

    const moduleStmt = db.prepare(
      `INSERT INTO modules (curriculum_id, title, summary, est_minutes, order_index, status, mastery, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'not_started', 0, ?, ?)`
    )
    const objectiveStmt = db.prepare(
      `INSERT INTO objectives (module_id, text, order_index, status) VALUES (?, ?, ?, 'open')`
    )

    proposal.modules.forEach((module, moduleIndex) => {
      const moduleId = moduleStmt.run(
        curriculumId,
        module.title,
        module.summary ?? null,
        module.estMinutes ?? null,
        moduleIndex,
        now,
        now
      ).lastInsertRowid as number

      module.objectives.forEach((text, objectiveIndex) => {
        objectiveStmt.run(moduleId, text, objectiveIndex)
      })
    })

    return curriculumId
  })

  return insert()
}

export function deleteCurriculum(curriculumId: number): void {
  getDatabase().prepare('DELETE FROM curricula WHERE id = ?').run(curriculumId)
}

export function setModuleStatus(moduleId: number, status: ModuleStatus): Module {
  const db = getDatabase()
  db.prepare('UPDATE modules SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    moduleId
  )
  const row = db
    .prepare<[number], ModuleRow>('SELECT * FROM modules WHERE id = ?')
    .get(moduleId)
  if (!row) throw new Error(`Module ${moduleId} not found.`)
  return toModule(row)
}

export function setObjectiveStatus(
  objectiveId: number,
  status: ObjectiveStatus
): Objective {
  const db = getDatabase()
  db.prepare('UPDATE objectives SET status = ? WHERE id = ?').run(status, objectiveId)
  const row = db
    .prepare<[number], ObjectiveRow>('SELECT * FROM objectives WHERE id = ?')
    .get(objectiveId)
  if (!row) throw new Error(`Objective ${objectiveId} not found.`)
  return toObjective(row)
}

/**
 * Moves a module to in_progress when work starts. Completion is offered to the
 * learner rather than forced, so this never sets 'completed' on its own.
 */
export function markModuleStarted(moduleId: number): void {
  getDatabase()
    .prepare(
      `UPDATE modules SET status = 'in_progress', updated_at = ?
       WHERE id = ? AND status = 'not_started'`
    )
    .run(Date.now(), moduleId)
}

/* ---------------------------------------------------------------- reads */

export function setCurriculumArchived(curriculumId: number, archived: boolean): void {
  getDatabase()
    .prepare('UPDATE curricula SET status = ?, updated_at = ? WHERE id = ?')
    .run(archived ? 'archived' : 'active', Date.now(), curriculumId)
}

export function listCurricula(includeArchived = false): CurriculumSummary[] {
  const db = getDatabase()
  const rows = includeArchived
    ? db
        .prepare<[], CurriculumRow>(
          "SELECT * FROM curricula ORDER BY status = 'archived', updated_at DESC"
        )
        .all()
    : db
        .prepare<[], CurriculumRow>(
          "SELECT * FROM curricula WHERE status = 'active' ORDER BY updated_at DESC"
        )
        .all()

  // Counted in two grouped queries rather than two per curriculum. The sidebar
  // renders this list on every navigation, so an N+1 here is paid constantly.
  const moduleCounts = new Map<number, { total: number; done: number }>(
    db
      .prepare<[], { curriculum_id: number; total: number; done: number }>(
        `SELECT curriculum_id,
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS done
         FROM modules GROUP BY curriculum_id`
      )
      .all()
      .map((r) => [r.curriculum_id, { total: r.total, done: r.done }])
  )

  const noteCounts = new Map<number, number>(
    db
      .prepare<[], { curriculum_id: number; n: number }>(
        'SELECT curriculum_id, COUNT(*) AS n FROM notes WHERE curriculum_id IS NOT NULL GROUP BY curriculum_id'
      )
      .all()
      .map((r) => [r.curriculum_id, r.n])
  )

  return rows.map((row) => {
    const counts = moduleCounts.get(row.id)
    return {
      ...toCurriculum(row),
      moduleCount: counts?.total ?? 0,
      completedModules: counts?.done ?? 0,
      noteCount: noteCounts.get(row.id) ?? 0
    }
  })
}

export function getCurriculumDetail(curriculumId: number): CurriculumDetail {
  const db = getDatabase()
  const row = db
    .prepare<[number], CurriculumRow>('SELECT * FROM curricula WHERE id = ?')
    .get(curriculumId)
  if (!row) throw new Error(`Curriculum ${curriculumId} not found.`)

  const moduleRows = db
    .prepare<[number], ModuleRow>(
      'SELECT * FROM modules WHERE curriculum_id = ? ORDER BY order_index, id'
    )
    .all(curriculumId)

  const objectiveStmt = db.prepare<[number], ObjectiveRow>(
    'SELECT * FROM objectives WHERE module_id = ? ORDER BY order_index, id'
  )

  return {
    ...toCurriculum(row),
    modules: moduleRows.map((moduleRow) => ({
      ...toModule(moduleRow),
      objectives: objectiveStmt.all(moduleRow.id).map(toObjective)
    }))
  }
}

export function getModuleWithObjectives(
  moduleId: number
): { module: Module; objectives: Objective[]; curriculum: Curriculum } {
  const db = getDatabase()
  const moduleRow = db
    .prepare<[number], ModuleRow>('SELECT * FROM modules WHERE id = ?')
    .get(moduleId)
  if (!moduleRow) throw new Error(`Module ${moduleId} not found.`)

  const curriculumRow = db
    .prepare<[number], CurriculumRow>('SELECT * FROM curricula WHERE id = ?')
    .get(moduleRow.curriculum_id)
  if (!curriculumRow) throw new Error('Curriculum for that module is missing.')

  const objectives = db
    .prepare<[number], ObjectiveRow>(
      'SELECT * FROM objectives WHERE module_id = ? ORDER BY order_index, id'
    )
    .all(moduleId)
    .map(toObjective)

  return {
    module: toModule(moduleRow),
    objectives,
    curriculum: toCurriculum(curriculumRow)
  }
}
