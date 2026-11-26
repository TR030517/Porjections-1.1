export const CATALOG_CATEGORIES = ['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'] as const;
export type CatalogCategory = typeof CATALOG_CATEGORIES[number];
export type CatalogActor = { id: string; role: string };

export interface CatalogVariant {
  name: string;
  durationMin: number;
  priceCents: number;
  sourceRows: number[];
}
export interface CatalogGroup {
  key: string;
  name: string;
  category: CatalogCategory;
  description: string | null;
  sourceRows: number[];
  variants: CatalogVariant[];
}
export interface ParsedCatalog {
  shopId: string;
  packageDigest: string;
  inputRows: number;
  duplicateRows: number;
  groups: CatalogGroup[];
}
export interface CatalogPreviewGroup extends CatalogGroup {
  action: 'CREATE' | 'SKIP';
  reason: string;
  existingIds: string[];
}
export interface CatalogPreview {
  shop: { id: string; name: string };
  currency: 'USD';
  packageDigest: string;
  canApply: boolean;
  previewToken: string | null;
  expiresAt: string | null;
  summary: {
    inputRows: number;
    groups: number;
    newServices: number;
    newVariants: number;
    skippedServices: number;
    duplicateRows: number;
  };
  groups: CatalogPreviewGroup[];
}
export interface CatalogReceipt {
  operationId: string;
  requestKey: string;
  packageDigest: string;
  shopId: string;
  appliedAt: string;
  summary: { createdServices: number; createdVariants: number; skippedServices: number };
  created: Array<{ serviceId: string; name: string; variantIds: string[] }>;
  skipped: Array<{ name: string; existingIds: string[] }>;
  replayed?: boolean;
}
export type CatalogTerminal = { found: true; state: 'APPLIED'; receipt: CatalogReceipt }
  | { found: true; state: 'NOT_APPLIED'; requestKey: string; packageDigest: string; shopId: string; resolvedAt: string };
export type CatalogResult = CatalogTerminal | { found: false };
