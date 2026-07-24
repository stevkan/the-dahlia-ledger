export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE app_config (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ,
      updated_by  JSONB
    );
  `)
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS app_config;')
}
