export type ReadinessAction = { kind: 'store-section'; section: 'basic' | 'brand' | 'hours' | 'review' }
  | { kind: 'accounts' } | { kind: 'services' } | { kind: 'technicians' }
  | { kind: 'reservation'; tab: 'services' | 'therapists' | 'rooms'; serviceId?: string; therapistId?: string };
export interface ReadinessCheck {
  key: string; label: string; state: 'PASS' | 'ATTENTION' | 'INFO'; detail: string; action?: ReadinessAction;
}
export interface ShopReadiness {
  schemaVersion: 1;
  checkedAt: string;
  shop: { id: string; name: string; status: string };
  publication: { ready: boolean; publicVisible: boolean; checks: ReadinessCheck[] };
  access: { loginReady: boolean; checks: ReadinessCheck[] };
  booking: { enabled: boolean; payAtStoreEnabled: boolean; checks: ReadinessCheck[] };
  presentation: { checks: ReadinessCheck[] };
  services: Array<{ id: string; name: string; isActive: boolean; mode: 'LEGACY' | 'VARIANTS'; checks: ReadinessCheck[] }>;
  summary: { activeServices: number; disabledServices: number; activeServicesWithFindings: number };
  limitations: string[];
}
export type ReadinessActor = { id: string; role: string };
