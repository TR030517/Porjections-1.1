-- A separate, immutable-by-tool preservation area. No live identities, balances,
-- booking resources, payment success or usable gift rights are created.
CREATE TABLE legacy_staging_batches (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  singleton INTEGER NOT NULL DEFAULT 1,
  plan_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dataset_kind VARCHAR(20) NOT NULL,
  summary JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id), UNIQUE INDEX legacy_staging_batches_singleton_key(singleton),
  CONSTRAINT legacy_staging_single_batch CHECK (singleton = 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE legacy_staging_entities (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_table VARCHAR(63) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(32) NOT NULL,
  shop_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payload JSON NOT NULL,
  payload_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY(id), UNIQUE INDEX legacy_staging_source_identity(source_system,source_table,source_id),
  INDEX legacy_staging_batch_kind_idx(batch_id,kind), INDEX legacy_staging_shop_kind_idx(shop_key,kind),
  CONSTRAINT legacy_staging_entities_batch_id_fkey FOREIGN KEY(batch_id) REFERENCES legacy_staging_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
