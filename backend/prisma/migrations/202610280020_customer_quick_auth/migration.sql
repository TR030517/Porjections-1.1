ALTER TABLE `users` MODIFY `phone` VARCHAR(20) NULL, ADD COLUMN `email_verified_at` DATETIME(3) NULL;
CREATE TABLE `auth_provider_identities` (
 `id` VARCHAR(36) NOT NULL, `user_id` BIGINT NOT NULL,
 `provider` VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 `subject` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), UNIQUE INDEX `auth_provider_identities_provider_subject_key` (`provider`,`subject`),
 INDEX `auth_provider_identities_user_id_idx` (`user_id`),
 CONSTRAINT `auth_provider_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `social_login_challenges` (
 `id` VARCHAR(36) NOT NULL, `provider` VARCHAR(10) NOT NULL, `nonce_hash` VARCHAR(64) NOT NULL,
 `expires_at` DATETIME(3) NOT NULL, `consumed_at` DATETIME(3) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), INDEX `social_login_challenges_expires_at_idx` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `email_login_challenges` (
 `id` VARCHAR(36) NOT NULL, `email` VARCHAR(255) NOT NULL, `code_hash` VARCHAR(64) NOT NULL,
 `delivery_state` VARCHAR(20) NOT NULL DEFAULT 'PENDING', `attempts` INTEGER NOT NULL DEFAULT 0,
 `expires_at` DATETIME(3) NOT NULL, `consumed_at` DATETIME(3) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), INDEX `email_login_challenges_email_created_at_idx` (`email`,`created_at`),
 INDEX `email_login_challenges_expires_at_idx` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `email_login_throttles` (
 `email` VARCHAR(255) NOT NULL, `last_sent_at` DATETIME(3) NOT NULL,
 `window_start` DATETIME(3) NOT NULL, `send_count` INTEGER NOT NULL,
 PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
