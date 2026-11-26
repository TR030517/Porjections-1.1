-- Stable public entries. Legacy numeric IDs are NEVER inferred from shops.id.
CREATE TABLE `shop_aliases` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shop_id` BIGINT NOT NULL,
  `kind` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `value` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `shop_aliases_kind_source_value_key` (`kind`, `source`, `value`),
  INDEX `shop_aliases_shop_active_idx` (`shop_id`, `is_active`),
  CONSTRAINT `shop_aliases_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Existing short names reserve their normalized path, including unpublished
-- shops. No legacy-ID row is inserted without an audited import mapping.
INSERT INTO `shop_aliases` (`shop_id`, `kind`, `source`, `value`, `updated_at`)
SELECT `id`, 'SHORT_NAME', 'massajoy', LOWER(TRIM(`short_name`)), CURRENT_TIMESTAMP(3)
FROM `shops`
WHERE CHAR_LENGTH(TRIM(`short_name`)) BETWEEN 3 AND 100
  AND LOWER(TRIM(`short_name`)) REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$'
  AND LOWER(TRIM(`short_name`)) NOT REGEXP '^store-[0-9]+$'
  AND LOWER(TRIM(`short_name`)) NOT IN ('admin','merchant','api','auth','login','signin','signup','register','logout','s','store','shops','shop','h5','assets','icons','canvaskit','pages','static','health','favicon','robots','sitemap','payments','bookings','account','profile','home','search','about','support','terms','privacy');
