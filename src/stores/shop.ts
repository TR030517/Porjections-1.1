import { useState, useEffect } from 'react';

export interface BranchInfo {
  id: number;
  name: string;
  address: string;
  phone: string;
}

class ShopStore {
  private listeners = new Set<() => void>();
  private _currentStoreId: number | null = 3246; // ArivaSpa ID by default
  private _hasBranches: boolean = true; // Defaults to true
  private _branchList: BranchInfo[] = [
    { id: 324601, name: 'Ariva Spa - Littleton Branch', address: '6728 W Coal Mine Ave A110, Littleton, CO', phone: '303-475-1111' },
    { id: 324602, name: 'Ariva Spa - Highlands Ranch Branch', address: '9362 S Colorado Blvd, Highlands Ranch, CO', phone: '303-475-2222' }
  ];

  get currentStoreId(): number | null {
    return this._currentStoreId;
  }

  set currentStoreId(id: number | null) {
    this._currentStoreId = id;
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
    setCurrentStoreId: (id: number | null) => {
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
