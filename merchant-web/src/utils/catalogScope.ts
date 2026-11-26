/** A page lifetime and synchronous write lock, independent of React render timing. */
export function createCatalogScope(isSelected: () => boolean) {
  let active = false;
  let generation = 0;
  let readVersion = 0;
  let writing = false;
  const current = (version: number) => active && generation === version && isSelected();
  return {
    current: () => current(generation),
    capture() { const version = generation; return () => current(version); },
    activate() { active = true; generation++; },
    dispose() { active = false; generation++; readVersion++; writing = false; },
    read() {
      const version = generation, request = ++readVersion;
      return () => current(version) && request === readVersion;
    },
    beginWrite() {
      if (!active || writing || !isSelected()) return null;
      writing = true;
      const version = generation;
      return {
        current: () => current(version),
        finish() { if (generation === version) writing = false; },
      };
    },
  };
}
