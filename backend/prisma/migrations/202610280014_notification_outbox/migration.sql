-- Additive durable notifications only. Does not backfill or send historical messages.
CREATE TABLE `notification_outbox` (
 `id` CHAR(36) NOT NULL,
 `event_key` VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 `content_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 `user_id` BIGINT NOT NULL,
 `topic` VARCHAR(40) NOT NULL,
 `resource_type` VARCHAR(30) NOT NULL,
 `resource_id` VARCHAR(100) NOT NULL,
 `booking_id` BIGINT NULL,
 `expected_start_at_utc` DATETIME(3) NULL,
 `channel` VARCHAR(10) NOT NULL,
 `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 `run_at` DATETIME(3) NOT NULL,
 `attempts` INTEGER NOT NULL DEFAULT 0,
 `retry_count` INTEGER NOT NULL DEFAULT 0,
 `max_attempts` INTEGER NOT NULL DEFAULT 5,
 `lease_token` CHAR(36) NULL,
 `lease_until` DATETIME(3) NULL,
 `last_error_code` VARCHAR(64) NULL,
 `accepted_count` INTEGER NOT NULL DEFAULT 0,
 `data_json` JSON NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `finished_at` DATETIME(3) NULL,
 PRIMARY KEY (`id`),
 UNIQUE INDEX `notification_outbox_event_key_channel_key` (`event_key`,`channel`),
 INDEX `notification_outbox_status_run_at_idx` (`status`,`run_at`),
 INDEX `notification_outbox_booking_id_topic_status_idx` (`booking_id`,`topic`,`status`),
 CONSTRAINT `notification_outbox_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_notifications` (
 `id` CHAR(36) NOT NULL,
 `outbox_id` CHAR(36) NOT NULL,
 `user_id` BIGINT NOT NULL,
 `topic` VARCHAR(40) NOT NULL,
 `title` VARCHAR(200) NOT NULL,
 `body` VARCHAR(1000) NOT NULL,
 `resource_type` VARCHAR(30) NOT NULL,
 `resource_id` VARCHAR(100) NOT NULL,
 `booking_id` BIGINT NULL,
 `read_at` DATETIME(3) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`),
 UNIQUE INDEX `user_notifications_outbox_id_key` (`outbox_id`),
 INDEX `user_notifications_user_id_created_at_id_idx` (`user_id`,`created_at`,`id`),
 INDEX `user_notifications_user_id_read_at_idx` (`user_id`,`read_at`),
 CONSTRAINT `user_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT `user_notifications_outbox_id_fkey` FOREIGN KEY (`outbox_id`) REFERENCES `notification_outbox`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
 `user_id` BIGINT NOT NULL,
 `push_enabled` BOOLEAN NOT NULL DEFAULT false,
 `push_consented_at` DATETIME(3) NULL,
 `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`user_id`),
 CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
