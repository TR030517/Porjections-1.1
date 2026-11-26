-- Additive only. Historical bookings intentionally keep NULL contacts.
-- Do not backfill from users: today's profile is not an order-time fact.
ALTER TABLE `bookings`
    ADD COLUMN `contact_name` VARCHAR(100) NULL,
    ADD COLUMN `contact_phone` VARCHAR(16) NULL,
    ADD COLUMN `contact_email` VARCHAR(255) NULL,
    ADD COLUMN `contact_version` INTEGER NULL,
    ADD COLUMN `contact_source` VARCHAR(40) NULL,
    ADD COLUMN `contact_email_verified_at` DATETIME(3) NULL;
