// Account/profile data model and validation. Pure: no SDK, DOM, or React, so it is unit-testable.
//
// PublicProfile/TapeSnapshot are the Explore API contract, so they live in @runman/shared.

import type { Cassette, PublicProfile, TapeSnapshot } from '@runman/shared';

export type { PublicProfile, TapeSnapshot };

/** Cognito caps every attribute value at 2048 characters; keep headroom for the data-URL prefix. */
export const AVATAR_MAX_CHARS = 2000;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/** Your own account: the public profile plus private fields. */
export interface AccountProfile extends PublicProfile {
  email: string;
  /** False until you pick a username; `username` then holds a placeholder derived from the email. */
  hasUsername: boolean;
}

export function snapshotTape(c: Cassette): TapeSnapshot {
  return {
    id: c.id,
    name: c.name,
    shellColor: c.shellColor,
    labelColor: c.labelColor,
    inkColor: c.inkColor,
    shellType: c.shellType,
    penStyle: c.penStyle,
    stickers: c.stickers,
    sideB: c.sideB,
    updatedAt: c.updatedAt,
    trackCount: c.tracks.length,
  };
}

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Returns an error message, or null when the username is acceptable. */
export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Use ${USERNAME_MAX} characters or fewer.`;
  if (!USERNAME_PATTERN.test(name)) return 'Use only letters, numbers, dots, dashes and underscores.';
  if (/^[._-]|[._-]$/.test(name)) return 'Start and end with a letter or number.';
  return null;
}

/** Placeholder name shown before someone picks a username: the email's local part, cleaned up. */
export function fallbackUsername(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[^A-Za-z0-9_.-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, USERNAME_MAX);
  return cleaned.length >= USERNAME_MIN ? cleaned : 'listener';
}

/** Mirrors the user-pool password policy (see AUTH_DEPLOYMENT.md). */
export const PASSWORD_RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'lower', label: 'A lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'upper', label: 'An uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'number', label: 'A number', test: (pw) => /[0-9]/.test(pw) },
  { id: 'symbol', label: 'A symbol', test: (pw) => /[^A-Za-z0-9\s]/.test(pw) },
];

export function validatePasswordChange(input: { current: string; next: string; confirm: string }): string | null {
  if (!input.current) return 'Enter your current password.';
  if (PASSWORD_RULES.some((rule) => !rule.test(input.next))) return 'Your new password does not meet every rule below.';
  if (input.next !== input.confirm) return 'The new passwords do not match.';
  if (input.next === input.current) return 'Choose a password different from your current one.';
  return null;
}

const DATA_AVATAR = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Only render images we produced (small base64 data URLs) or https URLs. Never javascript:, etc. */
export function isSafeAvatar(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  if (DATA_AVATAR.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export type AccountAction = 'load' | 'username' | 'avatar' | 'password' | 'favorite';

export function accountErrorText(error: unknown, action: AccountAction): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (action === 'password') {
    if (name === 'NotAuthorizedException') return 'Your current password is incorrect.';
    if (name === 'InvalidPasswordException') return 'That new password is not allowed. Check the rules below.';
  }
  switch (name) {
    case 'NotAuthorizedException':
      // Cognito uses this for both expired sessions and app clients without write access to an attribute.
      if (/attribute/i.test(message)) {
        return "Your account can't save this field yet. The Cognito app client needs write access to it (see the Account page notes).";
      }
      return 'Your session has expired. Sign in again to make changes.';
    case 'UserUnAuthenticatedException':
      return 'Sign in again to make changes.';
    case 'InvalidParameterException':
      return 'That value was not accepted. Please try something else.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'NetworkError':
      return 'You appear to be offline. Check your connection and try again.';
    default:
      return action === 'load'
        ? 'Your account details could not be loaded. Check your connection and try again.'
        : 'That change could not be saved. Check your connection and try again.';
  }
}
