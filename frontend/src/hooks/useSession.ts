import { useSyncExternalStore } from 'react';
import { sessionStore } from '@/auth/session';

export const LANDING_PATH = '/library';

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getSnapshot);
}
