// Client-side session check used to skip the welcome/login screens for returning users.
//
// TODO(auth): this only looks for a session cookie. Once Cognito sign-in is wired up
// (AWS_IMPLEMENTATION.md step 2), replace `hasSessionCookie` with Amplify's
// `fetchAuthSession()` or configure Amplify to use cookie storage under this name.

/** Where signed-in users land. The landing page doesn't exist yet. */
export const LANDING_PATH = '/landing';

export const SESSION_COOKIE = 'runman_session';

export function hasSessionCookie(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

export function useIsSignedIn(): boolean {
  return hasSessionCookie();
}
