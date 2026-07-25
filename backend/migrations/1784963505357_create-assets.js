export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE assets (
      id                      TEXT PRIMARY KEY,
      owner_user_id           TEXT,
      company_id              TEXT,
      asset                   TEXT NOT NULL,
      category                TEXT,
      quantity                DOUBLE PRECISION,
      total_cost              DOUBLE PRECISION,
      purchase_date           TEXT,
      notes                   TEXT,
      linked_order_item_ids   JSONB NOT NULL DEFAULT '[]',
      invoice_number          TEXT,
      invoice_total           DOUBLE PRECISION,
      created_at              TEXT,
      updated_at              TEXT
    );
  `)
  pgm.sql('CREATE INDEX assets_owner_idx ON assets (owner_user_id);')
  pgm.sql('CREATE INDEX assets_company_idx ON assets (company_id);')

  pgm.sql(`
    CREATE TABLE asset_files (
      id                   TEXT PRIMARY KEY,
      asset_id             TEXT NOT NULL,
      original_file_name   TEXT,
      stored_file_name     TEXT,
      mime_type            TEXT,
      file_size            INTEGER,
      file_url             TEXT,
      source_type          TEXT,
      created_at           TEXT
    );
  `)
  pgm.sql('CREATE INDEX asset_files_asset_idx ON asset_files (asset_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS asset_files;')
  pgm.sql('DROP TABLE IF EXISTS assets;')
}
