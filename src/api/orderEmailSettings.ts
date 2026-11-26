import { apiRequest } from './session';
import { readOrderEmailSettings, type OrderEmailSettingsApi } from '../utils/orderEmailSettings';

export function orderEmailSettingsApi(shopId: string): OrderEmailSettingsApi {
  const base = `/merchant/shops/${encodeURIComponent(shopId)}/order-email-settings`;
  const post = async (action: string, body: unknown) => readOrderEmailSettings(await apiRequest(`${base}/${action}`, { method: 'POST', body: JSON.stringify(body) }), shopId);
  return {
    read: async signal => readOrderEmailSettings(await apiRequest(base, { signal }), shopId),
    request: input => post('verification', input), verify: input => post('verify', input), disable: input => post('disable', input),
  };
}
