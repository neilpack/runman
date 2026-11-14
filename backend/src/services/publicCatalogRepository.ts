// Storage port for what listeners publish to Explore (layout: shared/src/explorePublishing.ts).
// The memory implementation is for local development; aws/dynamoPublicCatalog.ts is the real one.

import { validatePublicTape, validatePublishProfileRequest, validatePublishSongRequest, type PublicProfile, type PublicTape, type StoredAudioReference } from '@runman/shared';

export class CatalogCorrupt extends Error {}
/** Another account owns this catalog row (or the username). */
export class CatalogConflict extends Error {}
export class UsernameTaken extends Error {}

export interface PublicSongItem {
  id: string;
  ownerId: string;
  /** Name at publish time; Explore shows the profile's current name when there is one. */
  uploaderUsername: string;
  title: string;
  artist: string;
  durationSec: number;
  audio: StoredAudioReference;
  artworkUrl?: string;
  addCount: number;
  publishedAt: string;
  updatedAt: string;
}
export type PublicSongInput = Omit<PublicSongItem, 'addCount' | 'publishedAt' | 'updatedAt'>;
export interface PublicProfileItem extends PublicProfile { updatedAt: string }
export type PublicProfileInput = Omit<PublicProfile, 'userId'>;
export type PublicTapeInput = Omit<PublicTape, 'publishedAt' | 'updatedAt'>;

export interface PublicCatalogRepository {
  listSongs(): Promise<PublicSongItem[]>;
  listTapes(): Promise<PublicTape[]>;
  listProfiles(): Promise<PublicProfileItem[]>;
  getSong(id: string): Promise<PublicSongItem | undefined>;
  getProfile(owner: string): Promise<PublicProfileItem | undefined>;
  /** Creates or updates; keeps publishedAt and addCount. CatalogConflict if another owner has the id. */
  putSong(input: PublicSongInput, now: string): Promise<PublicSongItem>;
  /** False when there was nothing of this owner's to remove. */
  deleteSong(id: string, owner: string): Promise<boolean>;
  putTape(input: PublicTapeInput, now: string): Promise<PublicTape>;
  deleteTape(id: string, owner: string): Promise<boolean>;
  /** Claims the username atomically (UsernameTaken). With `ifPublished`, returns undefined instead of creating. */
  putProfile(owner: string, input: PublicProfileInput, now: string, ifPublished: boolean): Promise<PublicProfileItem | undefined>;
  /** Counts one add per listener. Returns the song's addCount, or undefined if the song is gone. */
  recordAdd(songId: string, listener: string): Promise<number | undefined>;
}

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const time = (value: unknown) => typeof value === 'string' && TIME.test(value) && new Date(value).toISOString() === value;

/** Rows are re-validated on every read, so a bad row can never reach a listener. */
export function checkedSong(value: unknown): PublicSongItem {
  if (!value || typeof value !== 'object') throw new CatalogCorrupt();
  const { id, ownerId, uploaderUsername, title, artist, durationSec, audio, artworkUrl, addCount, publishedAt, updatedAt, ...rest } = value as Record<string, unknown>;
  const song = validatePublishSongRequest({ title, artist, durationSec, audio, ...(artworkUrl !== undefined ? { artworkUrl } : {}) });
  const user = validatePublishProfileRequest({ username: uploaderUsername, avatar: null, favoriteTape: null });
  if (Object.keys(rest).length || !song.ok || !user.ok || typeof id !== 'string' || !ID.test(id) || typeof ownerId !== 'string' || !ID.test(ownerId) ||
    typeof addCount !== 'number' || !Number.isSafeInteger(addCount) || addCount < 0 || !time(publishedAt) || !time(updatedAt)) throw new CatalogCorrupt();
  return { id, ownerId, uploaderUsername: user.value.username, ...song.value, addCount, publishedAt: publishedAt as string, updatedAt: updatedAt as string };
}

export function checkedProfile(value: unknown): PublicProfileItem {
  if (!value || typeof value !== 'object') throw new CatalogCorrupt();
  const { userId, username, avatar, favoriteTape, updatedAt, ...rest } = value as Record<string, unknown>;
  const profile = validatePublishProfileRequest({ username, avatar, favoriteTape });
  if (Object.keys(rest).length || !profile.ok || typeof userId !== 'string' || !ID.test(userId) || !time(updatedAt)) throw new CatalogCorrupt();
  return { userId, username: profile.value.username, avatar: profile.value.avatar, favoriteTape: profile.value.favoriteTape, updatedAt: updatedAt as string };
}

export function checkedTape(value: unknown): PublicTape {
  const tape = validatePublicTape(value);
  if (!tape.ok) throw new CatalogCorrupt();
  return tape.value;
}

export function createMemoryPublicCatalogRepository(): PublicCatalogRepository {
  const songs = new Map<string, PublicSongItem>();
  const tapes = new Map<string, PublicTape>();
  const profiles = new Map<string, PublicProfileItem>();
  const usernames = new Map<string, string>();
  const adds = new Set<string>();
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    async listSongs() { return copy([...songs.values()]); },
    async listTapes() { return copy([...tapes.values()]); },
    async listProfiles() { return copy([...profiles.values()]); },
    async getSong(id) { return copy(songs.get(id)); },
    async getProfile(owner) { return copy(profiles.get(owner)); },
    async putSong(input, now) {
      const previous = songs.get(input.id);
      if (previous && previous.ownerId !== input.ownerId) throw new CatalogConflict();
      const item = checkedSong({ ...input, addCount: previous?.addCount ?? 0, publishedAt: previous?.publishedAt ?? now, updatedAt: now });
      songs.set(item.id, item);
      return copy(item);
    },
    async deleteSong(id, owner) {
      if (songs.get(id)?.ownerId !== owner) return false;
      return songs.delete(id);
    },
    async putTape(input, now) {
      const previous = tapes.get(input.id);
      if (previous && previous.owner.userId !== input.owner.userId) throw new CatalogConflict();
      const item = checkedTape({ ...input, publishedAt: previous?.publishedAt ?? now, updatedAt: now });
      tapes.set(item.id, item);
      return copy(item);
    },
    async deleteTape(id, owner) {
      if (tapes.get(id)?.owner.userId !== owner) return false;
      return tapes.delete(id);
    },
    async putProfile(owner, input, now, ifPublished) {
      const previous = profiles.get(owner);
      if (ifPublished && !previous) return undefined;
      const claim = input.username.toLowerCase();
      const holder = usernames.get(claim);
      if (holder !== undefined && holder !== owner) throw new UsernameTaken();
      const item = checkedProfile({ userId: owner, ...input, updatedAt: now });
      if (previous && previous.username.toLowerCase() !== claim) usernames.delete(previous.username.toLowerCase());
      usernames.set(claim, owner);
      profiles.set(owner, item);
      return copy(item);
    },
    async recordAdd(songId, listener) {
      const song = songs.get(songId);
      if (!song) return undefined;
      const key = `${songId}\n${listener}`;
      if (!adds.has(key)) { adds.add(key); song.addCount++; }
      return song.addCount;
    },
  };
}
