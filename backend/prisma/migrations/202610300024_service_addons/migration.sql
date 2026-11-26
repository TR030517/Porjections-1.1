-- Additive only. Historical bookings, prices, resources and financial rows are unchanged.
CREATE TABLE `shop_service_addons` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `service_id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `price_cents` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'usd',
  `is_active` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `service_addons_service_active_sort_idx` (`service_id`, `is_active`, `sort_order`),
  CONSTRAINT `shop_service_addons_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `shop_services` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_addons` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT NOT NULL,
  `booking_item_id` BIGINT NOT NULL,
  `source_addon_id` BIGINT NOT NULL,
  `participant_index` INTEGER NOT NULL,
  `sequence` INTEGER NOT NULL,
  `name_snapshot` VARCHAR(100) NOT NULL,
  `unit_price_cents_snapshot` INTEGER NOT NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `line_total_cents_snapshot` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `booking_addons_item_source_key` (`booking_item_id`, `source_addon_id`),
  INDEX `booking_addons_booking_idx` (`booking_id`),
  INDEX `booking_addons_source_idx` (`source_addon_id`),
  CONSTRAINT `booking_addons_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `booking_addons_booking_item_id_fkey` FOREIGN KEY (`booking_item_id`) REFERENCES `booking_items` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `booking_addons_source_addon_id_fkey` FOREIGN KEY (`source_addon_id`) REFERENCES `shop_service_addons` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
