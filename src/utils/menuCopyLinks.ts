export interface MenuCopyLink {
  resource: 'SERVICE' | 'VARIANT' | 'ADD_ON'; sourceId: string; sourceServiceId: string;
  targetId: string | null; targetServiceId: string | null; name: string; action: 'CREATE' | 'REUSE';
}
/** Preview metadata only. Apply always submits the signed plan, never these IDs. */
export function checkedMenuCopyLinks(value: unknown): MenuCopyLink[] {
  const invalid = () => new Error('项目价目关联复制计划格式无效，请重新预览。');
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw invalid(); return value;
  };
  if (!Array.isArray(value) || value.length > 3000) throw invalid();
  const parents = new Map<string, string | null>(), seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
    const row = raw as Record<string, unknown>, sourceId = id(row.sourceId), sourceServiceId = id(row.sourceServiceId);
    const targetId = row.targetId === null ? null : id(row.targetId), targetServiceId = row.targetServiceId === null ? null : id(row.targetServiceId);
    if (!['SERVICE', 'VARIANT', 'ADD_ON'].includes(String(row.resource)) || !['CREATE', 'REUSE'].includes(String(row.action))
      || row.action === 'CREATE' && targetId !== null || row.action === 'REUSE' && targetId === null
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(row.name)) throw invalid();
    const identity = `${row.resource}:${sourceId}`;
    if (seen.has(identity)) throw invalid(); seen.add(identity);
    if (row.resource === 'SERVICE') {
      if (sourceId !== sourceServiceId || targetId !== targetServiceId || parents.has(sourceId)) throw invalid(); parents.set(sourceId, targetId);
    } else if (!parents.has(sourceServiceId) || parents.get(sourceServiceId) !== targetServiceId || targetServiceId === null && targetId !== null) throw invalid();
    return { resource: row.resource as MenuCopyLink['resource'], sourceId, sourceServiceId, targetId, targetServiceId, name: row.name, action: row.action as MenuCopyLink['action'] };
  });
}
