-- Preserve the state/city hierarchy during concurrent administrator operations.
ALTER TABLE `regions` ADD CONSTRAINT `regions_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `regions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
