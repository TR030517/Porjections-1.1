-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `rotated_to` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_sessions_token_hash_key`(`token_hash`),
    INDEX `auth_sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_records` (
    `id` VARCHAR(36) NOT NULL,
    `booking_id` BIGINT NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `provider_payment_id` VARCHAR(255) NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    `refunded_cents` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_records_booking_id_key`(`booking_id`),
    UNIQUE INDEX `payment_records_provider_payment_id_key`(`provider_payment_id`),
    UNIQUE INDEX `payment_records_idempotency_key_key`(`idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_events` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `event_id` VARCHAR(255) NOT NULL,
    `payload_hash` VARCHAR(64) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_events_provider_event_id_key`(`provider`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_requests` (
    `id` VARCHAR(36) NOT NULL,
    `booking_id` BIGINT NOT NULL,
    `payment_record_id` VARCHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `provider_refund_id` VARCHAR(255) NULL,
    `failure_code` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refund_requests_idempotency_key_key`(`idempotency_key`),
    UNIQUE INDEX `refund_requests_provider_refund_id_key`(`provider_refund_id`),
    INDEX `refund_requests_booking_id_status_idx`(`booking_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NULL,
    `name` VARCHAR(100) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `role` ENUM('CUSTOMER', 'MERCHANT', 'ADMIN') NOT NULL DEFAULT 'CUSTOMER',
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `apple_id` VARCHAR(255) NULL,
    `google_id` VARCHAR(255) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_phone_key`(`phone`),
    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_apple_id_key`(`apple_id`),
    UNIQUE INDEX `users_google_id_key`(`google_id`),
    INDEX `users_phone_idx`(`phone`),
    INDEX `users_role_status_idx`(`role`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shops` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `owner_id` BIGINT NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `short_name` VARCHAR(100) NULL,
    `timezone` VARCHAR(100) NULL,
    `studio_profile` JSON NULL,
    `name_en` VARCHAR(200) NULL,
    `description` TEXT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `state` VARCHAR(50) NOT NULL,
    `zip_code` VARCHAR(10) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `category` ENUM('TUINA', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'MIXED') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
    `review_comment` TEXT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reviewed_by` BIGINT NULL,
    `shop_type` ENUM('CERTIFIED', 'APPRENTICE') NOT NULL DEFAULT 'APPRENTICE',
    `business_hours` JSON NULL,
    `avg_rating` DECIMAL(3, 2) NOT NULL DEFAULT 0.00,
    `review_count` INTEGER NOT NULL DEFAULT 0,
    `booking_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `shops_short_name_key`(`short_name`),
    INDEX `shops_status_idx`(`status`),
    INDEX `shops_latitude_longitude_idx`(`latitude`, `longitude`),
    INDEX `shops_city_state_idx`(`city`, `state`),
    INDEX `shops_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `regions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(10) NOT NULL,
    `parent_id` BIGINT NULL,
    `abbr` VARCHAR(10) NOT NULL DEFAULT '',
    `english` VARCHAR(200) NOT NULL,
    `chinese` VARCHAR(200) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT '启用',
    `sort` INTEGER NOT NULL DEFAULT 100,
    `zip_code` VARCHAR(30) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `regions_kind_parent_id_idx`(`kind`, `parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_services` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NULL,
    `category` ENUM('MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER') NOT NULL,
    `duration_min` INTEGER NOT NULL,
    `price_cents` INTEGER NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shop_services_shop_id_is_active_idx`(`shop_id`, `is_active`),
    INDEX `shop_services_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `therapists` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `avatar_url` VARCHAR(500) NULL,
    `title` VARCHAR(100) NULL,
    `bio` TEXT NULL,
    `years_exp` INTEGER NOT NULL DEFAULT 0,
    `gender` VARCHAR(10) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `therapists_shop_id_is_active_idx`(`shop_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `therapist_services` (
    `therapist_id` BIGINT NOT NULL,
    `service_id` BIGINT NOT NULL,

    PRIMARY KEY (`therapist_id`, `service_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bookings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `booking_no` VARCHAR(30) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `therapist_id` BIGINT NULL,
    `service_id` BIGINT NOT NULL,
    `booking_date` DATETIME(3) NOT NULL,
    `start_time` DATETIME(3) NOT NULL,
    `end_time` DATETIME(3) NOT NULL,
    `duration_min` INTEGER NOT NULL,
    `price_cents` INTEGER NOT NULL,
    `discount_cents` INTEGER NOT NULL DEFAULT 0,
    `platform_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `total_cents` INTEGER NOT NULL DEFAULT 0,
    `paid_cents` INTEGER NOT NULL DEFAULT 0,
    `refunded_cents` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'usd',
    `coupon_id` BIGINT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `cancel_reason` VARCHAR(500) NULL,
    `payment_id` VARCHAR(255) NULL,
    `payment_status` ENUM('UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'UNPAID',
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `bookings_booking_no_key`(`booking_no`),
    INDEX `bookings_user_id_status_idx`(`user_id`, `status`),
    INDEX `bookings_shop_id_status_idx`(`shop_id`, `status`),
    INDEX `bookings_booking_date_idx`(`booking_date`),
    INDEX `bookings_booking_no_idx`(`booking_no`),
    INDEX `bookings_payment_status_idx`(`payment_status`),
    INDEX `bookings_coupon_id_idx`(`coupon_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `booking_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `rating` INTEGER NOT NULL,
    `content` TEXT NULL,
    `images` JSON NULL,
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `is_flagged` BOOLEAN NOT NULL DEFAULT false,
    `reply_content` TEXT NULL,
    `replied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reviews_booking_id_key`(`booking_id`),
    INDEX `reviews_shop_id_is_public_idx`(`shop_id`, `is_public`),
    INDEX `reviews_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_favorites` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_favorites_user_id_idx`(`user_id`),
    INDEX `user_favorites_shop_id_idx`(`shop_id`),
    UNIQUE INDEX `user_favorites_user_id_shop_id_key`(`user_id`, `shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_images` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NOT NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `image_type` ENUM('STORE_FRONT', 'INTERIOR', 'CERTIFICATE') NOT NULL DEFAULT 'STORE_FRONT',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shop_images_shop_id_idx`(`shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_certificates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NOT NULL,
    `certificate_type` ENUM('MASSAGE_LICENSE', 'BUSINESS_LICENSE', 'INSURANCE') NOT NULL DEFAULT 'MASSAGE_LICENSE',
    `file_url` VARCHAR(500) NOT NULL,
    `expiry_date` DATETIME(3) NULL,
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `verified_at` DATETIME(3) NULL,
    `verified_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shop_certificates_shop_id_idx`(`shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_profiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `stripe_account_id` VARCHAR(255) NULL,
    `stripe_onboarding` BOOLEAN NOT NULL DEFAULT false,
    `payout_method` VARCHAR(50) NULL,
    `payout_schedule` VARCHAR(191) NOT NULL DEFAULT 'weekly',
    `balance_cents` INTEGER NOT NULL DEFAULT 0,
    `pending_cents` INTEGER NOT NULL DEFAULT 0,
    `total_earned_cents` INTEGER NOT NULL DEFAULT 0,
    `tax_id` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_profiles_user_id_key`(`user_id`),
    UNIQUE INDEX `merchant_profiles_shop_id_key`(`shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_transactions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `profile_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `amount` INTEGER NOT NULL,
    `fee` INTEGER NOT NULL DEFAULT 0,
    `net` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL,
    `booking_id` BIGINT NULL,
    `description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `merchant_transactions_profile_id_created_at_idx`(`profile_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sensitive_words` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `word` VARCHAR(200) NOT NULL,
    `category` VARCHAR(20) NOT NULL DEFAULT 'DEFAULT',
    `severity` VARCHAR(10) NOT NULL DEFAULT 'HIGH',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sensitive_words_word_key`(`word`),
    INDEX `sensitive_words_word_idx`(`word`),
    INDEX `sensitive_words_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sensitive_hit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `word_id` BIGINT NOT NULL,
    `word` VARCHAR(200) NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` BIGINT NOT NULL,
    `content` VARCHAR(200) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `blocked` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sensitive_hit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `sensitive_hit_logs_created_at_idx`(`created_at`),
    INDEX `sensitive_hit_logs_word_id_idx`(`word_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(100) NOT NULL,
    `target_type` VARCHAR(50) NOT NULL,
    `target_id` BIGINT NOT NULL,
    `operator_id` BIGINT NOT NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_logs_operator_id_idx`(`operator_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'STRING',
    `description` TEXT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_configs_key_key`(`key`),
    INDEX `platform_configs_key_idx`(`key`),
    INDEX `platform_configs_isPublic_idx`(`isPublic`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `name_en` VARCHAR(100) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `categories_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(500) NOT NULL,
    `content` TEXT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'INFO',
    `scope` VARCHAR(20) NOT NULL DEFAULT 'ALL',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `start_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `end_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `announcements_isActive_start_at_end_at_idx`(`isActive`, `start_at`, `end_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `home_banners` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `target_type` VARCHAR(30) NOT NULL DEFAULT 'NONE',
    `target_value` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `start_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `end_at` DATETIME(3) NULL,
    `click_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `home_banners_is_active_sort_order_idx`(`is_active`, `sort_order`),
    INDEX `home_banners_start_at_end_at_idx`(`start_at`, `end_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NULL,
    `type` ENUM('FIXED_AMOUNT', 'PERCENT') NOT NULL,
    `value` INTEGER NOT NULL,
    `min_spend_cents` INTEGER NOT NULL DEFAULT 0,
    `total_quantity` INTEGER NOT NULL DEFAULT 0,
    `claimed_count` INTEGER NOT NULL DEFAULT 0,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `per_user_limit` INTEGER NOT NULL DEFAULT 1,
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `coupons_shop_id_status_idx`(`shop_id`, `status`),
    INDEX `coupons_status_valid_from_valid_until_idx`(`status`, `valid_from`, `valid_until`),
    INDEX `coupons_claimed_count_idx`(`claimed_count`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_coupons` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `coupon_id` BIGINT NOT NULL,
    `status` ENUM('UNUSED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'UNUSED',
    `claimed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `used_at` DATETIME(3) NULL,
    `expired_at` DATETIME(3) NULL,
    `booking_id` BIGINT NULL,

    UNIQUE INDEX `user_coupons_booking_id_key`(`booking_id`),
    INDEX `user_coupons_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_coupons_coupon_id_idx`(`coupon_id`),
    UNIQUE INDEX `user_coupons_user_id_coupon_id_key`(`user_id`, `coupon_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_card_products` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `shop_id` BIGINT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `price_cents` INTEGER NOT NULL,
    `use_times` INTEGER NOT NULL DEFAULT 1,
    `expire_days` INTEGER NOT NULL DEFAULT 365,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `gift_card_products_shop_id_status_idx`(`shop_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_card_orders` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(40) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `product_id` BIGINT NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `paid_cents` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `provider_payment_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gift_card_orders_order_no_key`(`order_no`),
    UNIQUE INDEX `gift_card_orders_provider_payment_id_key`(`provider_payment_id`),
    INDEX `gift_card_orders_shop_id_created_at_idx`(`shop_id`, `created_at`),
    INDEX `gift_card_orders_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_card_entitlements` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `product_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `total_uses` INTEGER NOT NULL,
    `remaining_uses` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `grant_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gift_card_entitlements_token_hash_key`(`token_hash`),
    INDEX `gift_card_entitlements_user_id_status_idx`(`user_id`, `status`),
    INDEX `gift_card_entitlements_shop_id_idx`(`shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_card_redemptions` (
    `id` VARCHAR(36) NOT NULL,
    `entitlement_id` VARCHAR(36) NOT NULL,
    `operator_id` BIGINT NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `used_uses` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gift_card_redemptions_idempotency_key_key`(`idempotency_key`),
    INDEX `gift_card_redemptions_entitlement_id_created_at_idx`(`entitlement_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_records` ADD CONSTRAINT `payment_records_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_payment_record_id_fkey` FOREIGN KEY (`payment_record_id`) REFERENCES `payment_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shops` ADD CONSTRAINT `shops_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shops` ADD CONSTRAINT `shops_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_services` ADD CONSTRAINT `shop_services_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `therapists` ADD CONSTRAINT `therapists_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `therapist_services` ADD CONSTRAINT `therapist_services_therapist_id_fkey` FOREIGN KEY (`therapist_id`) REFERENCES `therapists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `therapist_services` ADD CONSTRAINT `therapist_services_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `shop_services`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_therapist_id_fkey` FOREIGN KEY (`therapist_id`) REFERENCES `therapists`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `shop_services`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_favorites` ADD CONSTRAINT `user_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_favorites` ADD CONSTRAINT `user_favorites_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_images` ADD CONSTRAINT `shop_images_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_certificates` ADD CONSTRAINT `shop_certificates_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_profiles` ADD CONSTRAINT `merchant_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_transactions` ADD CONSTRAINT `merchant_transactions_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `merchant_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sensitive_hit_logs` ADD CONSTRAINT `sensitive_hit_logs_word_id_fkey` FOREIGN KEY (`word_id`) REFERENCES `sensitive_words`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sensitive_hit_logs` ADD CONSTRAINT `sensitive_hit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_products` ADD CONSTRAINT `gift_card_products_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_orders` ADD CONSTRAINT `gift_card_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_orders` ADD CONSTRAINT `gift_card_orders_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_orders` ADD CONSTRAINT `gift_card_orders_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `gift_card_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_entitlements` ADD CONSTRAINT `gift_card_entitlements_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_entitlements` ADD CONSTRAINT `gift_card_entitlements_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_entitlements` ADD CONSTRAINT `gift_card_entitlements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `gift_card_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_entitlements` ADD CONSTRAINT `gift_card_entitlements_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `gift_card_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_redemptions` ADD CONSTRAINT `gift_card_redemptions_entitlement_id_fkey` FOREIGN KEY (`entitlement_id`) REFERENCES `gift_card_entitlements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_redemptions` ADD CONSTRAINT `gift_card_redemptions_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

