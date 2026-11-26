import { publicEmail } from './publicContacts';

export type StoreOrderEmailReadiness = 'READY' | 'MISSING' | 'INVALID' | 'UNKNOWN';

/** Legacy contact-format check only. READY here never proves receipt ownership;
 * notification UI must read the dedicated order-email-settings endpoint. */
export function storeOrderEmailReadiness(emails: unknown): StoreOrderEmailReadiness {
  if (!Array.isArray(emails)) return 'UNKNOWN';
  const candidates = emails.slice(0, 5);
  if (candidates.some(value => publicEmail(value))) return 'READY';
  return candidates.every(value => typeof value === 'string' && !value.trim()) ? 'MISSING' : 'INVALID';
}

/** Parse the publicly displayed contact list, independently of notification recipients. */
export function storeOrderEmailsFromDraft(value: string): string[] {
  const emails = value.split(/\r?\n/).map(email => email.trim()).filter(Boolean);
  if (emails.length > 5) throw new Error('联系邮箱最多填写 5 条，每行一条。');
  if (emails.some(email => !publicEmail(email))) throw new Error('请填写有效的联系邮箱，每行一条。');
  return emails;
}
