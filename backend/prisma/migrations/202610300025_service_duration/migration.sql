-- Only two defaulted metadata columns. No UPDATE/backfill or historical quote/resource rewrite.
ALTER TABLE `shop_services` ADD COLUMN `duration_kind` VARCHAR(20) NOT NULL DEFAULT 'TIMED';
ALTER TABLE `booking_items` ADD COLUMN `duration_kind_snapshot` VARCHAR(20) NOT NULL DEFAULT 'TIMED';
