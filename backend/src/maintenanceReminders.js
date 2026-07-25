import crypto from 'node:crypto'
import { query } from './db.js'

const SELECT_COLUMNS = `
  id, garden_id AS "gardenId", title, notes, due_date AS "dueDate",
  related_record_ids AS "relatedRecordIds", source,
  created_by_user_id AS "createdByUserId", owner_user_id AS "ownerUserId", assigned_to_user_id AS "assignedToUserId",
  visibility, priority, completed_at AS "completedAt", completed_by_user_id AS "completedByUserId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`

function nowIso() {
  return new Date().toISOString()
}

function sortReminders(a, b) {
  if (a.completedAt && !b.completedAt) return 1
  if (!a.completedAt && b.completedAt) return -1
  return String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
}

async function getMaintenanceReminderById(id) {
  const { rows } = await query(`SELECT ${SELECT_COLUMNS} FROM maintenance_reminders WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function listMaintenanceReminders({ gardenId, userId, includeLegacyUnassigned = false } = {}) {
  const { rows } = await query(`SELECT ${SELECT_COLUMNS} FROM maintenance_reminders`)
  return rows
    .filter((reminder) => !gardenId || reminder.gardenId === gardenId || (includeLegacyUnassigned && !reminder.gardenId))
    .map((reminder) => ({
      ...reminder,
      gardenId: reminder.gardenId ?? (includeLegacyUnassigned ? gardenId : undefined),
      ownerUserId: reminder.ownerUserId ?? userId,
      visibility: reminder.visibility ?? 'garden',
      priority: reminder.priority ?? 'normal',
    }))
    .sort(sortReminders)
}

export async function createMaintenanceReminder(input, { gardenId, userId } = {}) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await query(
    `INSERT INTO maintenance_reminders (
       id, garden_id, title, notes, due_date, related_record_ids, source,
       created_by_user_id, owner_user_id, assigned_to_user_id, visibility, priority,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      gardenId ?? null,
      input.title,
      input.notes || null,
      input.dueDate || null,
      JSON.stringify(input.relatedRecordIds ?? []),
      input.source ?? 'user',
      userId ?? null,
      input.ownerUserId || userId || null,
      input.assignedToUserId || null,
      input.visibility ?? 'garden',
      input.priority ?? 'normal',
      timestamp,
      timestamp,
    ],
  )

  return getMaintenanceReminderById(id)
}

export async function updateMaintenanceReminder(id, input, { gardenId, userId } = {}) {
  const existing = await getMaintenanceReminderById(id)
  if (!existing) return null
  if (gardenId && existing.gardenId && existing.gardenId !== gardenId) return null

  const timestamp = nowIso()
  await query(
    `UPDATE maintenance_reminders SET
       title = $2, source = $3, notes = $4, due_date = $5, related_record_ids = $6,
       garden_id = $7, created_by_user_id = $8, owner_user_id = $9, assigned_to_user_id = $10,
       visibility = $11, priority = $12, updated_at = $13
     WHERE id = $1`,
    [
      id,
      input.title,
      input.source ?? null,
      input.notes || null,
      input.dueDate || null,
      JSON.stringify(input.relatedRecordIds ?? existing.relatedRecordIds ?? []),
      existing.gardenId ?? gardenId ?? null,
      existing.createdByUserId ?? userId ?? null,
      input.ownerUserId ?? existing.ownerUserId ?? userId ?? null,
      input.assignedToUserId || null,
      input.visibility ?? existing.visibility ?? 'garden',
      input.priority ?? existing.priority ?? 'normal',
      timestamp,
    ],
  )

  return getMaintenanceReminderById(id)
}

export async function completeMaintenanceReminder(id, { gardenId, userId } = {}) {
  const existing = await getMaintenanceReminderById(id)
  if (!existing) return null
  if (gardenId && existing.gardenId && existing.gardenId !== gardenId) return null

  const timestamp = nowIso()
  await query(
    `UPDATE maintenance_reminders SET
       garden_id = $2, created_by_user_id = $3, owner_user_id = $4, visibility = $5, priority = $6,
       completed_at = $7, completed_by_user_id = $8, updated_at = $9
     WHERE id = $1`,
    [
      id,
      existing.gardenId ?? gardenId ?? null,
      existing.createdByUserId ?? userId ?? null,
      existing.ownerUserId ?? userId ?? null,
      existing.visibility ?? 'garden',
      existing.priority ?? 'normal',
      timestamp,
      userId ?? null,
      timestamp,
    ],
  )

  return getMaintenanceReminderById(id)
}

export async function reopenMaintenanceReminder(id, { gardenId, userId } = {}) {
  const existing = await getMaintenanceReminderById(id)
  if (!existing) return null
  if (gardenId && existing.gardenId && existing.gardenId !== gardenId) return null

  const timestamp = nowIso()
  await query(
    `UPDATE maintenance_reminders SET
       garden_id = $2, created_by_user_id = $3, owner_user_id = $4, visibility = $5, priority = $6,
       completed_at = NULL, completed_by_user_id = NULL, updated_at = $7
     WHERE id = $1`,
    [
      id,
      existing.gardenId ?? gardenId ?? null,
      existing.createdByUserId ?? userId ?? null,
      existing.ownerUserId ?? userId ?? null,
      existing.visibility ?? 'garden',
      existing.priority ?? 'normal',
      timestamp,
    ],
  )

  return getMaintenanceReminderById(id)
}

export async function deleteMaintenanceReminder(id, { gardenId } = {}) {
  const existing = await getMaintenanceReminderById(id)
  if (!existing) return true
  if (gardenId && existing.gardenId && existing.gardenId !== gardenId) return false

  await query('DELETE FROM maintenance_reminders WHERE id = $1', [id])
  return true
}
