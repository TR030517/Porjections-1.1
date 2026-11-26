import {
  getAnnualLedger, getAnnualLedgerCsv, getShopDashboard, getTransactions,
  type AnnualLedger, type DashboardData, type LedgerCsv, type TransactionPage,
} from '../../api/merchant';

import { errorMessage } from '../../utils/feedback';
import { financialYear } from '../../utils/financialTime';

interface Result<T> { data: T | null; loading: boolean; error: string | null }
interface TransactionQuery { page: number; pageSize: number; startDate?: string; endDate?: string }
export interface EarningsState {
  dashboard: Result<DashboardData>;
  transactions: Result<TransactionPage>;
  annual: Result<AnnualLedger>;
  query: TransactionQuery;
  year: number | null;
  exporting: boolean;
  exportError: string | null;
}
const initial = <T>(): Result<T> => ({ data: null, loading: true, error: null });
const unavailable = <T>(): Result<T> => ({ data: null, loading: false, error: null });
const failureMessage = (error: unknown): string => errorMessage(error, '无法加载门店账本。');

/** One mounted shop owns these requests. Disposing it prevents any late update or download. */
export function createEarningsModel(shopId: string, year?: number, isCurrentShop = () => true) {
  let explicitYear = year !== undefined;
  let state: EarningsState = {
    dashboard: initial(), transactions: initial(), annual: initial(),
    query: { page: 1, pageSize: 10 }, year: year ?? null, exporting: false, exportError: null,
  };
  const hidden = state;
  let active = true;
  let dashboardVersion = 0;
  let transactionVersion = 0;
  let annualVersion = 0;
  let exportVersion = 0;
  let transactionRequest: AbortController | undefined;
  let dashboardRequest: AbortController | undefined;
  let annualRequest: AbortController | undefined;
  let exportRequest: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<EarningsState>) => {
    if (!active || !isCurrentShop()) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const loadTransactions = async (query: TransactionQuery) => {
    const version = ++transactionVersion;
    transactionRequest?.abort();
    if (!active || !isCurrentShop() || state.dashboard.data?.ledgerConfigured !== true) {
      update({ query, transactions: unavailable() }); return;
    }
    transactionRequest = new AbortController();
    update({ query, transactions: initial() });
    try {
      const data = await getTransactions({ shopId, ...query }, transactionRequest.signal);
      if (data.timezone !== state.dashboard.data?.timezone) throw new Error('门店财务时区已变更，请重新检查账本。');
      if (active && isCurrentShop() && version === transactionVersion) update({ transactions: { data, loading: false, error: null } });
    } catch (error) {
      if (active && isCurrentShop() && version === transactionVersion) update({ transactions: { data: null, loading: false, error: failureMessage(error) } });
    }
  };
  const loadAnnual = async (selectedYear: number | null) => {
    const version = ++annualVersion;
    annualRequest?.abort();
    if (!active || !isCurrentShop() || selectedYear === null || state.dashboard.data?.ledgerConfigured !== true) {
      update({ year: selectedYear, annual: unavailable() }); return;
    }
    annualRequest = new AbortController();
    update({ year: selectedYear, annual: initial() });
    try {
      const data = await getAnnualLedger(shopId, selectedYear, annualRequest.signal);
      if (data.timezone !== state.dashboard.data?.timezone) throw new Error('门店财务时区已变更，请重新检查账本。');
      if (active && isCurrentShop() && version === annualVersion) update({ annual: { data, loading: false, error: null } });
    } catch (error) {
      if (active && isCurrentShop() && version === annualVersion) update({ annual: { data: null, loading: false, error: failureMessage(error) } });
    }
  };
  const loadDashboard = async () => {
    const version = ++dashboardVersion;
    dashboardRequest?.abort();
    ++transactionVersion; ++annualVersion; ++exportVersion;
    transactionRequest?.abort(); annualRequest?.abort(); exportRequest?.abort();
    update({ dashboard: initial(), transactions: initial(), annual: initial(), exporting: false, exportError: null });
    if (!active || !isCurrentShop()) return;
    dashboardRequest = new AbortController();
    try {
      const data = await getShopDashboard(shopId, undefined, undefined, dashboardRequest.signal);
      if (!active || !isCurrentShop() || version !== dashboardVersion) return;
      update({ dashboard: { data, loading: false, error: null }, year: explicitYear ? state.year : financialYear(data.timezone) });
      if (data.ledgerConfigured) await Promise.all([loadTransactions(state.query), loadAnnual(state.year)]);
      else update({ transactions: unavailable(), annual: unavailable() });
    } catch (error) {
      if (active && isCurrentShop() && version === dashboardVersion) update({ dashboard: { data: null, loading: false, error: failureMessage(error) }, transactions: unavailable(), annual: unavailable() });
    }
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => active && isCurrentShop() ? state : hidden,
    load: () => {
      // React StrictMode replays the mount effect; a replay starts new requests.
      active = true;
      return loadDashboard();
    },
    retryDashboard: loadDashboard,
    retryTransactions: () => loadTransactions(state.query),
    retryAnnual: () => loadAnnual(state.year),
    setPage: (page: number, pageSize: number) => loadTransactions({ ...state.query, page: pageSize === state.query.pageSize ? page : 1, pageSize }),
    setDates: (startDate?: string, endDate?: string) => loadTransactions({ page: 1, pageSize: state.query.pageSize, startDate, endDate }),
    setYear: (selectedYear: number) => {
      if (!Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > 2100) return Promise.resolve();
      explicitYear = true;
      ++exportVersion;
      exportRequest?.abort();
      update({ exporting: false, exportError: null });
      return loadAnnual(selectedYear);
    },
    exportCsv: async (save: (file: LedgerCsv) => void) => {
      if (!active || !isCurrentShop() || state.exporting || state.year === null || state.dashboard.data?.ledgerConfigured !== true || !state.annual.data || state.annual.error) return;
      const selectedYear = state.year;
      const version = ++exportVersion;
      exportRequest = new AbortController();
      update({ exporting: true, exportError: null });
      try {
        const file = await getAnnualLedgerCsv(shopId, selectedYear, exportRequest.signal);
        if (active && isCurrentShop() && version === exportVersion && state.year === selectedYear) save(file);
      } catch (error) {
        if (active && version === exportVersion) update({ exportError: failureMessage(error) });
      } finally {
        if (active && version === exportVersion) update({ exporting: false });
      }
    },
    dispose: () => {
      active = false;
      ++dashboardVersion; ++transactionVersion; ++annualVersion; ++exportVersion;
      dashboardRequest?.abort(); transactionRequest?.abort(); annualRequest?.abort(); exportRequest?.abort();
      listeners.clear();
    },
  };
}
