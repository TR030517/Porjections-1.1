export interface StaffMember {
  id: string; shopId: string; name: string; avatarUrl: string | null; title: string | null;
  bio: string | null; yearsExp: number; gender: string | null; isActive: boolean;
  scheduleMode: 'SHOP' | 'CUSTOM'; sortOrder: number;
}
export interface StaffingSnapshot {
  shopId: string; activeCount: number; revision: string; serviceAccessMode: 'SHOP_ALL';
  canManageStaff: boolean; canManageExceptions: boolean; therapists: StaffMember[];
  createdIds?: string[]; deactivatedIds?: string[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
function invalid(): never { throw Error('无法核对本店人数和人员资料，请重新读取；当前输入已保留。'); }
export function readStaffingSnapshot(raw: unknown, shopId: string): StaffingSnapshot {
  if (!identifier(shopId) || !record(raw) || raw.shopId !== shopId || raw.serviceAccessMode !== 'SHOP_ALL'
    || typeof raw.revision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.revision)
    || typeof raw.activeCount !== 'number' || !Number.isSafeInteger(raw.activeCount) || raw.activeCount < 0
    || typeof raw.canManageStaff !== 'boolean' || typeof raw.canManageExceptions !== 'boolean'
    || !Array.isArray(raw.therapists) || raw.therapists.length > 1000) invalid();
  const seen = new Set<string>();
  const therapists = raw.therapists.map((row): StaffMember => {
    if (!record(row) || !identifier(row.id) || seen.has(row.id) || row.shopId !== shopId || typeof row.name !== 'string' || !row.name.trim()
      || typeof row.isActive !== 'boolean' || !['SHOP', 'CUSTOM'].includes(String(row.scheduleMode))
      || typeof row.yearsExp !== 'number' || !Number.isSafeInteger(row.yearsExp) || typeof row.sortOrder !== 'number' || !Number.isSafeInteger(row.sortOrder)
      || ['avatarUrl', 'title', 'bio', 'gender'].some(key => row[key] !== null && typeof row[key] !== 'string')) invalid();
    seen.add(row.id); return { ...row } as unknown as StaffMember;
  });
  if (raw.activeCount !== therapists.filter(row => row.isActive).length) invalid();
  const result: StaffingSnapshot = { shopId, revision: raw.revision, activeCount: raw.activeCount, serviceAccessMode: 'SHOP_ALL',
    canManageStaff: raw.canManageStaff, canManageExceptions: raw.canManageExceptions, therapists };
  if (Object.hasOwn(raw, 'createdIds') || Object.hasOwn(raw, 'deactivatedIds')) {
    const changes = new Set<string>();
    for (const key of ['createdIds', 'deactivatedIds'] as const) {
      const ids = raw[key]; if (!Array.isArray(ids) || ids.length > 1000) invalid();
      for (const id of ids) {
        if (!identifier(id) || changes.has(id) || !seen.has(id)) invalid();
        const row = therapists.find(person => person.id === id)!;
        if (key === 'createdIds' ? !row.isActive || row.scheduleMode !== 'SHOP' : row.isActive) invalid();
        changes.add(id);
      }
      result[key] = [...ids];
    }
  }
  return result;
}
export function buildStaffingPayload(count: unknown, revision: unknown) {
  const value = typeof count === 'string' && /^[0-9]{1,3}$/.test(count.trim()) ? Number(count.trim()) : count;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) throw Error('技师人数须为0至100的整数。');
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw Error('请先重新读取本店当前人数。');
  return { targetActiveCount: value, expectedRevision: revision };
}
export function staffingDisplayName(name: string): string {
  const generated = /^Therapist ([1-9][0-9]*)$/.exec(name);
  return generated ? generated[1] + '号技师' : name;
}
