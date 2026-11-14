import { useSyncExternalStore } from 'react';
import { cassetteStore } from '@/cassettes/runtime';

export { cassetteStore, newId } from '@/cassettes/runtime';

export function useCassettes() {
  return useSyncExternalStore(cassetteStore.subscribe, cassetteStore.getAll, cassetteStore.getAll);
}

export function useCassetteSync() {
  return useSyncExternalStore(cassetteStore.subscribe, cassetteStore.getSnapshot, cassetteStore.getSnapshot);
}

export function useCassette(id: string | undefined) {
  const cassettes = useCassettes();
  return id ? cassettes.find((cassette) => cassette.id === id) : undefined;
}
