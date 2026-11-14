import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readConfig } from '../src/config.js';

const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

// Isolate module-cached configuration and prohibit these tests from reaching AWS.
function testEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    'NODE_ENV', 'ENABLE_LEGACY_EXAMPLES', 'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV',
    'LAMBDA_TASK_ROOT', 'ITEMS_TABLE', 'UPLOADS_BUCKET', 'AWS_PROFILE',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'TSX_TSCONFIG_PATH',
  ]) delete env[name];
  return { ...env, AWS_EC2_METADATA_DISABLED: 'true', ...overrides };
}

async function startServer(t: TestContext, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/exampleServer.ts'], {
    cwd: backendDirectory, env: testEnvironment(env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Test server did not start: ${errors}`)), 10_000);
    const lines = createInterface({ input: child.stdout });
    lines.once('line', (line) => {
      clearTimeout(timer);
      lines.close();
      try {
        const address = JSON.parse(line) as { port: number };
        resolve(address.port);
      } catch (error) { reject(error); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited ${code}: ${errors.slice(-3000)}`));
    });
  });
  return `http://127.0.0.1:${port}`;
}

test('configuration requires exact local opt-in and refuses AWS execution markers', () => {
  const enabled = { NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true' };
  assert.equal(readConfig(enabled).legacyExamplesEnabled, true);
  for (const env of [
    {}, { ENABLE_LEGACY_EXAMPLES: 'true' },
    { ...enabled, NODE_ENV: 'production' }, { ...enabled, NODE_ENV: 'test' },
    { ...enabled, ENABLE_LEGACY_EXAMPLES: 'TRUE' },
    { ...enabled, ENABLE_LEGACY_EXAMPLES: '1' },
    { ...enabled, AWS_LAMBDA_FUNCTION_NAME: 'example' },
    { ...enabled, AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' },
    { ...enabled, LAMBDA_TASK_ROOT: '/var/task' },
    { ...enabled, AWS_LAMBDA_FUNCTION_NAME: '' },
  ]) assert.equal(readConfig(env).legacyExamplesEnabled, false, JSON.stringify(env));
});

for (const [name, env] of [
  ['default configuration', {}],
  ['flag without development mode', { ENABLE_LEGACY_EXAMPLES: 'true' }],
  ['development without flag', { NODE_ENV: 'development' }],
  ['production opt-in', { NODE_ENV: 'production', ENABLE_LEGACY_EXAMPLES: 'true' }],
  ['Lambda function marker with spoofed development', {
    NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true', AWS_LAMBDA_FUNCTION_NAME: 'example',
  }],
  ['AWS execution marker with spoofed development', {
    NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true', AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
  }],
] satisfies [string, NodeJS.ProcessEnv][]) {
  test(`${name}: HTTP examples return 404 for every method and health stays public`, async (t) => {
    const base = await startServer(t, env);
    for (const path of ['/api/items', '/api/items/example']) {
      for (const method of methods) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
            'Content-Type': 'application/json',
          },
          body: method === 'POST' ? '{' : undefined,
        });
        assert.equal(response.status, 404, `${method} ${path}`);
        await response.arrayBuffer();
      }
    }
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { status: string }).status, 'ok');
  });
}

test('explicit local development opt-in retains memory CRUD and public health', async (t) => {
  const base = await startServer(t, { NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true' });
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { storage: string }).storage, 'memory');
  const created = await fetch(`${base}/api/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Local example' }),
  });
  assert.equal(created.status, 201);
  const item = await created.json() as { id: string; name: string };
  const listed = await fetch(`${base}/api/items`);
  assert.deepEqual(await listed.json(), [item]);
  const loaded = await fetch(`${base}/api/items/${item.id}`);
  assert.deepEqual(await loaded.json(), item);
  const deleted = await fetch(`${base}/api/items/${item.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  const missing = await fetch(`${base}/api/items/${item.id}`);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
});

test('actual Lambda handler denies examples even with development opt-in and no cloud markers', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'tests/fixtures/lambdaExamples.ts'], {
      cwd: backendDirectory,
      env: testEnvironment({ NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true' }),
      timeout: 15_000,
    });
  const results = JSON.parse(stdout) as { method: string; path: string; status: number; body: string }[];
  assert.equal(results.length, 15);
  for (const result of results) {
    assert.equal(result.status, result.path === '/api/health' ? 200 : 404, `${result.method} ${result.path}`);
  }
  const health = results.find((result) => result.path === '/api/health');
  assert.equal(JSON.parse(health!.body).status, 'ok');
});
