-- Additive reservation resources. Historical bookings keep nullable request/hold fields,
-- no fabricated assignments, and retain all existing financial references and statuses.
ALTER TABLE `shop_services`
  ADD COLUMN `participant_count` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `required_staff_count` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `required_room_type` VARCHAR(20) NULL,
  ADD COLUMN `staff_buffer_min` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `room_buffer_min` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `bookings`
  ADD COLUMN `request_key` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `hold_expires_at` DATETIME(3) NULL,
  ADD UNIQUE INDEX `bookings_user_request_key` (`user_id`, `request_key`),
  ADD INDEX `bookings_hold_expiry_idx` (`status`, `payment_status`, `hold_expires_at`);

CREATE TABLE `shop_service_variants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `service_id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `duration_min` INTEGER NOT NULL,
  `price_cents` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'usd',
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `service_variants_service_active_sort_idx` (`service_id`, `is_active`, `sort_order`),
  PRIMARY KEY (`id`),
  CONSTRAINT `shop_service_variants_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `shop_services` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `therapist_shifts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `therapist_id` BIGINT NOT NULL,
  `weekday` INTEGER NOT NULL,
  `start_min` INTEGER NOT NULL,
  `end_min` INTEGER NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `therapist_shifts_day_active_idx` (`therapist_id`, `weekday`, `is_active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `therapist_shifts_therapist_id_fkey` FOREIGN KEY (`therapist_id`) REFERENCES `therapists` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `therapist_time_off` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `therapist_id` BIGINT NOT NULL,
  `start_at_utc` DATETIME(3) NOT NULL,
  `end_at_utc` DATETIME(3) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `therapist_time_off_window_idx` (`therapist_id`, `start_at_utc`, `end_at_utc`),
  PRIMARY KEY (`id`),
  CONSTRAINT `therapist_time_off_therapist_id_fkey` FOREIGN KEY (`therapist_id`) REFERENCES `therapists` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_rooms` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop_id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `room_type` VARCHAR(20) NOT NULL,
  `capacity` INTEGER NOT NULL DEFAULT 1,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `shop_rooms_type_active_idx` (`shop_id`, `room_type`, `is_active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `shop_rooms_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `room_maintenance` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `room_id` BIGINT NOT NULL,
  `start_at_utc` DATETIME(3) NOT NULL,
  `end_at_utc` DATETIME(3) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `room_maintenance_window_idx` (`room_id`, `start_at_utc`, `end_at_utc`),
  PRIMARY KEY (`id`),
  CONSTRAINT `room_maintenance_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `shop_rooms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT NOT NULL,
  `service_id` BIGINT NOT NULL,
  `variant_id` BIGINT NULL,
  `participant_index` INTEGER NOT NULL,
  `service_name_snapshot` VARCHAR(200) NOT NULL,
  `variant_name_snapshot` VARCHAR(100) NULL,
  `room_type_snapshot` VARCHAR(20) NULL,
  `duration_min` INTEGER NOT NULL,
  `staff_buffer_min` INTEGER NOT NULL,
  `room_buffer_min` INTEGER NOT NULL,
  `price_cents_snapshot` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `assigned_room_id` BIGINT NULL,
  `start_at_utc` DATETIME(3) NOT NULL,
  `end_at_utc` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `booking_items_participant_key` (`booking_id`, `participant_index`),
  INDEX `booking_items_service_idx` (`service_id`),
  INDEX `booking_items_variant_idx` (`variant_id`),
  INDEX `booking_items_room_idx` (`assigned_room_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `booking_items_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `booking_items_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `shop_services` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `booking_items_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `shop_service_variants` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `booking_items_assigned_room_id_fkey` FOREIGN KEY (`assigned_room_id`) REFERENCES `shop_rooms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_resource_locks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT NOT NULL,
  `booking_item_id` BIGINT NULL,
  `shop_id` BIGINT NOT NULL,
  `resource_type` VARCHAR(20) NOT NULL,
  `resource_id` BIGINT NOT NULL,
  `start_at_utc` DATETIME(3) NOT NULL,
  `end_at_utc` DATETIME(3) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `booking_resources_overlap_idx` (`shop_id`, `resource_type`, `status`, `start_at_utc`, `end_at_utc`),
  INDEX `booking_resource_window_idx` (`resource_type`, `resource_id`, `status`, `start_at_utc`, `end_at_utc`),
  INDEX `booking_resources_booking_idx` (`booking_id`, `status`),
  INDEX `booking_resources_item_idx` (`booking_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `booking_resource_locks_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `booking_resource_locks_booking_item_id_fkey` FOREIGN KEY (`booking_item_id`) REFERENCES `booking_items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `booking_resource_locks_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
