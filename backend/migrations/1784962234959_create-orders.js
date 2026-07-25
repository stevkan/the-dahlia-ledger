export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE orders (
      id              TEXT PRIMARY KEY,
      company_id      TEXT,
      owner_user_id   TEXT,
      invoice_number  TEXT,
      order_date      TEXT,
      total_cost      DOUBLE PRECISION,
      notes           TEXT,
      created_at      TEXT,
      updated_at      TEXT
    );
  `)
  pgm.sql('CREATE INDEX orders_company_idx ON orders (company_id);')
  pgm.sql('CREATE INDEX orders_owner_idx ON orders (owner_user_id);')

  pgm.sql(`
    CREATE TABLE order_items (
      id             TEXT PRIMARY KEY,
      order_id       TEXT NOT NULL,
      garden_id      TEXT,
      item_no        TEXT,
      flower_name    TEXT NOT NULL,
      cultivar_name  TEXT,
      item_cost      DOUBLE PRECISION,
      quantity       INTEGER,
      notes          TEXT,
      created_at     TEXT,
      updated_at     TEXT
    );
  `)
  pgm.sql('CREATE INDEX order_items_order_idx ON order_items (order_id);')
  pgm.sql('CREATE INDEX order_items_garden_idx ON order_items (garden_id);')

  pgm.sql(`
    CREATE TABLE order_files (
      id                   TEXT PRIMARY KEY,
      order_id             TEXT NOT NULL,
      original_file_name   TEXT,
      stored_file_name     TEXT,
      mime_type            TEXT,
      file_size            INTEGER,
      file_url             TEXT,
      source_type          TEXT,
      created_at           TEXT
    );
  `)
  pgm.sql('CREATE INDEX order_files_order_idx ON order_files (order_id);')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS order_files;')
  pgm.sql('DROP TABLE IF EXISTS order_items;')
  pgm.sql('DROP TABLE IF EXISTS orders;')
}
