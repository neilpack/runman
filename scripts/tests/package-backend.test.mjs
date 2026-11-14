import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { artifactManifest, createArchive, crc32, inspectArchive } from '../package-backend.mjs';

test('CRC matches the standard vector and ZIP exposes only the exact root Lambda bundle', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const bundle = Buffer.from('export const handler = () => "fixture";');
  const zip = createArchive(bundle);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(8), 0); // STORE, no compression
  const nameLength = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'lambda.mjs');
  assert.deepEqual(zip.subarray(30 + nameLength, 30 + nameLength + bundle.length), bundle);
  const entry = inspectArchive(zip);
  assert.equal(entry.name, 'lambda.mjs');
  assert.deepEqual(entry.bytes, bundle);
  assert.deepEqual(createArchive(bundle), zip);
});

test('manifest independently hashes the uploaded ZIP and bundle with explicit runtime/handler', () => {
  const bundle = Buffer.from('fixture');
  const zip = createArchive(bundle);
  const manifest = artifactManifest(zip);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.sha256, hash(zip));
  assert.equal(manifest.entries[0].sha256, hash(bundle));
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.handler, 'lambda.handler');
  assert.equal(manifest.runtime, 'nodejs22.x');
  assert.equal(manifest.filename, 'runman-api.zip');
});

test('archive verification rejects corruption, changed paths, extra bytes and multiple entries', () => {
  const valid = createArchive(Buffer.from('bundle'));
  for (const offset of [14, 30, 40]) {
    const changed = Buffer.from(valid); changed[offset] ^= 1;
    assert.throws(() => inspectArchive(changed));
  }
  const multiple = Buffer.from(valid); multiple.writeUInt16LE(2, multiple.length - 12);
  assert.throws(() => inspectArchive(multiple));
  assert.throws(() => inspectArchive(Buffer.concat([valid, Buffer.from('extra')])));
  assert.throws(() => createArchive(Buffer.alloc(0)));
});
