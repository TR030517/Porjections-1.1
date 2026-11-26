import type { CatalogMutationReceipt, CatalogMutationRequest } from '../types/catalogMutation';
import { projectCatalogId } from './projectCatalog';

/** A write is acknowledged only after its complete, scoped receipt is verified. */
export function readCatalogMutationReceipt(value: unknown, shopId: string, request?: CatalogMutationRequest): CatalogMutationReceipt {
  const row = value as CatalogMutationReceipt | null;
  if (!row || typeof row !== 'object' || row.shopId !== shopId || !projectCatalogId(row.serviceId) || !projectCatalogId(row.variantId)
    || typeof row.operationId !== 'string' || !row.operationId || !['CREATE_SERVICE', 'CREATE_VARIANT', 'LINK_EXISTING_VARIANT'].includes(row.action)
    || !/^[a-f0-9]{64}$/.test(row.priceMenuRevision) || !/^[a-f0-9]{64}$/.test(row.selectionRevision)
    || !row.created || ['service', 'variant', 'display'].some(key => typeof row.created[key as keyof typeof row.created] !== 'boolean')
    || !['NOT_REQUESTED', 'ADDED', 'ALREADY_LINKED'].includes(row.displayStatus)
    || (row.displayStatus === 'NOT_REQUESTED' ? row.displayItemId !== null
      : row.displayStatus === 'ADDED' ? typeof row.displayItemId !== 'string' || !row.displayItemId
        : row.displayItemId !== null && (typeof row.displayItemId !== 'string' || !row.displayItemId))) {
    throw Error('保存回执不完整，结果待核对；请保留当前输入。');
  }
  if (request && (row.action !== request.action || request.serviceId !== undefined && row.serviceId !== request.serviceId
    || request.variantId !== undefined && row.variantId !== request.variantId || !!request.display !== (row.displayStatus !== 'NOT_REQUESTED'))) {
    throw Error('保存回执与本次服务或展示请求不符，结果待核对。');
  }
  return row;
}

export function catalogMutationRejected(error: unknown): boolean {
  const candidate = error as { status?: number; response?: { status?: number } } | null;
  const status = candidate?.status ?? candidate?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408;
}
