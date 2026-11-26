-- Preserve the timezone used when booking, even if the shop later changes it.
ALTER TABLE `bookings` ADD COLUMN `booking_timezone` VARCHAR(80) NULL;
UPDATE `bookings` AS b
INNER JOIN `shops` AS s ON s.`id` = b.`shop_id`
SET b.`booking_timezone` = s.`timezone`
WHERE b.`booking_timezone` IS NULL AND s.`timezone` IS NOT NULL;
