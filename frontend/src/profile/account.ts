// App instance of the account store, wired to the Amplify Auth SDK (user pool only) and the session.

import { deleteUserAttributes, fetchUserAttributes, updatePassword, updateUserAttributes } from 'aws-amplify/auth';
import { api } from '@/api/client';
import { sessionStore } from '@/auth/session';
import { createAccountService, type KeyValueStorage } from './accountService';
import { createAccountStore } from './accountStore';

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const service = createAccountService(
  {
    fetchUserAttributes: () => fetchUserAttributes(),
    updateUserAttributes: (input) => updateUserAttributes(input),
    deleteUserAttributes: (input) => deleteUserAttributes(input),
    updatePassword: (input) => updatePassword(input),
  },
  browserStorage(),
  api.profile,
);

export const accountStore = createAccountStore(service, sessionStore);
accountStore.start();

// Keep an already-published Explore profile in step with account edits. `ifPublished` means this
// never puts someone on Explore who hasn't shared anything (publicSync publishes it the first time).
let lastPublished: string | null = null;
accountStore.subscribe(() => {
  const { status, profile } = accountStore.getSnapshot();
  if (status !== 'ready' || !profile?.hasUsername) { lastPublished = null; return; }
  const input = { username: profile.username, avatar: profile.avatar, favoriteTape: profile.favoriteTape };
  const key = `${profile.userId}\n${JSON.stringify(input)}`;
  if (lastPublished === null) { lastPublished = key; return; }
  if (key === lastPublished) return;
  lastPublished = key;
  void api.publish.publishProfile({ ...input, ifPublished: true })
    .catch((error: unknown) => console.error('[account] Explore profile update failed', error));
});
