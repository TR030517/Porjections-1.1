export interface ProjectEditorState { dirty: boolean; busy: boolean; unknown: boolean }
export const EMPTY_PROJECT_EDITOR: ProjectEditorState = { dirty: false, busy: false, unknown: false };
export type ProjectPane = 'metadata' | 'booking';
const validProjectId = (value: string) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const validDisplayId = (value: string) => /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function requestedProjectFocus(search: string) {
  const params = new URLSearchParams(search);
  const read = (key: string, valid: (value: string) => boolean): string | null => {
    const values = params.getAll(key);
    return !values.length ? null : values.length === 1 && valid(values[0]) ? values[0] : '';
  };
  const serviceId = read('serviceId', validProjectId), variantId = read('variantId', validProjectId), itemId = read('itemId', validDisplayId);
  return { serviceId, variantId, itemId, invalid: serviceId === '' || variantId === '' || itemId === '' || (variantId !== null || itemId !== null) && !serviceId };
}
export function projectWorkspaceHref(shopId: string, serviceId?: string, pane: ProjectPane = 'metadata', focus: { variantId?: string; itemId?: string } = {}) {
  if (!validProjectId(shopId) || serviceId !== undefined && !validProjectId(serviceId)
    || focus.variantId !== undefined && !validProjectId(focus.variantId) || focus.itemId !== undefined && !validDisplayId(focus.itemId)
    || (focus.variantId !== undefined || focus.itemId !== undefined) && serviceId === undefined) throw Error('项目入口无效，请重新选择本店项目。');
  return '/price-menu?' + new URLSearchParams({ shopId, pane, ...(serviceId ? { serviceId } : {}), ...(focus.variantId ? { variantId: focus.variantId } : {}), ...(focus.itemId ? { itemId: focus.itemId } : {}) });
}
export function projectWriteAllowed(menu: { dirty: boolean; busy: boolean; conflict: boolean }, other: ProjectEditorState) {
  return !menu.dirty && !menu.busy && !menu.conflict && !other.dirty && !other.busy && !other.unknown;
}
export interface EmbeddedProjectEditor {
  shopId: string; serviceId: string; disabled?: boolean; revision?: number; initialRulesOpen?: boolean;
  beforeWrite: () => boolean;
  onLifecycleChange: (state: ProjectEditorState) => void;
  onSaved: () => Promise<void>;
}
