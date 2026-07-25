export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE companies (
      id             TEXT PRIMARY KEY,
      garden_id      TEXT,
      owner_user_id  TEXT,
      name           TEXT NOT NULL,
      website        TEXT,
      email          TEXT,
      phone          TEXT,
      notes          TEXT,
      created_at     TEXT,
      updated_at     TEXT
    );
  `)
  pgm.sql('CREATE INDEX companies_garden_idx ON companies (garden_id);')
  pgm.sql('CREATE INDEX companies_owner_idx ON companies (owner_user_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS companies;')
}
