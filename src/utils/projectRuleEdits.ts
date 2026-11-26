import type { ReservationService } from '../types/reservations';

export function exactProjectId(value: unknown): string | null {
  const id = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n ? id : null;
}
/** The focused editor never selects another project's first row. */
export function focusedReservationService(services: ReservationService[] | undefined, shopId: unknown, serviceId: unknown): ReservationService | undefined {
  const shop = exactProjectId(shopId), service = exactProjectId(serviceId);
  return shop && service ? services?.find(row => exactProjectId(row.id) === service && exactProjectId(row.shopId) === shop) : undefined;
}
export function projectWriteAllowed(current: () => boolean, beforeWrite?: () => boolean): boolean {
  return current() && (!beforeWrite || beforeWrite() === true) && current();
}
export interface ProjectEditState { dirty: boolean; busy: boolean; unknown: boolean }
export function combinedProjectState(states: readonly ProjectEditState[]): ProjectEditState {
  return { dirty: states.some(state => state.dirty), busy: states.some(state => state.busy), unknown: states.some(state => state.unknown) };
}
/** Inline editors keep separate drafts. A save may refresh shared service data,
 * so an unfinished sibling must block it without disabling its own recovery. */
export function projectSiblingsBlocked(states: Record<string, ProjectEditState>, own: string): boolean {
  return Object.entries(states).some(([key, state]) => key !== own && (state.dirty || state.busy || state.unknown));
}
export function reservationRulesTab(tab: string | undefined, serviceOnly = false, resourcesOnly = false): 'services' | 'therapists' | 'rooms' {
  if (serviceOnly) return 'services';
  if (resourcesOnly) return tab === 'rooms' ? 'rooms' : 'therapists';
  return tab === 'therapists' || tab === 'rooms' ? tab : 'services';
}
/** Recheck after the user's confirmation: a menu draft, identity or project may
 * have changed while the dialog was open. Close/discard does not use this gate. */
export async function confirmProjectWrite(current: () => boolean, beforeWrite: (() => boolean) | undefined, confirm: () => Promise<boolean>, write: () => Promise<void>): Promise<boolean> {
  if (!projectWriteAllowed(current, beforeWrite) || !await confirm() || !projectWriteAllowed(current, beforeWrite)) return false;
  await write(); return true;
}
