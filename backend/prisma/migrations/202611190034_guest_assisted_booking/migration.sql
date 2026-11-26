ALTER TABLE `bookings`
  MODIFY `user_id` BIGINT NULL,
  ADD COLUMN `booking_source` VARCHAR(30) NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN `assisted_by_id` BIGINT NULL,
  ADD COLUMN `guest_source` VARCHAR(20) NULL,
  ADD INDEX `bookings_assisted_request_key` (`shop_id`, `assisted_by_id`, `request_key`),
  ADD CONSTRAINT `bookings_assisted_by_id_fkey` FOREIGN KEY (`assisted_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Store EMAIL jobs may belong to an unlinked guest booking; never attribute
-- them to its assisting operator or invent a customer account.
ALTER TABLE `notification_outbox` MODIFY `user_id` BIGINT NULL;

CREATE TABLE `guest_booking_operations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop_id` BIGINT NOT NULL,
  `operator_id` BIGINT NOT NULL,
  `request_key` VARCHAR(36) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `outcome` VARCHAR(20) NOT NULL,
  `booking_id` BIGINT NULL,
  `booking_no` VARCHAR(30) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `guest_booking_operations_booking_id_key` (`booking_id`),
  UNIQUE INDEX `guest_booking_operations_actor_key` (`shop_id`, `operator_id`, `request_key`),
  CONSTRAINT `guest_booking_operations_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `guest_booking_operations_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `guest_booking_operations_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
