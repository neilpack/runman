import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

// Fail the smoke if the artifact attempts JWKS, DynamoDB, metadata or other I/O.
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw new Error('Network is prohibited during deployment smoke verification.'); };
http.request = deny; http.get = deny; https.request = deny; https.get = deny;
net.connect = deny; net.createConnection = deny; tls.connect = deny;
net.Socket.prototype.connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
const { handler } = await import(process.argv[2]);
assert.equal(typeof handler, 'function');
async function request(method, path, headers = {}) {
  const response = await handler({ version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', headers: { host: 'offline.example.test', ...headers }, requestContext: { accountId: 'offline', apiId: 'offline', domainName: 'offline.example.test', domainPrefix: 'offline', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'offline-smoke' }, requestId: 'offline', routeKey: '$default', stage: '$default', time: '14/Nov/2026:00:00:00 +0000', timeEpoch: 1794614400000 }, isBase64Encoded: false }, { awsRequestId: 'offline', getRemainingTimeInMillis: () => 30_000 });
  return response;
}
const health = await request('GET', '/api/health');
assert.equal(health.statusCode, 200);
assert.equal(JSON.parse(health.body).status, 'ok');
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  assert.equal((await request(method, '/api/items')).statusCode, 404, `${method} local examples must remain disabled`);
}
for (const [method, path] of [['GET', '/api/cassettes'], ['PUT', '/api/cassettes/offline-tape'], ['DELETE', '/api/cassettes/offline-tape']]) {
  assert.equal((await request(method, path)).statusCode, 401, `${method} cassette request must require authentication`);
}
assert.equal((await request('GET', '/api/cassettes', { authorization: 'Bearer malformed-offline-token' })).statusCode, 401);
assert.equal(networkAttempts, 0);
console.log('Offline uploaded-bundle smoke passed: health 200, cassettes 401, legacy methods 404; no network.');
