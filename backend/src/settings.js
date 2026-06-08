import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SETTINGS_DIR = path.resolve(__dirname, '..', 'data')
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json')

const SettingsSchema = z.object({
  agentDebugReviewEnabled: z.boolean().default(false),
})

const DEFAULT_SETTINGS = SettingsSchema.parse({})

export async function getSettings() {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8')
    return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
  } catch (error) {
    if (error?.code === 'ENOENT') return DEFAULT_SETTINGS
    throw error
  }
}

export async function updateSettings(input) {
  const settings = SettingsSchema.parse({ ...(await getSettings()), ...input })
  await mkdir(SETTINGS_DIR, { recursive: true })
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}
