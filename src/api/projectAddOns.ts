import { apiRequest } from './session';
import type { ProjectAddOnPayload } from '../utils/projectAddOns';

/** Parent validation and receipt verification live in the scoped edit attempt. */
export function sendProjectAddOn(path: string, method: 'POST' | 'PATCH', payload: ProjectAddOnPayload & { serviceId?: string }): Promise<unknown> {
  return apiRequest(path, { method, body: JSON.stringify(payload) });
}
