-- Additive business workflows: preserve all historical orders and balances.
-- Request keys and credential hashes use exact byte comparisons.
-- AlterTable
ALTER TABLE `gift_card_orders` ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'usd',
    ADD COLUMN `expire_days_snapshot` INTEGER NULL,
    ADD COLUMN `product_title_snapshot` VARCHAR(200) NULL,
    ADD COLUMN `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN `request_key` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN `use_times_snapshot` INTEGER NULL;

-- AlterTable
ALTER TABLE `gift_card_entitlements` ADD COLUMN `grant_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN `grant_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN `granted_by_id` BIGINT NULL,
    ADD COLUMN `product_title_snapshot` VARCHAR(200) NULL,
    ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN `void_reason` VARCHAR(500) NULL,
    ADD COLUMN `voided_at` DATETIME(3) NULL,
    ADD COLUMN `voided_by_id` BIGINT NULL,
    ADD COLUMN `voucher_expires_at` DATETIME(3) NULL,
    ADD COLUMN `voucher_uses` INTEGER NULL;

-- AlterTable
ALTER TABLE `gift_card_redemptions` ADD COLUMN `request_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN `shop_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `after_sales_cases` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `booking_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `customer_id` BIGINT NOT NULL,
    `active_booking_id` BIGINT NULL,
    `type` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `reason` TEXT NOT NULL,
    `requested_amount_cents` INTEGER NULL,
    `currency` VARCHAR(3) NOT NULL,
    `assigned_to_id` BIGINT NULL,
    `accepted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `refund_key` VARCHAR(80) NULL,
    `refund_state` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `refund_request_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,

    UNIQUE INDEX `after_sales_cases_active_booking_id_key`(`active_booking_id`),
    UNIQUE INDEX `after_sales_cases_refund_key_key`(`refund_key`),
    UNIQUE INDEX `after_sales_cases_refund_request_id_key`(`refund_request_id`),
    INDEX `after_sales_cases_shop_id_status_created_at_idx`(`shop_id`, `status`, `created_at`),
    INDEX `after_sales_cases_customer_id_status_created_at_idx`(`customer_id`, `status`, `created_at`),
    INDEX `after_sales_cases_booking_id_idx`(`booking_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `after_sales_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `case_id` BIGINT NOT NULL,
    `actor_id` BIGINT NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `visibility` VARCHAR(10) NOT NULL,
    `content` TEXT NULL,
    `from_status` VARCHAR(20) NULL,
    `to_status` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `after_sales_events_case_id_id_idx`(`case_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `gift_orders_user_request_key` ON `gift_card_orders`(`user_id`, `request_key`);

-- CreateIndex
CREATE UNIQUE INDEX `gift_card_entitlements_grant_key_key` ON `gift_card_entitlements`(`grant_key`);

-- AddForeignKey
ALTER TABLE `after_sales_cases` ADD CONSTRAINT `after_sales_cases_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_cases` ADD CONSTRAINT `after_sales_cases_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_cases` ADD CONSTRAINT `after_sales_cases_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_cases` ADD CONSTRAINT `after_sales_cases_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_cases` ADD CONSTRAINT `after_sales_cases_refund_request_id_fkey` FOREIGN KEY (`refund_request_id`) REFERENCES `refund_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_events` ADD CONSTRAINT `after_sales_events_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `after_sales_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `after_sales_events` ADD CONSTRAINT `after_sales_events_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
