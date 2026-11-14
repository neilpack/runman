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
