-- Additive only. Historical deleted_at rows require evidence-based review;
-- this migration deliberately does not reclassify or restore them.
ALTER TABLE `bookings` ADD COLUMN `customer_hidden_at` DATETIME(3) NULL;
