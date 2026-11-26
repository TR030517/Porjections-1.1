-- Private recipient proof, separate from public contact/profile and account login.
-- No guessed/backfilled verification. Legacy shops have no row until explicitly managed.
CREATE TABLE `shop_order_email_settings` (
  `shop_id` BIGINT NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `recipient_email` VARCHAR(255) NULL,
  `recipient_verified_at` DATETIME(3) NULL,
  `challenge_id` VARCHAR(36) NULL,
  `pending_email` VARCHAR(255) NULL,
  `code_hash` CHAR(64) NULL,
  `pending_expires_at` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `delivery_state` VARCHAR(20) NULL,
  `consumed_at` DATETIME(3) NULL,
  `last_requested_at` DATETIME(3) NULL,
  `window_start` DATETIME(3) NULL,
  `send_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`shop_id`),
  UNIQUE INDEX `shop_order_email_settings_challenge_id_key` (`challenge_id`),
  CONSTRAINT `shop_order_email_settings_shop_id_fkey` FOREIGN KEY (`shop_id`)
    REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
