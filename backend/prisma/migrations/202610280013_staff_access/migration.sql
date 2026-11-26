ALTER TABLE `users` MODIFY `role` ENUM('CUSTOMER', 'MERCHANT', 'ADMIN', 'STAFF') NOT NULL DEFAULT 'CUSTOMER';
CREATE TABLE `shop_staff_grants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `created_by_id` BIGINT NOT NULL,
  `permissions` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `shop_staff_grants_shop_id_user_id_key` (`shop_id`, `user_id`),
  INDEX `shop_staff_grants_user_id_status_idx` (`user_id`, `status`),
  INDEX `shop_staff_grants_created_by_id_idx` (`created_by_id`),
  CONSTRAINT `shop_staff_grants_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shop_staff_grants_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shop_staff_grants_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
