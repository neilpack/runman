import { cassetteFromDocument, cassetteToSaveRequest, validateCassetteDocument, type Cassette, type CassetteDocument, type CassetteValidationIssue } from '@runman/shared';
import type { CassetteApi } from '../api/cassetteClient';

export interface TapeSync {
  revision: number; dirty: boolean; saving: boolean; deleting: boolean; reloading: boolean;
  conflict: boolean; cloudMissing: boolean; error: string | null; issues?: CassetteValidationIssue[];
}
export interface CassetteSyncSnapshot {
  owner: string | null; status: 'guest' | 'authenticated' | 'hidden'; epoch: number; context: number;
  loading: boolean; listError: string | null; nextCursor?: string; storageError: string | null;
  legacy: Cassette[]; tapes: Record<string, TapeSync>;
}
interface Draft { cassette: Cassette; baseline: CassetteDocument | null; conflict: boolean; cloudMissing: boolean; remoteRevision?: number }
interface Model extends Draft { saving: boolean; deleting: boolean; reloading: boolean; error: string | null; issues?: CassetteValidationIssue[]; version: number; localFingerprint: string; baselineFingerprint: string | null }
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface Dependencies { api: CassetteApi; storage: Storage; namespace: string; newId(): string; now(): string; seed?(): Cassette[] }
const LEGACY_KEY = 'runman.cassettes.v1';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, field]) => [key, canonical(field)]));
  return value;
}
function fingerprint(value: unknown) { return JSON.stringify(canonical(value)); }
function localFingerprint(cassette: Cassette) {
  const converted = cassetteToSaveRequest(cassette, 0);
  if (converted.ok) return fingerprint(converted.value.cassette);
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = cassette;
  return fingerprint(payload);
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function localCassette(value: unknown): value is Cassette {
  if (!record(value)) return false;
  const text = (key: string) => typeof value[key] === 'string';
  if (!['id', 'name', 'shellColor', 'labelColor', 'inkColor', 'createdAt', 'updatedAt'].every(text) || !value.id ||
    !['solid', 'clear', 'retro'].includes(String(value.shellType)) ||
    !['handwritten', 'marker', 'script', 'typewriter', 'clean'].includes(String(value.penStyle))) return false;
  const stickers = (entries: unknown) => Array.isArray(entries) && entries.every((entry: unknown) => record(entry) &&
    ['id', 'kind', 'color'].every((key) => typeof entry[key] === 'string') &&
    ['x', 'y', 'rotation', 'scale'].every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key])));
  if (!stickers(value.stickers) || !Array.isArray(value.tracks) || !value.tracks.every((track: unknown) => record(track) &&
    ['id', 'title', 'artist'].every((key) => typeof track[key] === 'string') &&
    typeof track.durationSec === 'number' && Number.isFinite(track.durationSec) &&
    ['A', 'B'].includes(String(track.side)) && ['library', 'recording'].includes(String(track.source)) &&
    ['sourceId', 'audioUrl', 'artworkUrl', 'licenseUrl'].every((key) => track[key] === undefined || typeof track[key] === 'string'))) return false;
  if (value.sideB !== undefined) {
    if (!record(value.sideB)) return false;
    const side = value.sideB;
    if (['labelColor', 'inkColor', 'penStyle'].some((key) => side[key] !== undefined && typeof side[key] !== 'string') || (side.stickers !== undefined && !stickers(side.stickers))) return false;
  }
  return true;
}
function model(draft: Draft): Model { return { ...structuredClone(draft), saving: false, deleting: false, reloading: false, error: null, version: 0, localFingerprint: localFingerprint(draft.cassette), baselineFingerprint: draft.baseline ? fingerprint(draft.baseline.payload) : null }; }
function dirty(value: Model) { return value.baseline === null || value.localFingerprint !== value.baselineFingerprint; }
function busy(value: Model) { return value.saving || value.deleting || value.reloading; }
function statusOf(error: unknown): number | undefined { return record(error) && typeof error.status === 'number' ? error.status : undefined; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'The request failed. Your local changes were kept.'; }

export function createCassetteStore(deps: Dependencies) {
  let owner: string | null = null;
  let status: CassetteSyncSnapshot['status'] = 'hidden';
  let epoch = 0;
  let mutation = 0;
  let models = new Map<string, Model>();
  let lookups = new Map<string, TapeSync>();
  let tombstones = new Map<string, number>();
  let visible: Cassette[] = [];
  let loading = false;
  let listError: string | null = null;
  let nextCursor: string | undefined;
  let storageError: string | null = null;
  let importWarning: string | null = null;
  let storageBlocked = false;
  let legacy: Cassette[] = [];
  let listSerial = 0;
  const requests = new Set<AbortController>();
  const cache = new Map<string, { drafts: Draft[]; warning: string | null; blocked: boolean }>();
  const listeners = new Set<() => void>();
  let snapshot: CassetteSyncSnapshot;
  const keyFor = (subject: string | null) => `runman.cassettes.v2:${encodeURIComponent(deps.namespace)}:${subject === null ? 'guest' : `owner:${encodeURIComponent(subject)}`}`;
  const activeKey = () => keyFor(owner);
  function publish() {
    const tapes: Record<string, TapeSync> = Object.create(null) as Record<string, TapeSync>;
    for (const [id, value] of models) tapes[id] = { revision: value.baseline?.revision ?? 0, dirty: dirty(value), saving: value.saving, deleting: value.deleting, reloading: value.reloading, conflict: value.conflict, cloudMissing: value.cloudMissing, error: value.error, ...(value.issues ? { issues: value.issues } : {}) };
    for (const [id, value] of lookups) if (!Object.hasOwn(tapes, id)) tapes[id] = value;
    visible = status === 'hidden' ? [] : [...models.values()].map((value) => value.cassette);
    snapshot = { owner, status, epoch, context: epoch, loading, listError, nextCursor, storageError: storageError ?? importWarning, legacy: status === 'authenticated' ? legacy : [], tapes };
    listeners.forEach((listener) => listener());
  }
  function drafts(): Draft[] { return [...models.values()].map(({ cassette, baseline, conflict, cloudMissing, remoteRevision }) => structuredClone({ cassette, baseline, conflict, cloudMissing, ...(remoteRevision !== undefined ? { remoteRevision } : {}) })); }
  function persist() {
    if (status === 'hidden') return;
    const values = drafts();
    if (!storageBlocked) {
      try { deps.storage.setItem(activeKey(), JSON.stringify({ version: 1, drafts: values })); storageError = null; }
      catch { storageError = 'Browser draft storage failed. Changes remain in memory; keep this tab open or explicitly save to the cloud.'; }
    }
    cache.set(activeKey(), { drafts: values, warning: storageError, blocked: storageBlocked });
  }
  function readDrafts(key: string, subject: string | null): Draft[] {
    const remembered = cache.get(key);
    if (remembered) { storageError = remembered.warning; storageBlocked = remembered.blocked; return structuredClone(remembered.drafts); }
    try {
      const raw = deps.storage.getItem(key);
      if (raw === null) return subject === null ? (deps.seed?.() ?? []).map((cassette) => ({ cassette, baseline: null, conflict: false, cloudMissing: false })) : [];
      const value: unknown = JSON.parse(raw);
      if (!record(value) || value.version !== 1 || !Array.isArray(value.drafts)) throw new Error();
      const ids = new Set<string>();
      return value.drafts.map((entry: unknown): Draft => {
        if (!record(entry) || !localCassette(entry.cassette) || typeof entry.conflict !== 'boolean' || typeof entry.cloudMissing !== 'boolean' || ids.has(entry.cassette.id)) throw new Error();
        ids.add(entry.cassette.id);
        const checked = entry.baseline === null ? null : validateCassetteDocument(entry.baseline);
        if (checked && (!checked.ok || checked.value.payload.id !== entry.cassette.id)) throw new Error();
        if (entry.remoteRevision !== undefined && (typeof entry.remoteRevision !== 'number' || !Number.isSafeInteger(entry.remoteRevision) || entry.remoteRevision < 1)) throw new Error();
        return { cassette: entry.cassette, baseline: checked?.ok ? checked.value : null, conflict: entry.conflict, cloudMissing: entry.cloudMissing, ...(typeof entry.remoteRevision === 'number' ? { remoteRevision: entry.remoteRevision } : {}) };
      });
    } catch {
      storageBlocked = true;
      storageError = 'Stored browser drafts are unreadable. The original storage was retained; new edits stay in memory.';
      return [];
    }
  }
  function readImportChoices() {
    importWarning = null;
    const choices: Cassette[] = [];
    const seen = new Set<string>();
    const add = (entries: Cassette[]) => { for (const tape of entries) if (!seen.has(tape.id)) { seen.add(tape.id); choices.push(structuredClone(tape)); } };
    try {
      const guest = cache.get(keyFor(null));
      if (guest) add(guest.drafts.map((entry) => entry.cassette));
      {
        const raw = deps.storage.getItem(keyFor(null));
        if (raw) {
          const saved: unknown = JSON.parse(raw);
          if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.drafts) || !saved.drafts.every((entry: unknown) => record(entry) && localCassette(entry.cassette))) throw new Error();
          add(saved.drafts.map((entry: { cassette: Cassette }) => entry.cassette));
        }
      }
      const raw = deps.storage.getItem(LEGACY_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (!Array.isArray(saved) || !saved.every(localCassette)) throw new Error();
        add(saved);
      }
    } catch { importWarning = 'Some existing browser tapes could not be read. Original storage was retained.'; }
    legacy = choices;
  }
  function controller() { const value = new AbortController(); requests.add(value); return value; }
  function current(ticket: number, subject: string) { return epoch === ticket && status === 'authenticated' && owner === subject; }
  function decoded(document: CassetteDocument, expectedId?: string) {
    const restored = cassetteFromDocument(document);
    if (!restored.ok || (expectedId !== undefined && document.payload.id !== expectedId)) throw new Error('The cloud returned invalid cassette data. Local changes were kept.');
    return restored.value.cassette;
  }
  function applyCloud(document: CassetteDocument, startedMutation: number) {
    const id = document.payload.id;
    if ((tombstones.get(id) ?? -1) > startedMutation) return;
    const cassette = decoded(document);
    const previous = models.get(id);
    if (previous && (previous.baseline?.revision ?? 0) > document.revision) return;
    if (previous && (dirty(previous) || busy(previous) || previous.conflict)) {
      if (!previous.baseline || previous.baseline.revision !== document.revision || fingerprint(previous.baseline.payload) !== fingerprint(document.payload)) {
        previous.conflict = true;
        previous.remoteRevision = Math.max(previous.remoteRevision ?? 0, document.revision);
        previous.error = 'The cloud version changed. Your draft was kept; confirm reload or save a copy.';
      }
      return;
    }
    tombstones.delete(id);
    models.set(id, model({ cassette, baseline: document, conflict: false, cloudMissing: false }));
    lookups.delete(id);
  }
  function failed(value: Model, error: unknown) {
    value.error = messageOf(error);
    if (statusOf(error) === 409) value.conflict = true;
    if (statusOf(error) === 404) value.cloudMissing = true;
    if (record(error) && Array.isArray(error.details)) value.issues = error.details.filter((entry: unknown): entry is CassetteValidationIssue => record(entry) && typeof entry.path === 'string' && typeof entry.message === 'string');
  }
  async function list(more: boolean) {
    if (status !== 'authenticated' || owner === null || (more && (loading || !nextCursor))) return;
    const subject = owner;
    const ticket = epoch;
    const serial = ++listSerial;
    const started = mutation;
    const request = controller();
    const cursor = more ? nextCursor : undefined;
    loading = true; listError = null;
    if (!more) nextCursor = undefined;
    publish();
    try {
      const page = await deps.api.list(subject, { limit: 25, ...(cursor ? { cursor } : {}) }, request.signal);
      if (!current(ticket, subject) || serial !== listSerial) return;
      page.items.forEach((item) => decoded(item));
      page.items.forEach((item) => applyCloud(item, started));
      nextCursor = page.nextCursor;
      persist();
    } catch (error) { if (current(ticket, subject) && serial === listSerial) listError = messageOf(error); }
    finally { requests.delete(request); if (current(ticket, subject) && serial === listSerial) { loading = false; publish(); } }
  }
  async function load(id: string, confirmDiscard: boolean, onlyMissing: boolean) {
    if (status !== 'authenticated' || owner === null) return Boolean(models.get(id));
    const value = models.get(id);
    if (onlyMissing && value) return true;
    if (value && busy(value)) return false;
    if (lookups.get(id)?.reloading) return false;
    if (value && (dirty(value) || value.conflict) && !confirmDiscard) { value.error = 'Confirm that you want to discard local changes before reloading.'; publish(); return false; }
    const subject = owner; const ticket = epoch; const version = value?.version; const started = mutation;
    const request = controller();
    if (value) { value.reloading = true; value.error = null; }
    else lookups.set(id, { revision: 0, dirty: false, saving: false, deleting: false, reloading: true, conflict: false, cloudMissing: false, error: null });
    publish();
    try {
      const response = await deps.api.get(subject, id, request.signal);
      if (!current(ticket, subject)) return false;
      const cassette = decoded(response.cassette, id);
      const active = models.get(id);
      if ((tombstones.get(id) ?? -1) > started) {
        lookups.delete(id); return false;
      }
      if (active && (active !== value || active.version !== version || (active.baseline?.revision ?? 0) > response.cassette.revision || (active.remoteRevision ?? 0) > response.cassette.revision)) {
        if (onlyMissing) { lookups.delete(id); return true; }
        active.conflict = true;
        active.error = 'Local or cloud changes arrived during reload and were kept. Confirm reload again to discard them.';
        return false;
      }
      models.set(id, model({ cassette, baseline: response.cassette, conflict: false, cloudMissing: false }));
      lookups.delete(id); tombstones.delete(id); persist(); return true;
    } catch (error) {
      if (!current(ticket, subject)) return false;
      if (value) { failed(value, error); persist(); }
      else lookups.set(id, { revision: 0, dirty: false, saving: false, deleting: false, reloading: false, conflict: false, cloudMissing: statusOf(error) === 404, error: messageOf(error) });
      return false;
    } finally { requests.delete(request); if (current(ticket, subject)) { const active = models.get(id); if (active) active.reloading = false; const lookup = lookups.get(id); if (lookup) lookup.reloading = false; publish(); } }
  }
  publish();
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getAll: () => visible,
    get: (id: string) => status === 'hidden' ? undefined : models.get(id)?.cassette,
    getSnapshot: () => snapshot,
    getSync: () => snapshot,
    setSession(nextStatus: CassetteSyncSnapshot['status'], nextOwner: string | null = null) {
      if (nextStatus === 'authenticated' && (!nextOwner || !/^[a-zA-Z0-9_-]{1,128}$/.test(nextOwner))) nextStatus = 'hidden';
      const subject = nextStatus === 'authenticated' ? nextOwner : null;
      if (nextStatus === status && subject === owner) return;
      ++epoch; ++listSerial;
      for (const request of requests) request.abort();
      requests.clear(); models = new Map(); lookups = new Map(); tombstones = new Map();
      owner = subject; status = nextStatus; loading = false; listError = null; nextCursor = undefined; storageError = null; importWarning = null; storageBlocked = false; legacy = [];
      if (status !== 'hidden') {
        models = new Map(readDrafts(activeKey(), owner).map((entry) => [entry.cassette.id, model(entry)]));
        cache.set(activeKey(), { drafts: drafts(), warning: storageError, blocked: storageBlocked });
        if (status === 'authenticated') readImportChoices();
      }
      publish();
      if (status === 'authenticated') void list(false);
    },
    create(partial: Partial<Cassette> = {}): Cassette {
      if (status === 'hidden') throw new Error('Wait for your session before creating a cassette.');
      const now = deps.now();
      const cassette: Cassette = structuredClone({ id: deps.newId(), name: 'Untitled Mix', shellColor: '#f9c6d3', labelColor: '#fff6ea', inkColor: '#7a1f3d', shellType: 'solid', penStyle: 'handwritten', stickers: [], tracks: [], createdAt: now, updatedAt: now, ...partial });
      if (!localCassette(cassette) || models.has(cassette.id)) throw new Error('Invalid or duplicate local cassette.');
      models.set(cassette.id, model({ cassette, baseline: null, conflict: false, cloudMissing: false }));
      ++mutation; persist(); publish(); return cassette;
    },
    update(id: string, patch: Partial<Cassette> | ((cassette: Cassette) => Partial<Cassette>)) {
      const value = models.get(id); if (!value || status === 'hidden') return;
      if (value.deleting) { value.error = 'Wait for deletion to finish before editing this cassette.'; publish(); return; }
      const change = typeof patch === 'function' ? patch(structuredClone(value.cassette)) : patch;
      const next = structuredClone({ ...value.cassette, ...change, id, createdAt: value.cassette.createdAt, updatedAt: deps.now() });
      if (!localCassette(next)) { value.error = 'Invalid local edit. The previous draft was kept.'; publish(); return; }
      value.cassette = next; value.localFingerprint = localFingerprint(next); value.version++; value.error = null; value.issues = undefined; ++mutation;
      persist(); publish();
    },
    async save(id: string): Promise<boolean> {
      const value = models.get(id);
      if (!value || busy(value) || status !== 'authenticated' || owner === null) { if (value && status === 'guest') { value.error = 'Sign in before saving to the cloud.'; publish(); } return false; }
      const converted = cassetteToSaveRequest(value.cassette, value.baseline?.revision ?? 0);
      if (!converted.ok) { value.error = 'This draft cannot be saved yet. Fix the listed metadata or audio reference issues.'; value.issues = converted.issues; publish(); return false; }
      const subject = owner; const ticket = epoch; const request = controller();
      const sent = fingerprint(converted.value.cassette);
      value.saving = true; value.error = null; value.issues = undefined; publish();
      try {
        const response = await deps.api.save(subject, converted.value, request.signal);
        if (!current(ticket, subject)) return false;
        const cassette = decoded(response.cassette, id);
        if (response.cassette.revision !== converted.value.expectedRevision + 1 || fingerprint(response.cassette.payload) !== sent) throw new Error('Unexpected cloud save response. Your draft and revision were kept.');
        const unchanged = value.localFingerprint === sent;
        value.baseline = structuredClone(response.cassette);
        value.baselineFingerprint = fingerprint(response.cassette.payload);
        if (unchanged) value.cassette = cassette;
        value.conflict = (value.remoteRevision ?? 0) > response.cassette.revision;
        value.cloudMissing = false;
        if (value.conflict) value.error = 'The cloud changed after this save. Confirm reload or save a copy.';
        persist(); return true;
      } catch (error) { if (current(ticket, subject)) { failed(value, error); persist(); } return false; }
      finally { requests.delete(request); if (current(ticket, subject)) { value.saving = false; publish(); } }
    },
    async remove(id: string): Promise<boolean> {
      const value = models.get(id); if (!value || busy(value) || status === 'hidden') return false;
      const revision = value.baseline?.revision ?? 0;
      if (revision === 0 || value.cloudMissing || status === 'guest') { models.delete(id); tombstones.set(id, ++mutation); persist(); publish(); return true; }
      if (owner === null) return false;
      const subject = owner; const ticket = epoch; const request = controller();
      value.deleting = true; value.error = null; publish();
      try {
        const response = await deps.api.remove(subject, id, revision, request.signal);
        if (!current(ticket, subject)) return false;
        if (response.id !== id || response.deletedRevision !== revision) throw new Error('Unexpected cloud delete response. Your draft was kept.');
        models.delete(id); tombstones.set(id, ++mutation); persist(); return true;
      } catch (error) { if (current(ticket, subject)) { failed(value, error); persist(); } return false; }
      finally { requests.delete(request); if (current(ticket, subject)) { value.deleting = false; publish(); } }
    },
    reload: (id: string, confirmDiscard = false) => load(id, confirmDiscard, false),
    ensureLoaded: (id: string) => load(id, false, true),
    refresh: () => list(false),
    loadMore: () => list(true),
    copy(id: string): Cassette | undefined {
      const value = models.get(id); if (!value || status === 'hidden') return;
      const now = deps.now();
      const cassette = structuredClone({ ...value.cassette, id: deps.newId(), createdAt: now, updatedAt: now });
      models.set(cassette.id, model({ cassette, baseline: null, conflict: false, cloudMissing: false }));
      ++mutation; persist(); publish(); return cassette;
    },
    importLegacy(ids: string[]): Cassette[] {
      if (status !== 'authenticated') return [];
      const selected = new Set(ids); const imported: Cassette[] = [];
      for (const tape of legacy) if (selected.has(tape.id)) {
        const now = deps.now();
        const cassette = structuredClone({ ...tape, id: deps.newId(), createdAt: now, updatedAt: now });
        models.set(cassette.id, model({ cassette, baseline: null, conflict: false, cloudMissing: false }));
        imported.push(cassette); ++mutation;
      }
      persist(); publish(); return imported;
    },
    storageChanged(key: string | null) {
      // Invalidate inactive/hidden account caches too. Otherwise a later return
      // could overwrite another tab's newer disk snapshot during list merge.
      for (const [cachedKey, remembered] of cache) if (key === null || key === cachedKey) {
        const clean = !remembered.warning && !remembered.blocked && remembered.drafts.every((entry) => entry.baseline !== null && !entry.conflict && localFingerprint(entry.cassette) === fingerprint(entry.baseline.payload));
        if (clean) cache.delete(cachedKey);
        else cache.set(cachedKey, { ...remembered, blocked: true, warning: 'Another tab changed browser drafts. Your retained memory copy needs recovery; external storage was not overwritten.' });
      }
      if (status === 'hidden') return;
      if (key === LEGACY_KEY || (key === keyFor(null) && owner !== null)) { readImportChoices(); publish(); return; }
      if (key !== null && key !== activeKey()) return;
      if (loading || [...models.values()].some((value) => dirty(value) || busy(value))) {
        storageBlocked = true;
        storageError = 'Another tab changed these browser drafts. Your current edits were kept in memory; save a cloud copy before closing.';
        for (const value of models.values()) value.conflict = true;
        persist(); publish(); return;
      }
      cache.delete(activeKey()); storageError = null; storageBlocked = false;
      models = new Map(readDrafts(activeKey(), owner).map((entry) => [entry.cassette.id, model(entry)]));
      readImportChoices(); publish();
    },
  };
}
