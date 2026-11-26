ALTER TABLE `payment_records`
  ADD COLUMN `provider_order_id` VARCHAR(255) NULL,
  ADD COLUMN `checkout_url` VARCHAR(2048) NULL;
CREATE UNIQUE INDEX `payment_records_provider_order_id_key` ON `payment_records`(`provider_order_id`);
