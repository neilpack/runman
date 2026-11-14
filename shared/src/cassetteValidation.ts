import type { CustomSticker, CustomStickerStroke } from './index.js';
import type { CassetteDocument, CassetteValidationIssue, CassetteValidationResult, DeleteCassetteRequest, ListCassettesRequest, SaveCassetteRequest } from './cassettePersistence.js';
import { CASSETTE_LIMITS as limits } from './cassettePersistence.js';
import type { ProfileDocument, SaveProfileRequest } from './profilePersistence.js';

const pens = ['handwritten', 'marker', 'script', 'typewriter', 'clean'];
const visibilities = ['private', 'public'];
const trackDetails = ['id', 'title', 'artist', 'durationSec', 'side', 'source', 'provider'];
/** Pen width range for hand-drawn stickers, in 100 × 100 canvas units. */
export const CUSTOM_STROKE_WIDTH = { min: 0.5, max: 40 } as const;
const visuals = ['labelColor', 'inkColor', 'penStyle', 'stickers'];
const payloadFields = ['id', 'name', 'shellColor', 'shellType', ...visuals, 'tracks'];

class Check {
  issues: CassetteValidationIssue[] = [];
  fail(path: string, message: string) { this.issues.push({ path: path || '$', message }); }
  fields(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      this.fail(path, 'Expected a plain object.'); return;
    }
    const object = value as Record<string, unknown>;
    for (const key of required) if (!Object.hasOwn(object, key)) this.fail(this.path(path, key), 'Required field.');
    for (const key of Object.keys(object)) {
      if (![...required, ...optional].includes(key)) this.fail(this.path(path, key), 'Unknown or server-owned field.');
      else if (object[key] === undefined) this.fail(this.path(path, key), 'Omit optional fields instead of undefined.');
    }
    return object;
  }
  path(parent: string, key: string) { return parent ? `${parent}.${key}` : key; }
  text(value: unknown, path: string, max: number, empty = false): value is string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
      this.fail(path, `Expected ${empty ? 'a' : 'a nonblank'} string of at most ${max} characters, without control characters.`); return false;
    }
    return true;
  }
  id(value: unknown, path: string) {
    if (this.text(value, path, limits.id) && !/^[a-zA-Z0-9_-]+$/.test(value)) this.fail(path, 'Use letters, digits, hyphens or underscores.');
  }
  number(value: unknown, path: string, min: number, max: number, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) this.fail(path, `Expected ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}.`);
  }
  choice(value: unknown, path: string, options: readonly string[]) {
    if (typeof value !== 'string' || !options.includes(value)) this.fail(path, `Expected one of: ${options.join(', ')}.`);
  }
  color(value: unknown, path: string) {
    if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) this.fail(path, 'Expected a hex color (#RGB, #RRGGBB or #RRGGBBAA).');
  }
  url(value: unknown, path: string) {
    if (!this.text(value, path, limits.url)) return;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        (url.port && url.port !== '443') || !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(host) || /^[\d.]+$/.test(host) ||
        host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) throw new Error();
      for (const [key, field] of url.searchParams) {
        const normalized = key.toLowerCase().replace(/[^a-z\d]/g, '');
        if (/^(?:xamz|xgoog)/.test(normalized) || /token|signature|credential|authorization|secret|password|jwt|accesskey|session|policy|expires|expiry|expiration/.test(normalized) ||
          ['auth', 'sig', 'exp', 'se', 'sp', 'sv', 'keypairid'].includes(normalized) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(field)) throw new Error();
      }
    } catch { this.fail(path, 'Expected a public HTTPS metadata URL without credentials, fragments, tokens or expiry/signature parameters.'); }
  }
  stickers(value: unknown, path: string) {
    if (!Array.isArray(value)) { this.fail(path, 'Expected a sticker array.'); return; }
    if (value.length > limits.stickersPerSide) this.fail(path, `At most ${limits.stickersPerSide} stickers per side.`);
    const ids = new Set<string>();
    value.slice(0, limits.stickersPerSide + 1).forEach((entry, index) => {
      const at = `${path}[${index}]`;
      const sticker = this.fields(entry, at, ['id', 'kind', 'x', 'y', 'rotation', 'scale', 'color']);
      if (!sticker) return;
      this.id(sticker.id, `${at}.id`);
      if (typeof sticker.id === 'string') { if (ids.has(sticker.id)) this.fail(`${at}.id`, 'Duplicate sticker ID on this side.'); ids.add(sticker.id); }
      if (this.text(sticker.kind, `${at}.kind`, limits.stickerKind) && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sticker.kind)) this.fail(`${at}.kind`, 'Expected a sticker identifier, not inline markup or a URL.');
      this.number(sticker.x, `${at}.x`, 0, 100);
      this.number(sticker.y, `${at}.y`, 0, 100);
      this.number(sticker.rotation, `${at}.rotation`, -360, 360);
      this.number(sticker.scale, `${at}.scale`, 0.1, 5);
      this.color(sticker.color, `${at}.color`);
    });
  }
  customStickers(value: unknown, path: string) {
    if (!Array.isArray(value)) { this.fail(path, 'Expected a custom sticker array.'); return; }
    if (value.length > limits.customStickers) this.fail(path, `At most ${limits.customStickers} custom stickers per cassette.`);
    const ids = new Set<string>();
    const slots = new Set<number>();
    value.slice(0, limits.customStickers + 1).forEach((entry, index) => {
      const at = `${path}[${index}]`;
      const art = this.fields(entry, at, ['id', 'slot', 'strokes']);
      if (!art) return;
      this.id(art.id, `${at}.id`);
      if (typeof art.id === 'string') { if (ids.has(art.id)) this.fail(`${at}.id`, 'Duplicate custom sticker ID.'); ids.add(art.id); }
      this.number(art.slot, `${at}.slot`, 0, limits.customStickers - 1, true);
      if (typeof art.slot === 'number') { if (slots.has(art.slot)) this.fail(`${at}.slot`, 'Two custom stickers share a slot.'); slots.add(art.slot); }
      if (!Array.isArray(art.strokes)) { this.fail(`${at}.strokes`, 'Expected a stroke array.'); return; }
      if (art.strokes.length > limits.customStickerStrokes) this.fail(`${at}.strokes`, `At most ${limits.customStickerStrokes} strokes per drawing.`);
      let coords = 0;
      const strokes: unknown[] = art.strokes;
      strokes.slice(0, limits.customStickerStrokes + 1).forEach((raw, s) => {
        const sp = `${at}.strokes[${s}]`;
        const stroke = this.fields(raw, sp, ['color', 'width', 'points']);
        if (!stroke) return;
        this.color(stroke.color, `${sp}.color`);
        this.number(stroke.width, `${sp}.width`, CUSTOM_STROKE_WIDTH.min, CUSTOM_STROKE_WIDTH.max);
        const points = stroke.points;
        if (!Array.isArray(points) || points.length < 2 || points.length % 2 ||
          !points.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) {
          this.fail(`${sp}.points`, 'Expected [x, y, …] coordinate pairs from 0 to 100.'); return;
        }
        coords += points.length;
      });
      if (coords > limits.customStickerCoords) this.fail(`${at}.strokes`, `Drawing has more than ${limits.customStickerCoords} coordinates.`);
    });
  }
  audio(value: unknown, path: string, source: unknown) {
    const audio = this.fields(value, path, ['source', 'objectKey', 'contentType', 'sizeBytes']);
    if (!audio) return;
    this.choice(audio.source, `${path}.source`, ['upload', 'recording']);
    if (audio.source !== source) this.fail(`${path}.source`, 'Audio reference source must match the track.');
    if (this.text(audio.objectKey, `${path}.objectKey`, limits.objectKey)) {
      const key = audio.objectKey;
      if (!/^[a-zA-Z0-9_./:@+-]+$/.test(key) || key.includes('://') || key.split('/').some((part) => !part || part === '.' || part === '..')) this.fail(`${path}.objectKey`, 'Expected a durable object key, not a URL or traversal path.');
    }
    if (this.text(audio.contentType, `${path}.contentType`, 128) &&
      !/^audio\/(?:mpeg|mp3|mp4|aac|x-m4a|wav|wave|x-wav|ogg|webm|flac)(?:;\s?codecs=[a-z\d.,_-]{1,80})?$/i.test(audio.contentType)) this.fail(`${path}.contentType`, 'Unsupported audio content type.');
    this.number(audio.sizeBytes, `${path}.sizeBytes`, 1, limits.audioBytes, true);
  }
  timestamp(value: unknown, path: string) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) this.fail(path, 'Expected a canonical ISO timestamp.');
  }
  /** A tape's look frozen for a profile (TapeSnapshot): no tracks or audio. */
  snapshot(value: unknown, path: string) {
    const tape = this.fields(value, path, ['id', 'name', 'shellColor', 'shellType', ...visuals, 'updatedAt', 'trackCount'], ['sideB', 'customStickers']);
    if (!tape) return;
    this.id(tape.id, `${path}.id`);
    this.text(tape.name, `${path}.name`, limits.name, true);
    this.color(tape.shellColor, `${path}.shellColor`);
    this.choice(tape.shellType, `${path}.shellType`, ['solid', 'clear', 'retro']);
    this.color(tape.labelColor, `${path}.labelColor`);
    this.color(tape.inkColor, `${path}.inkColor`);
    this.choice(tape.penStyle, `${path}.penStyle`, pens);
    this.stickers(tape.stickers, `${path}.stickers`);
    this.sideB(tape, path);
    if (Object.hasOwn(tape, 'customStickers')) this.customStickers(tape.customStickers, `${path}.customStickers`);
    this.timestamp(tape.updatedAt, `${path}.updatedAt`);
    this.number(tape.trackCount, `${path}.trackCount`, 0, limits.tracksPerCassette, true);
  }
  sideB(tape: Record<string, unknown>, path: string) {
    if (!Object.hasOwn(tape, 'sideB')) return;
    const side = this.fields(tape.sideB, `${path}.sideB`, [], visuals);
    if (!side) return;
    for (const color of ['labelColor', 'inkColor']) if (Object.hasOwn(side, color)) this.color(side[color], `${path}.sideB.${color}`);
    if (Object.hasOwn(side, 'penStyle')) this.choice(side.penStyle, `${path}.sideB.penStyle`, pens);
    if (Object.hasOwn(side, 'stickers')) this.stickers(side.stickers, `${path}.sideB.stickers`);
  }
  payload(value: unknown, path: string) {
    const tape = this.fields(value, path, payloadFields, ['sideB', 'customStickers', 'visibility']);
    if (!tape) return;
    if (Object.hasOwn(tape, 'visibility')) this.choice(tape.visibility, `${path}.visibility`, visibilities);
    this.id(tape.id, `${path}.id`);
    this.text(tape.name, `${path}.name`, limits.name, true);
    this.color(tape.shellColor, `${path}.shellColor`);
    this.choice(tape.shellType, `${path}.shellType`, ['solid', 'clear', 'retro']);
    this.color(tape.labelColor, `${path}.labelColor`);
    this.color(tape.inkColor, `${path}.inkColor`);
    this.choice(tape.penStyle, `${path}.penStyle`, pens);
    this.stickers(tape.stickers, `${path}.stickers`);
    this.sideB(tape, path);
    if (Object.hasOwn(tape, 'customStickers')) this.customStickers(tape.customStickers, `${path}.customStickers`);
    if (!Array.isArray(tape.tracks)) { this.fail(`${path}.tracks`, 'Expected a track array.'); return; }
    if (tape.tracks.length > limits.tracksPerCassette) this.fail(`${path}.tracks`, `At most ${limits.tracksPerCassette} tracks per cassette.`);
    const ids = new Set<string>();
    const tracks: unknown[] = tape.tracks;
    tracks.slice(0, limits.tracksPerCassette + 1).forEach((value, index) => {
      const at = `${path}.tracks[${index}]`;
      const source = !!value && typeof value === 'object' && 'source' in value ? value.source : undefined;
      const isLibrary = source === 'library';
      const isCommunity = source === 'community';
      const required = isLibrary ? ['sourceId'] : isCommunity ? ['sourceId', 'hasAudio'] : ['audio'];
      const optional = isLibrary ? ['audioUrl'] : isCommunity ? [] : ['sourceId', 'visibility'];
      const track = this.fields(value, at, [...trackDetails, ...required], ['artworkUrl', 'licenseUrl', ...optional]);
      if (!track) return;
      this.id(track.id, `${at}.id`);
      if (typeof track.id === 'string') { if (ids.has(track.id)) this.fail(`${at}.id`, 'Duplicate track ID in this cassette.'); ids.add(track.id); }
      this.text(track.title, `${at}.title`, limits.title);
      this.text(track.artist, `${at}.artist`, limits.artist, true);
      this.number(track.durationSec, `${at}.durationSec`, 0, limits.durationSec);
      this.choice(track.side, `${at}.side`, ['A', 'B']);
      this.choice(track.source, `${at}.source`, ['library', 'community', 'upload', 'recording']);
      if (isCommunity) this.id(track.sourceId, `${at}.sourceId`);
      else if (Object.hasOwn(track, 'sourceId')) this.text(track.sourceId, `${at}.sourceId`, limits.id);
      if (isLibrary) this.choice(track.provider, `${at}.provider`, ['jamendo']);
      else if (isCommunity) {
        this.choice(track.provider, `${at}.provider`, ['explore']);
        if (typeof track.hasAudio !== 'boolean') this.fail(`${at}.hasAudio`, 'Expected a boolean.');
      } else {
        this.choice(track.provider, `${at}.provider`, ['s3']); this.audio(track.audio, `${at}.audio`, track.source);
        if (Object.hasOwn(track, 'visibility')) this.choice(track.visibility, `${at}.visibility`, visibilities);
      }
      for (const field of ['audioUrl', 'artworkUrl', 'licenseUrl']) if (Object.hasOwn(track, field)) this.url(track[field], `${at}.${field}`);
    });
  }
  finish<T>(value: unknown, metadata: unknown = value): CassetteValidationResult<T> {
    if (!this.issues.length) {
      try {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string') throw new Error();
        const payload = metadata === value ? serialized : JSON.stringify(metadata);
        if (typeof payload !== 'string') throw new Error();
        if (new TextEncoder().encode(payload).byteLength > limits.metadataBytes) this.fail('$', `Serialized UTF-8 cassette payload exceeds ${limits.metadataBytes} bytes.`);
        else return { ok: true, value: JSON.parse(serialized) as T };
      } catch { this.fail('$', 'Expected JSON metadata without cycles or binary values.'); }
    }
    return { ok: false, issues: this.issues };
  }
}

export function validateSaveCassetteRequest(value: unknown): CassetteValidationResult<SaveCassetteRequest> {
  const check = new Check();
  const request = check.fields(value, '', ['cassette', 'expectedRevision']);
  if (request) { check.payload(request.cassette, 'cassette'); check.number(request.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER, true); }
  return check.finish(value, request?.cassette);
}

export function validateDeleteCassetteRequest(value: unknown): CassetteValidationResult<DeleteCassetteRequest> {
  const check = new Check();
  const request = check.fields(value, '', ['expectedRevision']);
  if (request) check.number(request.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER, true);
  return check.finish(value);
}

export function validateListCassettesRequest(value: unknown): CassetteValidationResult<ListCassettesRequest> {
  const check = new Check();
  const request = check.fields(value, '', [], ['limit', 'cursor']);
  if (request) {
    if (Object.hasOwn(request, 'limit')) check.number(request.limit, 'limit', 1, limits.listLimit, true);
    if (Object.hasOwn(request, 'cursor') && check.text(request.cursor, 'cursor', limits.cursor) && !/^[a-zA-Z0-9_.~-]+$/.test(request.cursor)) check.fail('cursor', 'Expected an opaque cursor, not a URL or ownership key.');
  }
  return check.finish(value);
}

export function validateCassetteDocument(value: unknown): CassetteValidationResult<CassetteDocument> {
  const check = new Check();
  const document = check.fields(value, '', ['schemaVersion', 'revision', 'createdAt', 'updatedAt', 'payload']);
  if (document) {
    if (document.schemaVersion !== 1) check.fail('schemaVersion', 'Only schema version 1 is supported.');
    check.number(document.revision, 'revision', 1, Number.MAX_SAFE_INTEGER, true);
    for (const field of ['createdAt', 'updatedAt']) {
      const time = document[field];
      if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) check.fail(field, 'Expected a canonical server ISO timestamp.');
    }
    if (typeof document.createdAt === 'string' && typeof document.updatedAt === 'string' && document.updatedAt < document.createdAt) check.fail('updatedAt', 'Must not precede createdAt.');
    check.payload(document.payload, 'payload');
  }
  return check.finish(value, document?.payload);
}

export function validateSaveProfileRequest(value: unknown): CassetteValidationResult<SaveProfileRequest> {
  const check = new Check();
  const request = check.fields(value, '', ['favoriteTape']);
  if (request && request.favoriteTape !== null) check.snapshot(request.favoriteTape, 'favoriteTape');
  return check.finish(value);
}

export function validateProfileDocument(value: unknown): CassetteValidationResult<ProfileDocument> {
  const check = new Check();
  const document = check.fields(value, '', ['schemaVersion', 'updatedAt', 'favoriteTape']);
  if (document) {
    if (document.schemaVersion !== 1) check.fail('schemaVersion', 'Only schema version 1 is supported.');
    check.timestamp(document.updatedAt, 'updatedAt');
    if (document.favoriteTape !== null) check.snapshot(document.favoriteTape, 'favoriteTape');
  }
  return check.finish(value);
}

/**
 * Lenient reader for drawings coming from untrusted JSON (e.g. a public profile snapshot):
 * drops anything malformed instead of failing, and never returns more than the save limits allow.
 */
export function sanitizeCustomStickers(raw: unknown): CustomSticker[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const hex = /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i;
  const seen = new Set<string>();
  const usedSlots = new Set<number>();
  const out: CustomSticker[] = [];
  for (const entry of raw.slice(0, limits.customStickers)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, slot, strokes } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length > limits.id || !/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id) || !Array.isArray(strokes) ||
      typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= limits.customStickers || usedSlots.has(slot)) continue;
    seen.add(id);
    usedSlots.add(slot);
    let budget = limits.customStickerCoords;
    const clean: CustomStickerStroke[] = [];
    for (const stroke of strokes.slice(0, limits.customStickerStrokes)) {
      if (!stroke || typeof stroke !== 'object') continue;
      const { color, width, points } = stroke as Record<string, unknown>;
      if (typeof color !== 'string' || !hex.test(color) || typeof width !== 'number' || !Number.isFinite(width) ||
        width < CUSTOM_STROKE_WIDTH.min || width > CUSTOM_STROKE_WIDTH.max || !Array.isArray(points) || points.length < 2 ||
        points.length % 2 || points.length > budget ||
        !points.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) continue;
      budget -= points.length;
      clean.push({ color, width, points: points as number[] });
    }
    out.push({ id, slot, strokes: clean });
  }
  return out;
}
