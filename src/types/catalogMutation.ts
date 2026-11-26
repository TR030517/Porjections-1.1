/** The same atomic catalog command is used by company and merchant clients. */
export type CatalogMutationAction = 'CREATE_SERVICE' | 'CREATE_VARIANT' | 'LINK_EXISTING_VARIANT';
export interface CatalogMutationRequest {
  action: CatalogMutationAction;
  /** Retain this key and the exact payload until the server outcome is known. */
  idempotencyKey: string;
  expectedPriceMenuRevision: string;
  expectedSelectionRevision?: string;
  serviceId?: string;
  variantId?: string;
  service?: {
    name: string;
    description?: string;
    category?: 'MASSAGE' | 'REFLEXOLOGY' | 'CUPPING' | 'SCRAPING' | 'HEAD_THERAPY' | 'OTHER';
    durationKind?: 'TIMED' | 'PER_SESSION' | 'VARIABLE';
    isActive?: boolean;
  };
  variant?: { name: string; durationMin: number; priceCents: number; isActive?: boolean; sortOrder?: number };
  /** Omit to create a catalog option without adding a customer menu row. */
  display?: { groupIndex: number; newGroupCategory?: never } | { newGroupCategory: string; groupIndex?: never };
}
export interface CatalogMutationReceipt {
  operationId: string;
  action: CatalogMutationAction;
  shopId: string;
  serviceId: string;
  variantId: string;
  created: { service: boolean; variant: boolean; display: boolean };
  displayStatus: 'NOT_REQUESTED' | 'ADDED' | 'ALREADY_LINKED';
  displayItemId: string | null;
  /** A replay returns the original snapshot. Reload the menu and catalog after success. */
  priceMenuRevision: string;
  selectionRevision: string;
}
