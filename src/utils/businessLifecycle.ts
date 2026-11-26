/** Shared draft status only; importing it must not select an application's auth store. */
export interface BusinessLifecycle { dirty: boolean; busy: boolean; unknown: boolean; }
export const EMPTY_BUSINESS_LIFECYCLE: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
export type BusinessLifecycleListener = (state: BusinessLifecycle) => void;
