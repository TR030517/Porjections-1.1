-- Historical bookings retain ONLINE. No historical payment or balance is invented.
ALTER TABLE `bookings` ADD COLUMN `payment_mode` VARCHAR(20) NOT NULL DEFAULT 'ONLINE';

CREATE TABLE `booking_settlement_entries` (
  `id` VARCHAR(36) NOT NULL,
  `booking_id` BIGINT NOT NULL,
  `operator_id` BIGINT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `amount_cents` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `method` VARCHAR(30) NULL,
  `request_key` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `reference_entry_id` VARCHAR(36) NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `booking_settlements_booking_request_key` (`booking_id`, `request_key`),
  INDEX `booking_settlements_booking_created_idx` (`booking_id`, `created_at`),
  INDEX `booking_settlements_reference_idx` (`reference_entry_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `booking_settlement_entries` ADD CONSTRAINT `booking_settlements_booking_fk` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_settlement_entries` ADD CONSTRAINT `booking_settlements_operator_fk` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_settlement_entries` ADD CONSTRAINT `booking_settlements_reference_fk` FOREIGN KEY (`reference_entry_id`) REFERENCES `booking_settlement_entries`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
