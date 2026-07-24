import crypto from 'node:crypto'
import { query } from './db.js'

const CONFIG_KEY = 'appCheck'

export async function getAppCheckDebugToken() {
  const { rows } = await query('SELECT value FROM app_config WHERE key = $1', [CONFIG_KEY])
  return rows[0]?.value?.debugToken ?? null
}

export async function generateAppCheckDebugToken(user) {
  const debugToken = crypto.randomUUID()
  const value = { debugToken }
  const updatedBy = { uid: user?.uid ?? null, email: user?.email ?? null }

  await query(
    `INSERT INTO app_config (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
    [CONFIG_KEY, JSON.stringify(value), JSON.stringify(updatedBy)],
  )

  return debugToken
}
