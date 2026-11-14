import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Amplify, type ResourcesConfig } from 'aws-amplify';
import { createAuthInitializer } from '../src/auth/configuration';
import { SessionGuard } from '../src/auth/SessionGuard';

const publicConfig = {
  region: 'us-west-2',
  userPoolId: 'us-west-2_ExampleOnly',
  userPoolClientId: 'exampleclientonly',
};

const expectedSdkConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: publicConfig.userPoolId,
      userPoolClientId: publicConfig.userPoolClientId,
      loginWith: { email: true },
      signUpVerificationMethod: 'code',
      userAttributes: { email: { required: true } },
      passwordFormat: {
        minLength: 8, requireLowercase: true, requireUppercase: true,
        requireNumbers: true, requireSpecialCharacters: true,
      },
    },
  },
};

test('missing or malformed public config never initializes Amplify', () => {
  for (const raw of [undefined, '', '{', 'null', '[]', '{}', JSON.stringify({ region: 'us-west-2' })]) {
    let calls = 0;
    const setup = createAuthInitializer(() => { calls++; })(raw);
    assert.equal(setup.ready, false);
    assert.equal(calls, 0);
  }
});

test('invalid IDs, region mismatch, and regions outside the lab fail closed', () => {
  const invalid = [
    { ...publicConfig, region: 'not a region' },
    { ...publicConfig, region: 'eu-west-1', userPoolId: 'eu-west-1_ExampleOnly' },
    { ...publicConfig, userPoolId: 'us-east-1_Other' },
    { ...publicConfig, userPoolId: 'us-west-2_' },
    { ...publicConfig, userPoolClientId: '' },
    { ...publicConfig, userPoolClientId: 'invalid client' },
    { ...publicConfig, userPoolClientId: 123 },
  ];
  for (const value of invalid) {
    const setup = createAuthInitializer(() => assert.fail('must not configure'))(JSON.stringify(value));
    assert.equal(setup.ready, false);
  }
});

test('valid public IDs map to user-pool-only SDK configuration exactly once', () => {
  let calls = 0;
  const initialize = createAuthInitializer((actual) => {
    calls++;
    assert.deepEqual(actual, expectedSdkConfig);
  });
  assert.deepEqual(initialize(JSON.stringify(publicConfig)), { ready: true });
  assert.deepEqual(initialize(JSON.stringify(publicConfig)), { ready: true });
  assert.equal(calls, 1);
});

test('additional resource, identity-pool, endpoint, or secret fields are rejected', () => {
  for (const extra of [
    { identityPoolId: 'not-permitted' },
    { credentials: { accessKeyId: 'NOT_REAL', secretAccessKey: 'NOT_REAL' } },
    { clientSecret: 'NOT_REAL' },
    { userPoolEndpoint: 'https://example.invalid' },
    { Auth: { Cognito: { identityPoolId: 'not-permitted' } } },
    { data: { api_key: 'NOT_REAL' } },
  ]) {
    const setup = createAuthInitializer(() => assert.fail('must not configure'))(
      JSON.stringify({ ...publicConfig, ...extra }),
    );
    assert.deepEqual(setup, { ready: false, reason: 'invalid' });
  }
});

test('actual Amplify SDK accepts standalone Cognito without identity-pool or AWS resource access', () => {
  try {
    const setup = createAuthInitializer((resources) => Amplify.configure(resources))(JSON.stringify(publicConfig));
    assert.deepEqual(setup, { ready: true });
    const actual = Amplify.getConfig();
    assert.deepEqual(actual, expectedSdkConfig);
    assert.equal('identityPoolId' in actual.Auth!.Cognito, false);
    assert.equal('allowGuestAccess' in actual.Auth!.Cognito, false);
    assert.equal('credentials' in actual, false);
    assert.equal('Storage' in actual, false);
    assert.equal('API' in actual, false);
  } finally {
    Amplify.configure({});
  }
});

test('us-east-1 is also accepted when the user-pool region matches', () => {
  const setup = createAuthInitializer(() => {})(JSON.stringify({
    ...publicConfig, region: 'us-east-1', userPoolId: 'us-east-1_ExampleOnly',
  }));
  assert.deepEqual(setup, { ready: true });
});

test('SDK configuration errors leave sign-in unavailable', () => {
  const setup = createAuthInitializer(() => { throw new Error('invalid SDK configuration'); })(JSON.stringify(publicConfig));
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
