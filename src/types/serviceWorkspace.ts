import type { PriceMenuGroup, PriceMenuItem } from '../utils/priceMenu';
import type { ProjectCatalogItem, ProjectCatalogQuery } from '../utils/projectCatalog';
import type { BusinessLifecycle } from '../utils/businessLifecycle';
import type { MediaDraftTransport } from '../utils/mediaDraft';

// Mirrored transport contract: backend service-workspace.contract.ts. Keep IDs strings.
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
export type WorkspaceDisplayUpsert = ({ id: string } | { tempKey: string }) & { target?: WorkspaceTarget; group?: WorkspaceGroupRef; position?: number; changes: WorkspaceDisplayChanges };
export interface WorkspaceCommandBase { action: WorkspaceAction; idempotencyKey: string; expectedPriceMenuRevision: string; }
export interface SaveServiceWorkspace extends WorkspaceCommandBase {
  action: 'SAVE_SERVICE_WORKSPACE'; serviceId?: string; expectedSelectionRevision?: string;
  service?: WorkspaceServiceChanges; policy?: WorkspacePolicyChanges; variants?: WorkspaceUpsert<WorkspaceVariantChanges>[];
  addOns?: WorkspaceUpsert<WorkspaceAddOnChanges>[]; newGroups?: { tempKey: string; category: string }[]; displays?: WorkspaceDisplayUpsert[];
}
export interface SaveMenuLayout extends WorkspaceCommandBase {
  action: 'SAVE_MENU_LAYOUT'; groups?: ({ index: number; category: string } | { tempKey: string; category: string })[];
  groupOrder?: WorkspaceGroupRef[]; moves?: { itemId: string; group: WorkspaceGroupRef; position: number }[];
  removeGroups?: { index: number; moveTo: WorkspaceGroupRef }[];
}
export interface SaveLegacyDisplay extends WorkspaceCommandBase {
  action: 'SAVE_LEGACY_DISPLAY'; itemId: string; changes: { name?: string; priceText?: string; description?: string; imageUrl?: string; isVisible?: boolean };
}
export interface RemoveMenuDisplay extends WorkspaceCommandBase { action: 'REMOVE_MENU_DISPLAY'; itemId: string; confirm: true; }
export type WorkspaceCommand = SaveServiceWorkspace | SaveMenuLayout | SaveLegacyDisplay | RemoveMenuDisplay;
export interface WorkspaceReceipt {
  operationId: string; action: WorkspaceAction | null; shopId: string; idempotencyKey: string; outcome: 'COMMITTED' | 'NOT_EXECUTED'; serviceId: string | null;
  idMap: { variants: Record<string, string>; addOns: Record<string, string>; displays: Record<string, string> };
  priceMenuRevision: string; selectionRevision: string | null; requiredPermissions: WorkspacePermission[];
  changes: { serviceFields: string[]; policyFields: string[]; variantIds: string[]; addOnIds: string[]; displayIds: string[]; layout: boolean }; warnings: string[];
}
export type WorkspaceMenuItem = PriceMenuItem & { isVisible?: boolean };
export type WorkspaceMenuGroup = Omit<PriceMenuGroup, 'items'> & { items: WorkspaceMenuItem[] };
export interface WorkspaceSnapshot { shopId: string; service: ProjectCatalogItem | null; priceMenu: WorkspaceMenuGroup[]; priceMenuRevision: string; selectionRevision: string | null; canManageCatalog: boolean; canConfigurePolicy: boolean; }
export interface ServiceWorkspaceApi {
  loadCatalog: (query: ProjectCatalogQuery, signal: AbortSignal) => Promise<unknown>;
  loadSnapshot: (serviceId?: string, signal?: AbortSignal) => Promise<unknown>;
  save: (command: WorkspaceCommand) => Promise<unknown>;
  readReceipt: (key: string, signal?: AbortSignal) => Promise<unknown>;
  reconcile: (key: string, signal?: AbortSignal) => Promise<unknown>;
}
export interface StoreServiceWorkspaceProps {
  shopId: string; scopeKey: string; api: ServiceWorkspaceApi; disabled?: boolean; revision?: string | number; isCurrent: () => boolean; beforeWrite: () => boolean;
  /** Identity is known, and the current shop authorization can now read. */
  readReady?: boolean;
  mediaTransport?: MediaDraftTransport;
  canUploadMedia?: () => boolean;
  canAbandonMedia?: () => boolean;
  onMediaDiscardReady?: (discard: (() => Promise<number>) | null) => void;
  shopImages?: readonly string[];
  onLifecycleChange: (state: BusinessLifecycle) => void;
  onSaved?: (result: { snapshot: WorkspaceSnapshot; receipt: WorkspaceReceipt }) => void | Promise<void>;
  focus?: { serviceId: string; variantId?: string; itemId?: string; revision: string | number; pane?: 'metadata' | 'booking' };
  onSelectService?: (serviceId: string) => void;
  /** Optional existing protected conversion/removal tool; never a second daily editor. */
  onOpenLegacyTools?: () => void;
}
export interface WorkspaceVariantDraft { key: string; id?: string; name: string; duration: string; price: string; isActive: boolean; sortOrder: string; }
export interface WorkspaceAddOnDraft { key: string; id?: string; name: string; description: string; price: string; isActive: boolean; sortOrder: string; }
export interface WorkspaceDisplayDraft {
  key: string; id?: string; target: WorkspaceTarget; group: string; position: string; name: string; description: string; imageUrl: string; isVisible: boolean; titleMode: 'AUTO' | 'CUSTOM';
}
export interface ServiceWorkspaceDraft {
  serviceId?: string; name: string; description: string; category: string; durationKind: string; isActive: boolean; duration: string; price: string;
  participantCount: string; requiredStaffCount: string; requiredRoomType: string; staffBuffer: string; roomBuffer: string;
  variants: WorkspaceVariantDraft[]; addOns: WorkspaceAddOnDraft[]; displays: WorkspaceDisplayDraft[];
  newGroups: { key: string; category: string }[]; defaultGroup: string; defaultImage: string;
}
export interface WorkspaceFieldIssue { field: string; message: string; }
