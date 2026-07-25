// systemConfig's one live doc (learnedProjectionActive) is folded into the existing app_config
// table (key/value store, already created for appCheck) instead of a new one-row table.
export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE photo_embeddings (
      id                     TEXT PRIMARY KEY,
      garden_id              TEXT,
      cultivar_name          TEXT,
      image_url              TEXT,
      thumbnail_url          TEXT,
      embedding              JSONB NOT NULL,
      model                  TEXT,
      embedding_model        TEXT,
      preprocessing_version  TEXT,
      segmentation_applied   BOOLEAN,
      color                  TEXT,
      form                   TEXT,
      color_embedding        JSONB,
      color_features         JSONB,
      created_at             TEXT
    );
  `)
  pgm.sql('CREATE INDEX photo_embeddings_garden_idx ON photo_embeddings (garden_id);')
  pgm.sql('CREATE INDEX photo_embeddings_model_version_idx ON photo_embeddings (embedding_model, preprocessing_version);')

  pgm.sql(`
    CREATE TABLE cultivar_centroids (
      id                     TEXT PRIMARY KEY,
      garden_id              TEXT,
      cultivar_name          TEXT,
      embedding_model        TEXT,
      preprocessing_version  TEXT,
      centroids              JSONB NOT NULL,
      color_centroid         JSONB,
      clustering_applied     BOOLEAN,
      source_photo_count     INTEGER,
      computed_at            TEXT
    );
  `)
  pgm.sql('CREATE INDEX cultivar_centroids_garden_model_version_idx ON cultivar_centroids (garden_id, embedding_model, preprocessing_version);')

  // matrix is stored directly as JSONB rather than a Storage blob: the original Firestore design
  // split it out only because a full matrix exceeds Firestore's ~1MiB per-document limit, which
  // doesn't apply here, and the matrix must stay private (never made public) — routing it through
  // the existing Azure Blob container (which is public-read) would have been a real regression.
  pgm.sql(`
    CREATE TABLE learned_projections (
      id                          TEXT PRIMARY KEY,
      embedding_model             TEXT,
      preprocessing_version       TEXT,
      projection_version          TEXT,
      matrix                      JSONB NOT NULL,
      input_dim                   INTEGER,
      output_dim                  INTEGER,
      trained_at_photo_count      INTEGER,
      trained_at_cultivar_count   INTEGER,
      metrics                     JSONB,
      created_at                  TEXT
    );
  `)

  pgm.sql('ALTER TABLE photo_embeddings ADD CONSTRAINT photo_embeddings_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE cultivar_centroids ADD CONSTRAINT cultivar_centroids_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE SET NULL;')
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS learned_projections;')
  pgm.sql('DROP TABLE IF EXISTS cultivar_centroids;')
  pgm.sql('DROP TABLE IF EXISTS photo_embeddings;')
}
