export type IntakeField = 'description' | 'businessHours';
export interface IntakeIssue { code: string; field?: string; message: string; }
export interface IntakeFieldPreview { field: IntakeField; state: 'FILL' | 'UNCHANGED' | 'KEEP_EXISTING'; current: unknown; incoming: unknown; }
export interface IntakeShopPreview {
  sourceId: string; sourceUrls: string[]; targetShopId: string; name: string; shortName: string;
  currentTarget: { name: string; shortName: string | null; address: string } | null;
  status: 'READY' | 'UNCHANGED' | 'INVALID'; issues: IntakeIssue[]; fields: IntakeFieldPreview[];
  missing: Array<{ key: string; label: string }>; rawCatalogItems: number;
}
export interface IntakePreview {
  packageDigest: string; previewToken: string | null; expiresAt: string | null; canApply: boolean;
  summary: { shops: number; readyShops: number; fillFields: number; unchangedFields: number; keptFields: number; invalidShops: number; rawCatalogItems: number };
  shops: IntakeShopPreview[];
}
export interface IntakeReceipt {
  operationId: string; appliedAt: string; requestKey: string; packageDigest: string;
  summary: { shops: number; changedShops: number; changedFields: number; unchangedShops: number };
  shops: Array<{ sourceId: string; targetShopId: string; changedFields: IntakeField[] }>;
}
export type IntakeTerminal = { found: true; state: 'APPLIED'; receipt: IntakeReceipt }
  | { found: true; state: 'NOT_APPLIED'; requestKey: string; packageDigest: string; resolvedAt: string };
