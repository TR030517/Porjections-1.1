export interface TherapistSelection {
  therapistSelectionMode?: 'AUTO' | 'SPECIFIC' | 'LEGACY_UNKNOWN';
  requestedTherapistIds?: string[];
}

export function savedTherapistRequest(value: TherapistSelection): Required<TherapistSelection> {
  if (value.therapistSelectionMode == null || value.therapistSelectionMode === 'LEGACY_UNKNOWN') return { therapistSelectionMode: 'LEGACY_UNKNOWN', requestedTherapistIds: [] };
  const ids = value.requestedTherapistIds;
  if (!['AUTO', 'SPECIFIC'].includes(value.therapistSelectionMode) || !Array.isArray(ids)
    || ids.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length
    || value.therapistSelectionMode === 'AUTO' && ids.length || value.therapistSelectionMode === 'SPECIFIC' && !ids.length) throw new Error('无法核对订单保存的技师请求，请刷新订单。');
  return { therapistSelectionMode: value.therapistSelectionMode, requestedTherapistIds: [...ids] };
}

export function therapistRequestLabel(value: TherapistSelection): string {
  const request = savedTherapistRequest(value);
  if (request.therapistSelectionMode === 'SPECIFIC') return `明确指定：${request.requestedTherapistIds.map(id => `#${id}`).join('、')}`;
  return request.therapistSelectionMode === 'AUTO' ? '自动分配' : '历史订单 · 原选择未记录';
}

export function therapistMoveNotice(value: TherapistSelection & { reservationKind?: string }): string {
  if (value.reservationKind === 'PLAN') return '逐段保留原技师请求；自动分配及原选择未记录的服务段可能重新分配，请保存后核对实际安排。指定技师不可用时将拒绝改期，原预约保留。';
  if (value.therapistSelectionMode === 'SPECIFIC') return '保留已指定技师；不可用时须选择其他时间。未指定的名额仍由系统分配，可能变化，请保存后核对实际安排。';
  return value.therapistSelectionMode === 'AUTO' ? '技师由系统自动安排，改期时可能更换。保存即确认按新时段重新分配，请保存后核对实际安排。' : '该历史订单未记录原选择，不能推断为主动指定。改期可能更换技师，请保存后核对实际安排。';
}
