CREATE TABLE `email_password_recovery_challenges` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `credential_hash` CHAR(64) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `delivery_state` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `email_password_recovery_challenges_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `email_password_recovery_challenges_expires_at_idx` (`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
