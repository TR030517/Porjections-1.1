import { create } from 'zustand';
import {
  applyCopy, resolveCopy, checkedCopyInput, checkedCopyRequest, checkedCopyPreview,
  checkedCopyResult, checkedCopyResolution,
} from '../api/accountAccess';
import { useAuthStore } from './authStore';
import { createCopyRecoveryModel, type RecoverableCopy } from './copyRecoveryModel';

export type { RecoverableCopy } from './copyRecoveryModel';
export { COPY_RECOVERY_STORAGE_KEY } from './copyRecoveryModel';
interface RecoveryState { operation: RecoverableCopy | null; storageWarning: string }
const recovery = createCopyRecoveryModel({
  storage: () => typeof sessionStorage === 'undefined' ? null : sessionStorage,
  apply: applyCopy, resolve: resolveCopy,
  validators: { input: checkedCopyInput, request: checkedCopyRequest, preview: checkedCopyPreview, result: checkedCopyResult, resolution: checkedCopyResolution },
});
export const useCopyRecoveryStore = create<RecoveryState>(() => ({ operation: null, storageWarning: '' }));
recovery.subscribe(() => {
  const { operation, storageWarning } = recovery.getSnapshot();
  useCopyRecoveryStore.setState({ operation, storageWarning });
});
function syncSession(state: ReturnType<typeof useAuthStore.getState>) {
  recovery.syncSession({
    initialized: state.initialized,
    authenticated: Boolean(state.token),
    actor: state.merchant,
    explicitLogout: state.explicitLogout,
  });
}
useAuthStore.subscribe(syncSession);
syncSession(useAuthStore.getState());

export const beginRecoverableCopy = recovery.begin;
export const retryRecoverableCopy = recovery.retry;
export const checkRecoverableCopy = recovery.check;
export const finishRecoverableCopy = recovery.finish;
