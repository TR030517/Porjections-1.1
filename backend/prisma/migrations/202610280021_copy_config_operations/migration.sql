-- Immutable copy result snapshots. No update to historical ownership or financial data.
CREATE TABLE `copy_config_operations` (
  `id` VARCHAR(36) NOT NULL,
  `actor_id` BIGINT NOT NULL,
  `source_shop_id` BIGINT NOT NULL,
  `target_shop_id` BIGINT NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `copy_config_actor_key` (`actor_id`,`idempotency_key`),
  INDEX `copy_config_target_created_idx` (`target_shop_id`,`created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
