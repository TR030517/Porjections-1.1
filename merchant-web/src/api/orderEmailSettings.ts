import client from './client';
import { readOrderEmailSettings, type OrderEmailSettingsApi } from '../../../src/utils/orderEmailSettings';

export function orderEmailSettingsApi(shopId: string): OrderEmailSettingsApi {
  const base = `/merchant/shops/${encodeURIComponent(shopId)}/order-email-settings`;
  const post = async (action: string, body: unknown) => readOrderEmailSettings((await client.post(`${base}/${action}`, body)).data, shopId);
  return { read: async signal => readOrderEmailSettings((await client.get(base, { signal })).data, shopId),
    request: input => post('verification', input), verify: input => post('verify', input), disable: input => post('disable', input) };
}
