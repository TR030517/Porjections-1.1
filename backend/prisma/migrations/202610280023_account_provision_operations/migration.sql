-- Additive provisioning evidence only. Existing identities, login bindings,
-- financial owners and merchant ledgers are neither inferred nor changed.
CREATE TABLE `account_provision_operations` (
  `id` VARCHAR(36) NOT NULL,
  `actor_id` BIGINT NOT NULL,
  `shop_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `idempotency_key` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `account_provision_actor_key` (`actor_id`, `idempotency_key`),
  INDEX `account_provision_shop_created_idx` (`shop_id`, `created_at`),
  INDEX `account_provision_user_idx` (`user_id`),
  CONSTRAINT `account_provision_actor_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `account_provision_shop_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `account_provision_user_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `account_provision_status_check` CHECK (`status` = 'APPLIED')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
