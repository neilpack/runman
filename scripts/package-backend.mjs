import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const entryName = 'lambda.mjs';
const maxBundleBytes = 49 * 1024 * 1024;
const execute = promisify(execFile);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

/** A deterministic single-file STORE archive. No directory traversal or globbing. */
export function createArchive(bundle) {
  if (!Buffer.isBuffer(bundle) || bundle.length === 0 || bundle.length > maxBundleBytes) throw new Error('Bundle must be nonempty and smaller than 49 MiB.');
  const name = Buffer.from(entryName);
  const crc = crc32(bundle);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x21, 12); // DOS date 1980-01-01, deterministic timestamp
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(bundle.length, 18); local.writeUInt32LE(bundle.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bundle.length, 20); central.writeUInt32LE(bundle.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + bundle.length, 16);
  return Buffer.concat([local, name, bundle, central, name, end]);
}

/** Verify all archive headers/allowlisted paths and CRC, then return upload bytes. */
export function inspectArchive(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 22) throw new Error('Invalid ZIP.');
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt16LE(end + 8) !== 1 || archive.readUInt16LE(end + 10) !== 1) throw new Error('ZIP must contain exactly one entry.');
  const central = archive.readUInt32LE(end + 16);
  const size = archive.readUInt32LE(end + 12);
  const name = Buffer.from(entryName);
  if (central + size !== end || size !== 46 + name.length || archive.length !== 30 + name.length + (central - 30 - name.length) + size + 22) throw new Error('Invalid ZIP directory.');
  const bytes = archive.subarray(30 + name.length, central);
  const expected = createArchive(bytes);
  // Exact header comparison rejects extra entries, comments, flags, altered paths,
  // compressed/encrypted data, trailing bytes, mismatched sizes and corrupt CRCs.
  if (!archive.equals(expected)) throw new Error('ZIP allowlist or integrity check failed.');
  return { name: entryName, bytes, crc32: crc32(bytes), sha256: sha256(bytes) };
}

export function artifactManifest(archive) {
  const entry = inspectArchive(archive);
  return { filename: 'runman-api.zip', sha256: sha256(archive), bytes: archive.length, runtime: 'nodejs22.x', handler: 'lambda.handler', entries: [{ filename: entry.name, bytes: entry.bytes.length, sha256: entry.sha256, crc32: entry.crc32.toString(16).padStart(8, '0') }] };
}

export async function smokeArchive(archive) {
  const entry = inspectArchive(archive);
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'runman-deployment-'));
  try {
    await writeFile(join(directory, entryName), entry.bytes);
    // Deliberately do not inherit AWS credentials, profiles, real IDs, NODE_OPTIONS,
    // or any application environment. The smoke child additionally denies network.
    const env = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, { NODE_ENV: 'development', ENABLE_LEGACY_EXAMPLES: 'true', AWS_REGION: 'us-west-2', CASSETTE_STORAGE_MODE: 'dynamodb', CASSETTES_TABLE: 'offline-test-cassettes', COGNITO_USER_POOL_ID: 'us-west-2_Offline123', COGNITO_USER_POOL_CLIENT_ID: 'offlinetestclient123', CASSETTE_CURSOR_SECRET: 'OFFLINE-TEST-ONLY-NOT-A-REAL-SECRET-00000000', MEDIA_STORAGE_MODE: 's3', PRIVATE_AUDIO_BUCKET: 'offline-test-private-audio', AWS_EC2_METADATA_DISABLED: 'true' });
    const result = await execute(process.execPath, [fileURLToPath(new URL('./smoke-backend.mjs', import.meta.url)), pathToFileURL(join(directory, entryName)).href], { cwd: directory, env, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } finally {
    const target = await realpath(directory);
    if (!isAbsolute(target) || dirname(target) !== tempRoot || !basename(target).startsWith('runman-deployment-')) throw new Error('Refusing cleanup outside the deployment smoke temporary directory.');
    await rm(target, { recursive: true, force: true });
  }
}

export async function packageBackend() {
  const dist = fileURLToPath(new URL('../backend/dist/', import.meta.url));
  const input = join(dist, entryName);
  if (!(await lstat(input)).isFile()) throw new Error('Lambda bundle must be a regular file.');
  const bundle = await readFile(input);
  const archive = createArchive(bundle);
  const verified = inspectArchive(archive);
  if (!verified.bytes.equals(bundle)) throw new Error('Archived bundle differs from build output.');
  const smoke = await smokeArchive(archive);
  await mkdir(dist, { recursive: true });
  const manifest = artifactManifest(archive);
  await writeFile(join(dist, manifest.filename), archive);
  await writeFile(join(dist, 'runman-api.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${smoke}\nCreated backend/dist/${manifest.filename} (${manifest.bytes} bytes)\nSHA-256 ${manifest.sha256}\nHandler ${manifest.handler}; runtime ${manifest.runtime}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) await packageBackend();
