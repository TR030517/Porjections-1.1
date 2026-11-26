-- Additive atomic catalog command evidence. No existing business row is changed.
CREATE TABLE `catalog_mutation_operations` (
    `id` VARCHAR(36) NOT NULL,
    `actor_id` BIGINT NOT NULL,
    `shop_id` BIGINT NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `catalog_mutation_actor_key` (`actor_id`, `idempotency_key`),
    INDEX `catalog_mutation_shop_created_idx` (`shop_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
