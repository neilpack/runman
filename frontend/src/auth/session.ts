import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { authSetup } from './configure';
import { createSessionStore, readConfirmedUser } from './sessionStore';

export const sessionStore = createSessionStore({
  readSession: () => readConfirmedUser({ fetchAuthSession, getCurrentUser }),
  signOut,
}, authSetup.ready);

let started = false;
export function startSession() {
  if (started || !authSetup.ready) return;
  started = true;
  // Subscribe before reading so a sign-out cannot be overwritten by a stale read.
  Hub.listen('auth', ({ payload }) => sessionStore.handleAuthEvent(payload.event));
  window.addEventListener('focus', () => { void sessionStore.refresh(true); });
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith('CognitoIdentityServiceProvider.')) void sessionStore.refresh();
  });
  void sessionStore.refresh();
}
