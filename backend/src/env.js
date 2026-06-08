import dotenv from 'dotenv'

dotenv.config()

export function mustGetEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}
