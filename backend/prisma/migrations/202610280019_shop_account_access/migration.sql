-- Additive login/access separation only. Historical owner_id, ledgers and data
-- remain untouched. Existing shops intentionally remain UNBOUND until ADMIN acts.
CREATE TABLE `shop_login_bindings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `created_by_id` BIGINT NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `shop_login_bindings_shop_id_key` (`shop_id`),
  UNIQUE INDEX `shop_login_bindings_user_id_key` (`user_id`),
  INDEX `shop_login_bindings_created_by_id_idx` (`created_by_id`),
  CONSTRAINT `shop_login_bindings_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_login_bindings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_login_bindings_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_account_grants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `source_shop_id` BIGINT NOT NULL,
  `target_shop_id` BIGINT NOT NULL,
  `permissions` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by_id` BIGINT NOT NULL,
  `updated_by_id` BIGINT NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `revoked_by_id` BIGINT NULL,
  `revoked_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `shop_account_grants_source_shop_id_target_shop_id_key` (`source_shop_id`, `target_shop_id`),
  INDEX `shop_account_grants_target_shop_id_status_idx` (`target_shop_id`, `status`),
  INDEX `shop_account_grants_source_shop_id_status_idx` (`source_shop_id`, `status`),
  INDEX `shop_account_grants_created_by_id_idx` (`created_by_id`),
  INDEX `shop_account_grants_updated_by_id_idx` (`updated_by_id`),
  INDEX `shop_account_grants_revoked_by_id_idx` (`revoked_by_id`),
  CONSTRAINT `shop_account_grants_source_shop_id_fkey` FOREIGN KEY (`source_shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_account_grants_target_shop_id_fkey` FOREIGN KEY (`target_shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_account_grants_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_account_grants_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_account_grants_revoked_by_id_fkey` FOREIGN KEY (`revoked_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `shop_account_grants_distinct_shops` CHECK (`source_shop_id` <> `target_shop_id`),
  CONSTRAINT `shop_account_grants_status_check` CHECK (`status` IN ('ACTIVE', 'REVOKED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
