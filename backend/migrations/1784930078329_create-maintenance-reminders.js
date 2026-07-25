export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE maintenance_reminders (
      id                    TEXT PRIMARY KEY,
      garden_id             TEXT,
      title                 TEXT NOT NULL,
      notes                 TEXT,
      due_date              TEXT,
      related_record_ids    JSONB NOT NULL DEFAULT '[]',
      source                TEXT,
      created_by_user_id    TEXT,
      owner_user_id         TEXT,
      assigned_to_user_id   TEXT,
      visibility            TEXT CHECK (visibility IN ('private', 'garden')),
      priority              TEXT CHECK (priority IN ('normal', 'high')),
      completed_at          TEXT,
      completed_by_user_id  TEXT,
      created_at            TEXT,
      updated_at            TEXT
    );
  `)
  pgm.sql('CREATE INDEX maintenance_reminders_garden_idx ON maintenance_reminders (garden_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS maintenance_reminders;')
}
