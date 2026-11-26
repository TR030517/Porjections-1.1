-- Keep legacy quotes non-collectible; no historical payment or entitlement is fabricated.
ALTER TABLE gift_card_orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN payment_method VARCHAR(20) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE gift_card_entitlements ADD COLUMN purchase_key CHAR(64) NULL,
  ADD UNIQUE INDEX gift_card_entitlements_purchase_key_key(purchase_key);
CREATE TABLE shop_gift_sales_policies (
  shop_id BIGINT NOT NULL, pay_at_store_enabled BOOLEAN NOT NULL DEFAULT false, updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY(shop_id), CONSTRAINT shop_gift_sales_policies_shop_id_fkey FOREIGN KEY(shop_id) REFERENCES shops(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE gift_card_sale_entries (
  id CHAR(36) NOT NULL, order_id BIGINT NOT NULL, operator_id BIGINT NOT NULL, kind VARCHAR(10) NOT NULL,
  amount_cents INTEGER NOT NULL, method VARCHAR(20) NOT NULL, reference VARCHAR(100) NULL, reason VARCHAR(500) NOT NULL,
  request_key CHAR(64) NOT NULL, request_hash CHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id), UNIQUE INDEX gift_card_sale_entries_request_key_key(request_key),
  UNIQUE INDEX gift_card_sale_entries_order_id_kind_key(order_id,kind), INDEX gift_card_sale_entries_operator_id_idx(operator_id),
  CONSTRAINT gift_card_sale_entries_order_id_fkey FOREIGN KEY(order_id) REFERENCES gift_card_orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT gift_card_sale_entries_operator_id_fkey FOREIGN KEY(operator_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
