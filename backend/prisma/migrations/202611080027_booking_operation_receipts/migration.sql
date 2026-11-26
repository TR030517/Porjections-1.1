-- Additive command evidence. No existing order, shop, account or lock is changed.
CREATE TABLE `booking_operation_receipts` (
    `id` VARCHAR(36) NOT NULL,
    `actor_id` BIGINT NOT NULL,
    `booking_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `request_key` VARCHAR(100) NOT NULL,
    `action` VARCHAR(40) NULL,
    `request_hash` CHAR(64) NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `booking_operation_actor_booking_key` (`actor_id`, `booking_id`, `request_key`),
    INDEX `booking_operation_shop_created_idx` (`shop_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
