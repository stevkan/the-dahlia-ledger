export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE gardens (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      ownership_type       TEXT,
      owner_user_id        TEXT,
      created_by_user_id   TEXT,
      organization_name    TEXT,
      location_name        TEXT,
      address              TEXT,
      notes                TEXT,
      is_default           BOOLEAN NOT NULL DEFAULT false,
      garden_options       JSONB,
      created_at           TEXT,
      updated_at           TEXT
    );
  `)
  pgm.sql('CREATE INDEX gardens_owner_idx ON gardens (owner_user_id);')
  pgm.sql('CREATE INDEX gardens_created_by_idx ON gardens (created_by_user_id);')

  pgm.sql(`
    CREATE TABLE garden_members (
      id                    TEXT PRIMARY KEY,
      garden_id             TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      email                 TEXT,
      display_name          TEXT,
      role                  TEXT NOT NULL,
      invited_by_user_id    TEXT,
      created_at            TEXT,
      updated_at            TEXT
    );
  `)
  pgm.sql('CREATE INDEX garden_members_garden_idx ON garden_members (garden_id);')
  pgm.sql('CREATE INDEX garden_members_user_idx ON garden_members (user_id);')

  pgm.sql(`
    CREATE TABLE invites (
      id                    TEXT PRIMARY KEY,
      token                 TEXT NOT NULL,
      garden_id             TEXT,
      email                 TEXT,
      role                  TEXT,
      created_by_user_id    TEXT,
      expires_at            TEXT,
      accepted_at           TEXT,
      accepted_by_user_id   TEXT,
      resent_at             TEXT,
      resent_by_user_id     TEXT,
      created_at            TEXT,
      updated_at            TEXT
    );
  `)
  pgm.sql('CREATE UNIQUE INDEX invites_token_idx ON invites (token);')
  pgm.sql('CREATE INDEX invites_garden_idx ON invites (garden_id);')
  pgm.sql('CREATE INDEX invites_created_by_idx ON invites (created_by_user_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS invites;')
  pgm.sql('DROP TABLE IF EXISTS garden_members;')
  pgm.sql('DROP TABLE IF EXISTS gardens;')
}
