import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAuthInitializer } from '../src/auth/configuration';
import { SessionGuard } from '../src/auth/SessionGuard';

const outputs = {
  version: '1.4',
  auth: {
    aws_region: 'us-west-2',
    user_pool_id: 'us-west-2_ExampleOnly',
    user_pool_client_id: 'exampleclientonly',
  },
};

test('missing or malformed outputs never initialize Amplify', () => {
  for (const raw of [undefined, '', '{', 'null', '[]', '{}', JSON.stringify({ version: '1.4', auth: {} })]) {
    let calls = 0;
    const setup = createAuthInitializer(() => { calls++; })(raw);
    assert.equal(setup.ready, false);
    assert.equal(calls, 0);
  }
});

test('invalid pool, region, client or outputs version fails closed', () => {
  const invalid = [
    { ...outputs, version: '2' },
    { ...outputs, auth: { ...outputs.auth, aws_region: 'not a region' } },
    { ...outputs, auth: { ...outputs.auth, user_pool_id: 'us-east-1_Other' } },
    { ...outputs, auth: { ...outputs.auth, user_pool_client_id: '' } },
  ];
  for (const value of invalid) {
    const setup = createAuthInitializer(() => assert.fail('must not configure'))(JSON.stringify(value));
    assert.equal(setup.ready, false);
  }
});

test('valid generated outputs initialize exactly once and preserve future resources', () => {
  let calls = 0;
  const value = { ...outputs, custom: { example: 'preserved' } };
  const initialize = createAuthInitializer((actual) => {
    calls++;
    assert.deepEqual(actual, value);
  });
  assert.deepEqual(initialize(JSON.stringify(value)), { ready: true });
  assert.deepEqual(initialize(JSON.stringify(value)), { ready: true });
  assert.equal(calls, 1);
});

test('SDK configuration errors leave sign-in unavailable', () => {
  const setup = createAuthInitializer(() => { throw new Error('invalid SDK configuration'); })(JSON.stringify(outputs));
  assert.deepEqual(setup, { ready: false, reason: 'configuration-failed' });
});

test('private content is absent while signed out, checking, signing out, or missing a user', () => {
  for (const [authStatus, route, userId] of [
    ['configuring', 'authenticated', 'account-a'],
    ['unauthenticated', 'authenticated', 'account-a'],
    ['authenticated', 'signOut', 'account-a'],
    ['authenticated', 'signIn', 'account-a'],
    ['authenticated', 'authenticated', undefined],
    ['authenticated', 'authenticated', ''],
  ]) {
    const html = renderToStaticMarkup(createElement(SessionGuard, {
      authStatus: authStatus ?? '', route: route ?? '', userId,
      children: createElement('div', null, 'PRIVATE_ACCOUNT_CONTENT'),
    }));
    assert.doesNotMatch(html, /PRIVATE_ACCOUNT_CONTENT/);
    assert.match(html, /role="status"/);
  }
});

test('settled authenticated identity may render private content', () => {
  const html = renderToStaticMarkup(createElement(SessionGuard, {
    authStatus: 'authenticated', route: 'authenticated', userId: 'account-a',
    children: createElement('div', null, 'PRIVATE_ACCOUNT_CONTENT'),
  }));
  assert.match(html, /PRIVATE_ACCOUNT_CONTENT/);
});
