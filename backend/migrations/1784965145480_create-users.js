export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,
      email         TEXT,
      display_name  TEXT,
      photo_url     TEXT,
      provider      TEXT,
      created_at    TEXT,
      last_seen_at  TEXT,
      updated_at    TEXT
    );
  `)
  pgm.sql('CREATE INDEX users_email_idx ON users (email);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS users;')
}
