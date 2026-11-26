/** Single-service differential commands. IDs are exact strings; omission never
 * means deletion. No command accepts shop/account/publication changes. */
export type WorkspaceAction = 'SAVE_SERVICE_WORKSPACE' | 'SAVE_MENU_LAYOUT' | 'SAVE_LEGACY_DISPLAY' | 'REMOVE_MENU_DISPLAY';
export type WorkspacePermission = 'CATALOG_MANAGE' | 'RESERVATION_CONFIG';
export type WorkspaceGroupRef = { index: number } | { tempKey: string };
export type WorkspaceTarget = { kind: 'SERVICE' } | { kind: 'VARIANT' | 'ADD_ON'; id: string } | { kind: 'VARIANT' | 'ADD_ON'; tempKey: string };
export interface WorkspaceServiceChanges {
  name?: string; description?: string | null; category?: 'MASSAGE' | 'REFLEXOLOGY' | 'CUPPING' | 'SCRAPING' | 'HEAD_THERAPY' | 'OTHER';
  durationKind?: 'TIMED' | 'PER_SESSION' | 'VARIABLE'; isActive?: boolean; durationMin?: number; priceCents?: number; sortOrder?: number;
}
export interface WorkspacePolicyChanges { participantCount?: number; requiredStaffCount?: number; requiredRoomType?: 'SINGLE' | 'COUPLE' | 'FOOT_SEAT' | null; staffBufferMin?: number; roomBufferMin?: number; }
export interface WorkspaceVariantChanges { name?: string; durationMin?: number; priceCents?: number; isActive?: boolean; sortOrder?: number; }
export interface WorkspaceAddOnChanges { name?: string; description?: string | null; priceCents?: number; isActive?: boolean; sortOrder?: number; }
export interface WorkspaceDisplayChanges { name?: string; description?: string; imageUrl?: string; isVisible?: boolean; titleMode?: 'AUTO' | 'CUSTOM'; }
export type WorkspaceUpsert<T> = ({ id: string } | { tempKey: string }) & { changes: T };
export type WorkspaceDisplayUpsert = ({ id: string } | { tempKey: string }) & {
  /** Required for new displays, or explicit conversion of a pure unbound legacy
   * row. An existing booking binding can never be rebound. */
  target?: WorkspaceTarget; group?: WorkspaceGroupRef; position?: number; changes: WorkspaceDisplayChanges;
};
export interface WorkspaceCommandBase { action: WorkspaceAction; idempotencyKey: string; expectedPriceMenuRevision: string; }
export interface SaveServiceWorkspace extends WorkspaceCommandBase {
  action: 'SAVE_SERVICE_WORKSPACE'; serviceId?: string; expectedSelectionRevision?: string;
  service?: WorkspaceServiceChanges; policy?: WorkspacePolicyChanges;
  variants?: WorkspaceUpsert<WorkspaceVariantChanges>[]; addOns?: WorkspaceUpsert<WorkspaceAddOnChanges>[];
  newGroups?: { tempKey: string; category: string }[]; displays?: WorkspaceDisplayUpsert[];
}
export interface SaveMenuLayout extends WorkspaceCommandBase {
  action: 'SAVE_MENU_LAYOUT'; groups?: ({ index: number; category: string } | { tempKey: string; category: string })[];
  /** Complete group permutation only when explicitly supplied. Item omission
   * never removes a row; moves apply to the fresh full stored menu. */
  groupOrder?: WorkspaceGroupRef[]; moves?: { itemId: string; group: WorkspaceGroupRef; position: number }[];
  removeGroups?: { index: number; moveTo: WorkspaceGroupRef }[];
}
export interface SaveLegacyDisplay extends WorkspaceCommandBase {
  action: 'SAVE_LEGACY_DISPLAY'; itemId: string;
  changes: { name?: string; priceText?: string; description?: string; imageUrl?: string; isVisible?: boolean };
}
export interface RemoveMenuDisplay extends WorkspaceCommandBase {
  action: 'REMOVE_MENU_DISPLAY'; itemId: string; confirm: true;
}
export type WorkspaceCommand = SaveServiceWorkspace | SaveMenuLayout | SaveLegacyDisplay | RemoveMenuDisplay;
export interface WorkspaceReceipt {
  operationId: string; action: WorkspaceAction | null; shopId: string; idempotencyKey: string;
  outcome: 'COMMITTED' | 'NOT_EXECUTED'; serviceId: string | null;
  idMap: { variants: Record<string, string>; addOns: Record<string, string>; displays: Record<string, string> };
  priceMenuRevision: string; selectionRevision: string | null; requiredPermissions: WorkspacePermission[];
  changes: { serviceFields: string[]; policyFields: string[]; variantIds: string[]; addOnIds: string[]; displayIds: string[]; layout: boolean };
  warnings: string[];
}
export interface WorkspaceSnapshot {
  shopId: string; service: any | null; priceMenu: any[]; priceMenuRevision: string; selectionRevision: string | null;
  canManageCatalog: boolean; canConfigurePolicy: boolean;
}
/** Routes, all authenticated ADMIN/MERCHANT/STAFF; STAFF remains rules-only:
 * GET  /reservation-admin/shops/:shopId/service-workspace-actions/snapshot?serviceId=<optional>
 * POST /reservation-admin/shops/:shopId/service-workspace-actions             WorkspaceCommand -> WorkspaceReceipt
 * GET  /reservation-admin/shops/:shopId/service-workspace-actions/:key        -> WorkspaceReceipt (404 is unknown)
 * POST /reservation-admin/shops/:shopId/service-workspace-actions/:key/reconcile -> WorkspaceReceipt
 * Reconcile {} waits on the SAME shop lock, returns COMMITTED or persists a
 * NOT_EXECUTED fence. A fenced key cannot subsequently save. Never generate a
 * replacement key while unknown. Receipts authorize stored requiredPermissions;
 * rules-only roles can recover their own rules-only command. All receipts are
 * scoped to actor+key+shop. A committed receipt is not a fresh state snapshot:
 * read snapshot after success and compare before showing fully saved.
 * Existing service needs BOTH revisions. Create omits serviceId/selectionRevision,
 * supplies service.name, and at least one tempKey variant with explicit name,
 * durationMin (5..240), priceCents (1..10000000); all amounts integer USD cents.
 * New extras require name+priceCents (0 permitted), duration is never accepted.
 * Group indices refer to the FULL baseline menu bound to expected revision.
 * tempKey is [A-Za-z][A-Za-z0-9_-]{0,63}; saved row IDs never change.
 */
