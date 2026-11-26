export interface DraftScope { actorId: string; shopId: string }
export interface DraftState extends DraftScope { dirty: boolean; busy: boolean }

/** In-memory only. A confirmation can never authorize leaving a different actor/shop/form lifetime. */
export function createDraftLeaveController(currentScope: () => DraftScope | null) {
  const readers = new Map<string, () => DraftState>();
  let confirming = false;
  const snapshot = () => {
    const scope = currentScope();
    const entries = scope ? [...readers].filter(([, read]) => {
      const draft = read(); return draft.actorId === scope.actorId && draft.shopId === scope.shopId;
    }) : [];
    return {
      key: scope ? `${scope.actorId}:${scope.shopId}` : '',
      readers: entries.map(([, read]) => read),
      dirty: entries.some(([, read]) => read().dirty),
      busy: entries.some(([, read]) => read().busy),
    };
  };
  return {
    register(id: string, read: () => DraftState) {
      readers.set(id, read);
      return () => { if (readers.get(id) === read) readers.delete(id); };
    },
    snapshot,
    async request(confirm: () => Promise<boolean>, busy: () => void): Promise<boolean> {
      if (confirming) return false;
      const before = snapshot();
      if (before.busy) { busy(); return false; }
      if (!before.dirty) return true;
      confirming = true;
      try {
        if (!await confirm()) return false;
        const after = snapshot();
        if (after.busy) { busy(); return false; }
        return after.key === before.key && before.readers.length === after.readers.length && before.readers.every(read => after.readers.includes(read));
      } finally { confirming = false; }
    },
  };
}
