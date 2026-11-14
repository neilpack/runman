import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthSession, AuthUser } from 'aws-amplify/auth';
import { createAuthFlow, type AuthFlowSdk } from '../src/auth/authFlow';
import { createSessionStore, readConfirmedUser } from '../src/auth/sessionStore';

const user: AuthUser = { userId: 'account-a', username: 'account-a' };
const fields = { email: ' user@example.test ', password: ' Password9! ', code: ' 123456 ' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function service(overrides: Partial<AuthFlowSdk> = {}): AuthFlowSdk {
  return {
    async signIn() { return { isSignedIn: true, nextStep: { signInStep: 'DONE' } }; },
    async signUp() { return { nextStep: { signUpStep: 'CONFIRM_SIGN_UP' } }; },
    async confirmSignUp() { return { nextStep: { signUpStep: 'DONE' } }; },
    async resendSignUpCode() {},
    async resetPassword() { return { nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE' } }; },
    async confirmResetPassword() {},
    ...overrides,
  };
}
function session(readSession: () => Promise<AuthUser | null> = async () => user, signOut = async () => {}) {
  return createSessionStore({ readSession, signOut }, true);
}
function namedError(name: string) { const error = new Error(name); error.name = name; return error; }

test('SDK session requires unexpired matching access/id tokens and a current user', async () => {
  const token = (sub = user.userId, exp = Date.now() / 1000 + 600) => ({ payload: { sub, exp }, toString: () => 'TEST_TOKEN' });
  for (const value of [
    {}, { tokens: { accessToken: token() } },
    { tokens: { accessToken: token(user.userId, 1), idToken: token() } },
    { tokens: { accessToken: token(), idToken: token('other-account') } },
  ] satisfies AuthSession[]) {
    assert.equal(await readConfirmedUser({ fetchAuthSession: async () => value, getCurrentUser: async () => user }), null);
  }
  assert.equal(await readConfirmedUser({
    fetchAuthSession: async () => ({ tokens: { accessToken: token(), idToken: token() } }),
    getCurrentUser: async () => user,
  }), user);
});

test('sign-out wins over a late initial read and token refresh cannot loop reads', async () => {
  const read = deferred<AuthUser | null>();
  let reads = 0;
  const store = session(() => { reads++; return read.promise; });
  const pending = store.refresh();
  store.handleAuthEvent('tokenRefresh');
  store.handleAuthEvent('signedOut');
  read.resolve(user);
  await pending;
  assert.equal(store.getSnapshot().status, 'signedOut');
  assert.equal(reads, 1);
});

test('passive refresh preserves mounted account until an authoritative failure', async () => {
  let read: () => Promise<AuthUser | null> = async () => user;
  const store = session(() => read());
  await store.refresh();
  const pending = deferred<AuthUser | null>();
  read = () => pending.promise;
  const refresh = store.refresh(true);
  assert.equal(store.getSnapshot().status, 'signedIn');
  assert.equal(store.getSnapshot().user, user);
  store.handleAuthEvent('tokenRefresh');
  pending.reject(new Error('refresh failed'));
  await refresh;
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().user, null);
});

test('authoritative account-transition check hides the previous user immediately', async () => {
  let next: () => Promise<AuthUser | null> = async () => user;
  const store = session(() => next());
  await store.refresh();
  const read = deferred<AuthUser | null>();
  next = () => read.promise;
  const pending = store.refresh();
  assert.equal(store.getSnapshot().user, null);
  read.resolve({ userId: 'account-b', username: 'account-b' });
  await pending;
  assert.equal(store.getSnapshot().user?.userId, 'account-b');
});

test('passive signed-out checks preserve the form while returning from an email tab', async () => {
  let read: () => Promise<AuthUser | null> = async () => null;
  const store = session(() => read());
  await store.refresh();
  const pending = deferred<AuthUser | null>();
  read = () => pending.promise;
  const refresh = store.refresh(true);
  assert.equal(store.getSnapshot().status, 'signedOut');
  pending.resolve(null);
  await refresh;
  assert.equal(store.getSnapshot().status, 'signedOut');
});

test('DONE and SDK session confirmation are both required; duplicate submissions are suppressed', async () => {
  const response = deferred<Awaited<ReturnType<AuthFlowSdk['signIn']>>>();
  const read = deferred<AuthUser | null>();
  const store = session(() => read.promise);
  let calls = 0;
  const flow = createAuthFlow(service({ async signIn(input) {
    calls++;
    assert.equal(input.username, 'user@example.test');
    assert.equal(input.password, fields.password);
    assert.equal(input.options.authFlowType, 'USER_SRP_AUTH');
    return response.promise;
  } }), store, 'login');
  const pending = flow.submit(fields);
  await flow.submit(fields);
  store.handleAuthEvent('signedIn');
  assert.equal(store.getSnapshot().status, 'checking');
  response.resolve({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
  await Promise.resolve();
  assert.equal(store.getSnapshot().status, 'checking');
  read.resolve(user);
  await pending;
  assert.equal(store.getSnapshot().status, 'signedIn');
  assert.equal(calls, 1);
});

test('DONE without a confirmed SDK user never authenticates', async () => {
  const store = session(async () => null);
  const flow = createAuthFlow(service(), store, 'login');
  await flow.submit(fields);
  assert.equal(store.getSnapshot().status, 'signedOut');
  assert.match(flow.getSnapshot().error!, /could not be verified/);
});

test('signup/confirmation/resend use Cognito inputs and return to normal login', async () => {
  let resent = '';
  const store = session();
  const flow = createAuthFlow(service({
    async signUp(input) {
      assert.equal(input.username, 'user@example.test');
      assert.equal(input.password, fields.password);
      assert.equal(input.options.autoSignIn, false);
      assert.deepEqual(input.options.userAttributes, { email: 'user@example.test' });
      return { nextStep: { signUpStep: 'CONFIRM_SIGN_UP' } };
    },
    async resendSignUpCode(input) { resent = input.username; },
    async confirmSignUp(input) {
      assert.deepEqual(input, { username: 'user@example.test', confirmationCode: '123456' });
      return { nextStep: { signUpStep: 'DONE' } };
    },
  }), store, 'signup');
  await flow.submit(fields);
  assert.equal(flow.getSnapshot().mode, 'confirmSignup');
  await flow.submit(fields, true);
  assert.equal(resent, 'user@example.test');
  await flow.submit(fields);
  assert.equal(flow.getSnapshot().mode, 'login');
  assert.notEqual(store.getSnapshot().status, 'signedIn');
  assert.equal('password' in flow.getSnapshot(), false);
  assert.equal('code' in flow.getSnapshot(), false);
});

test('password reset sends matching username/code/new password and never signs in automatically', async () => {
  const store = session();
  const flow = createAuthFlow(service({ async confirmResetPassword(input) {
    assert.deepEqual(input, { username: 'user@example.test', confirmationCode: '123456', newPassword: fields.password });
  } }), store, 'requestReset');
  await flow.submit(fields);
  assert.equal(flow.getSnapshot().mode, 'confirmReset');
  await flow.submit(fields);
  assert.equal(flow.getSnapshot().mode, 'login');
  assert.notEqual(store.getSnapshot().status, 'signedIn');
});

test('expected sign-in challenges select confirmation/reset; unsupported MFA stays signed out', async () => {
  for (const [step, mode] of [['CONFIRM_SIGN_UP', 'confirmSignup'], ['RESET_PASSWORD', 'requestReset'], ['CONFIRM_SIGN_IN_WITH_TOTP_CODE', 'login']]) {
    const store = session();
    const flow = createAuthFlow(service({ async signIn() { return { isSignedIn: false, nextStep: { signInStep: step! } }; } }), store, 'login');
    await flow.submit(fields);
    assert.equal(flow.getSnapshot().mode, mode);
    assert.equal(store.getSnapshot().status, 'signedOut');
    if (mode === 'login') assert.match(flow.getSnapshot().error!, /additional sign-in step/);
  }
});

test('bad/expired codes keep confirmation actionable and SDK failures clear pending', async () => {
  for (const name of ['CodeMismatchException', 'ExpiredCodeException']) {
    const flow = createAuthFlow(service({ async confirmSignUp() { throw namedError(name); } }), session(), 'signup');
    await flow.submit(fields);
    await flow.submit(fields);
    assert.equal(flow.getSnapshot().mode, 'confirmSignup');
    assert.equal(flow.getSnapshot().pending, false);
    assert.match(flow.getSnapshot().error!, name === 'ExpiredCodeException' ? /expired/ : /incorrect/);
  }
});

test('StrictMode cleanup/setup replay leaves the active controller usable', async () => {
  let calls = 0;
  const flow = createAuthFlow(service({ async signUp() { calls++; return { nextStep: { signUpStep: 'CONFIRM_SIGN_UP' } }; } }), session(), 'signup');
  flow.activate(); flow.dispose(); flow.activate();
  await flow.submit(fields);
  assert.equal(calls, 1);
  assert.equal(flow.getSnapshot().mode, 'confirmSignup');
});

test('unmount/mode change cancels late successful sign-in rather than restoring its user', async () => {
  for (const cancel of ['dispose', 'mode']) {
    const response = deferred<Awaited<ReturnType<AuthFlowSdk['signIn']>>>();
    let clears = 0;
    const store = session(async () => user, async () => { clears++; });
    const flow = createAuthFlow(service({ signIn: () => response.promise }), store, 'login');
    const pending = flow.submit(fields);
    if (cancel === 'dispose') flow.dispose(); else flow.setMode('signup');
    store.handleAuthEvent('signedIn');
    response.resolve({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await pending;
    assert.equal(store.getSnapshot().status, 'signedOut');
    assert.equal(clears, 1);
  }
});

test('failed abandoned-signin cleanup blocks refresh and new signin until explicit clear succeeds', async () => {
  let fail = true;
  const store = session(async () => user, async () => { if (fail) throw new Error('clear failed'); });
  const id = store.beginSignIn()!;
  store.abandonSignIn(id);
  await store.settleSignIn(id, true);
  assert.equal(store.getSnapshot().status, 'error');
  await store.refresh();
  store.handleAuthEvent('signedIn');
  store.handleAuthEvent('tokenRefresh_failure');
  assert.equal(store.beginSignIn(), null);
  assert.equal(store.getSnapshot().status, 'error');
  fail = false;
  await store.signOut();
  assert.equal(store.getSnapshot().status, 'signedOut');
});

test('signedOut or token-refresh failure during final session verification defeats late success', async () => {
  for (const event of ['signedOut', 'tokenRefresh_failure']) {
    const read = deferred<AuthUser | null>();
    const store = session(() => read.promise);
    const id = store.beginSignIn()!;
    const pending = store.settleSignIn(id, true);
    store.handleAuthEvent(event);
    read.resolve(user);
    assert.equal(await pending, false);
    assert.equal(store.getSnapshot().status, 'signedOut');
  }
});

test('sign-out failure rechecks SDK rather than restoring a previously cached user', async () => {
  let result: AuthUser | null = user;
  const store = session(async () => result, async () => { throw new Error('offline'); });
  await store.refresh();
  result = null;
  await store.signOut();
  assert.equal(store.getSnapshot().status, 'signedOut');
  assert.equal(store.getSnapshot().user, null);
  assert.match(store.getSnapshot().error!, /Sign-out failed/);
});
