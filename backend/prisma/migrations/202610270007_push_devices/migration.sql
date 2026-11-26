-- No delivery credentials can be recovered from the previous process-local map.
-- Clients must register again. Only this new, initially empty table is created.
CREATE TABLE `push_devices` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `auth_session_id` VARCHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `token` TEXT NOT NULL,
  `binding_version` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `push_devices_token_hash_key` (`token_hash`),
  INDEX `push_devices_user_id_updated_at_idx` (`user_id`, `updated_at`),
  INDEX `push_devices_auth_session_id_idx` (`auth_session_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `push_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `push_devices_auth_session_id_fkey` FOREIGN KEY (`auth_session_id`) REFERENCES `auth_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
