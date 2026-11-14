import { useSyncExternalStore } from 'react';
import { accountStore } from '@/profile/account';

/** The signed-in account's profile (username, picture, favorite tape). */
export function useAccount() {
  return useSyncExternalStore(accountStore.subscribe, accountStore.getSnapshot, accountStore.getSnapshot);
}
