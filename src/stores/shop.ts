import { useState, useEffect } from 'react';

export interface BranchInfo {
  id: string | number;
  name: string;
  address: string;
  phone: string;
}

class ShopStore {
  private listeners = new Set<() => void>();
  // Store selection is a UI filter. The server determines permitted stores.
  private _currentStoreId: string | number | null = null;
  private _hasBranches: boolean = false;
  private _branchList: BranchInfo[] = [];

  get currentStoreId(): string | number | null {
    return this._currentStoreId;
  }

  set currentStoreId(id: string | number | null) {
    if (this._currentStoreId === id) return;
    this._currentStoreId = id;
    this._hasBranches = false;
    this._branchList = [];
    this.notify();
  }

  get hasBranches(): boolean {
    return this._hasBranches;
  }

  set hasBranches(val: boolean) {
    this._hasBranches = val;
    this.notify();
  }

  get branchList(): BranchInfo[] {
    return this._branchList;
  }

  set branchList(list: BranchInfo[]) {
    this._branchList = list;
    this.notify();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => listener());
  }
}

export const shopStore = new ShopStore();

// React hook for React components
export function useShopStore() {
  const [storeId, setStoreId] = useState(shopStore.currentStoreId);
  const [hasBranches, setHasBranchesState] = useState(shopStore.hasBranches);
  const [branchList, setBranchListState] = useState(shopStore.branchList);

  useEffect(() => {
    return shopStore.subscribe(() => {
      setStoreId(shopStore.currentStoreId);
      setHasBranchesState(shopStore.hasBranches);
      setBranchListState(shopStore.branchList);
    });
  }, []);

  return {
    currentStoreId: storeId,
    setCurrentStoreId: (id: string | number | null) => {
      shopStore.currentStoreId = id;
    },
    hasBranches,
    setHasBranches: (val: boolean) => {
      shopStore.hasBranches = val;
    },
    branchList,
    setBranchList: (list: BranchInfo[]) => {
      shopStore.branchList = list;
    }
  };
}
