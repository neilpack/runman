import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cassette } from '@runman/shared';
import { createAccountService, type AccountSdk, type KeyValueStorage } from '../src/profile/accountService';
import { createAccountStore } from '../src/profile/accountStore';
import {
  accountErrorText,
  fallbackUsername,
  isSafeAvatar,
  snapshotTape,
  validatePasswordChange,
  validateUsername,
} from '../src/profile/profileModel';

const AVATAR = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function fakeSdk(attrs: Record<string, string> = {}) {
  const calls: string[] = [];
  const sdk: AccountSdk = {
    async fetchUserAttributes() { calls.push('fetch'); return { ...attrs }; },
    async updateUserAttributes({ userAttributes }) { calls.push(`update:${Object.keys(userAttributes).join(',')}`); Object.assign(attrs, userAttributes); },
    async deleteUserAttributes({ userAttributeKeys }) { calls.push(`delete:${userAttributeKeys.join(',')}`); for (const k of userAttributeKeys) delete attrs[k]; },
    async updatePassword() { calls.push('password'); },
  };
  return { sdk, calls, attrs };
}

function fakeSession(userId: string | null) {
  let snapshot = { status: userId ? 'signedIn' : 'signedOut', user: userId ? { userId } : null };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    set(status: string, id: string | null) { snapshot = { status, user: id ? { userId: id } : null }; listeners.forEach((l) => l()); },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const cassette: Cassette = {
  id: 'tape-1', name: 'Road Trip', shellColor: '#f07a1a', labelColor: '#fde68a', inkColor: '#1f2937',
  shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [
    { id: 't1', title: 'Song', artist: 'Band', durationSec: 120, side: 'A', source: 'library', audioUrl: 'https://example.test/a.mp3' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

test('usernames: length, characters, and edges are validated', () => {
  assert.equal(validateUsername('neil_p'), null);
  assert.equal(validateUsername('  dj.tape-99  '), null);
  assert.match(validateUsername('ab') ?? '', /at least/);
  assert.match(validateUsername('a'.repeat(25)) ?? '', /or fewer/);
  assert.match(validateUsername('has space') ?? '', /only letters/);
  assert.match(validateUsername('<script>') ?? '', /only letters/);
  assert.match(validateUsername('_edge') ?? '', /Start and end/);
  assert.equal(fallbackUsername('mix.master+1@example.com'), 'mix.master1');
  assert.equal(fallbackUsername('x@example.com'), 'listener');
});

test('password change mirrors the pool policy and requires confirmation', () => {
  const ok = { current: 'OldPass1!', next: 'NewPass2@', confirm: 'NewPass2@' };
  assert.equal(validatePasswordChange(ok), null);
  assert.match(validatePasswordChange({ ...ok, current: '' }) ?? '', /current/);
  assert.match(validatePasswordChange({ ...ok, next: 'short', confirm: 'short' }) ?? '', /rule/);
  assert.match(validatePasswordChange({ ...ok, next: 'nosymbol1A', confirm: 'nosymbol1A' }) ?? '', /rule/);
  assert.match(validatePasswordChange({ ...ok, confirm: 'NewPass2#' }) ?? '', /match/);
  assert.match(validatePasswordChange({ ...ok, next: ok.current, confirm: ok.current }) ?? '', /different/);
});

test('only small image data URLs or https URLs are rendered as avatars', () => {
  assert.equal(isSafeAvatar(AVATAR), true);
  assert.equal(isSafeAvatar('https://cdn.example.test/me.png'), true);
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://x.test/a.png', '', null, 42, `data:image/png;base64,${'A'.repeat(3000)}`]) {
    assert.equal(isSafeAvatar(bad), false, String(bad).slice(0, 40));
  }
});

test('favorite tape snapshots carry the look but never tracks or audio URLs', () => {
  const snap = snapshotTape(cassette);
  assert.equal(snap.trackCount, 1);
  assert.equal('tracks' in snap, false);
  assert.equal(JSON.stringify(snap).includes('a.mp3'), false);
});

test('errors map to friendly text, including attribute-permission failures', () => {
  const err = (name: string, message = '') => Object.assign(new Error(message), { name });
  assert.match(accountErrorText(err('NotAuthorizedException'), 'password'), /current password is incorrect/);
  assert.match(accountErrorText(err('NotAuthorizedException', 'A client attempted to write unauthorized attribute'), 'username'), /write access/);
  assert.match(accountErrorText(err('NotAuthorizedException', 'Access Token has expired'), 'avatar'), /expired/);
  assert.match(accountErrorText(err('LimitExceededException'), 'password'), /Too many/);
  assert.match(accountErrorText(new Error('boom'), 'load'), /could not be loaded/);
});

test('service loads Cognito attributes, falls back to an email-based name, and rejects unsafe pictures', async () => {
  const { sdk } = fakeSdk({ email: 'walkman@example.com', picture: 'javascript:alert(1)' });
  const service = createAccountService(sdk, memoryStorage());
  const profile = await service.load('user-1');
  assert.equal(profile.username, 'walkman');
  assert.equal(profile.hasUsername, false);
  assert.equal(profile.avatar, null);
  await assert.rejects(service.setAvatar('javascript:alert(1)'), { name: 'ValidationError' });
  await assert.rejects(service.setUsername('no spaces allowed'), { name: 'ValidationError' });
});

test('service writes username/picture to Cognito and favorites per account', async () => {
  const { sdk, calls } = fakeSdk({ email: 'a@example.com' });
  const storage = memoryStorage();
  const service = createAccountService(sdk, storage);
  assert.equal(await service.setUsername('  tapehead  '), 'tapehead');
  await service.setAvatar(AVATAR);
  await service.removeAvatar();
  await service.changePassword('Old1!aaaa', 'New1!aaaa');
  assert.deepEqual(calls, ['update:preferred_username', 'update:picture', 'delete:picture', 'password']);

  await service.setFavorite('user-1', snapshotTape(cassette));
  assert.equal((await service.load('user-1')).favoriteTape?.id, 'tape-1');
  assert.equal((await service.load('user-2')).favoriteTape, null, 'favorites are per account');
  storage.data.set('runman.profile.v1.user-1.favoriteTape', '{not json');
  assert.equal((await service.load('user-1')).favoriteTape, null, 'corrupt storage is ignored');
});

test('store follows the session, applies changes, and clears on sign-out', async () => {
  const { sdk } = fakeSdk({ email: 'a@example.com', preferred_username: 'first' });
  const session = fakeSession('user-1');
  const store = createAccountStore(createAccountService(sdk, memoryStorage()), session);
  store.start();
  assert.equal(store.getSnapshot().status, 'loading');
  await tick();
  assert.equal(store.getSnapshot().profile?.username, 'first');

  assert.deepEqual(await store.setUsername('second'), { ok: true });
  assert.equal(store.getSnapshot().profile?.username, 'second');
  const bad = await store.setUsername('x');
  assert.equal(bad.ok, false);
  assert.equal(store.getSnapshot().profile?.username, 'second');

  session.set('checking', null);
  assert.equal(store.getSnapshot().profile?.username, 'second', 'a passive re-check keeps the profile');
  session.set('signedOut', null);
  assert.deepEqual(store.getSnapshot(), { status: 'signedOut', profile: null, error: null });
});

test('store never applies a slow change to a different account', async () => {
  const attrs: Record<string, string> = { email: 'a@example.com' };
  let release!: () => void;
  const { sdk } = fakeSdk(attrs);
  sdk.updateUserAttributes = () => new Promise<void>((resolve) => { release = resolve; });
  const session = fakeSession('user-1');
  const store = createAccountStore(createAccountService(sdk, memoryStorage()), session);
  store.start();
  await tick();
  const pending = store.setUsername('slowname');
  session.set('signedIn', 'user-2');
  await tick();
  release();
  await pending;
  assert.equal(store.getSnapshot().profile?.userId, 'user-2');
  assert.notEqual(store.getSnapshot().profile?.username, 'slowname');
});

test('favorites save to the cloud profile, migrate a device-only pick, and fall back locally only on 503', async () => {
  const { sdk } = fakeSdk({ email: 'a@example.com' });
  const storage = memoryStorage();
  const remote = new Map<string, ReturnType<typeof snapshotTape> | null>();
  let failure: (Error & { status?: number }) | null = null;
  const cloud = {
    async get(userId: string) { if (failure) throw failure; return remote.has(userId) ? { favoriteTape: remote.get(userId)! } : null; },
    async save(userId: string, tape: ReturnType<typeof snapshotTape> | null) { if (failure) throw failure; remote.set(userId, tape); },
  };
  const service = createAccountService(sdk, storage, cloud);
  const tape = snapshotTape(cassette);

  await service.setFavorite('user-1', tape);
  assert.deepEqual(remote.get('user-1'), tape);
  storage.data.clear();
  assert.equal((await service.load('user-1')).favoriteTape?.id, 'tape-1', 'another device sees the cloud favorite');

  storage.data.set('runman.profile.v1.user-2.favoriteTape', JSON.stringify(tape));
  assert.equal((await service.load('user-2')).favoriteTape?.id, 'tape-1');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remote.get('user-2')?.id, 'tape-1', 'device-only favorite is copied to the cloud');

  failure = Object.assign(new Error('not configured'), { status: 503 });
  await service.setFavorite('user-3', tape);
  assert.equal(remote.has('user-3'), false);
  assert.equal((await service.load('user-3')).favoriteTape?.id, 'tape-1', 'local-only when the server has no profile storage');

  failure = Object.assign(new Error('unauthorized'), { status: 401 });
  await assert.rejects(service.setFavorite('user-3', null), /unauthorized/);
});
