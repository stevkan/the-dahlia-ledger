export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE dahlia_records (
      id                           TEXT PRIMARY KEY,
      record_number                INTEGER NOT NULL,
      garden_id                    TEXT,
      flower_name                  TEXT NOT NULL,
      garden_location              TEXT,
      season_year_start            INTEGER NOT NULL,
      thumbnail_url                TEXT,
      list_thumbnail_url           TEXT,
      image_url                    TEXT,
      cultivar_thumbnail_url       TEXT,
      cultivar_list_thumbnail_url  TEXT,
      cultivar_image_url           TEXT,
      record_photos                JSONB NOT NULL DEFAULT '[]',
      cultivar_photos              JSONB NOT NULL DEFAULT '[]',
      default_record_photo_id      TEXT,
      default_cultivar_photo_id    TEXT,
      default_photo_scope          TEXT CHECK (default_photo_scope IN ('record', 'cultivar')),
      core                         JSONB NOT NULL DEFAULT '{}',
      growth                       JSONB NOT NULL DEFAULT '{}',
      care                         JSONB NOT NULL DEFAULT '{}',
      tuber                        JSONB NOT NULL DEFAULT '{}',
      health                       JSONB NOT NULL DEFAULT '{}',
      meta                         JSONB NOT NULL DEFAULT '{}',
      cultivar_key                 TEXT GENERATED ALWAYS AS (lower(trim(coalesce(core->>'cultivar', flower_name)))) STORED
    );
  `)
  pgm.sql('CREATE INDEX dahlia_records_garden_number_idx ON dahlia_records (garden_id, record_number);')
  pgm.sql('CREATE INDEX dahlia_records_cultivar_key_idx ON dahlia_records (cultivar_key);')

  pgm.sql(`
    CREATE TABLE dahlia_record_summaries_snapshot (
      id                           TEXT PRIMARY KEY,
      record_number                INTEGER,
      garden_id                    TEXT,
      flower_name                  TEXT,
      garden_location              TEXT,
      season_year_start            INTEGER,
      thumbnail_url                TEXT,
      list_thumbnail_url           TEXT,
      image_url                    TEXT,
      cultivar_thumbnail_url       TEXT,
      cultivar_list_thumbnail_url  TEXT,
      cultivar_image_url           TEXT,
      default_photo_scope          TEXT,
      core                         JSONB,
      growth                       JSONB,
      tuber                        JSONB,
      meta                         JSONB,
      reviewed_at                  TIMESTAMPTZ,
      migrated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX dahlia_record_summaries_snapshot_garden_idx ON dahlia_record_summaries_snapshot (garden_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS dahlia_record_summaries_snapshot;')
  pgm.sql('DROP TABLE IF EXISTS dahlia_records;')
}
