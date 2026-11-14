import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/profile/Avatar';
import { accountStore } from '@/profile/account';
import { AVATAR_INPUT_TYPES, DEFAULT_CROP, encodeAvatar, readAvatarFile, type AvatarCrop } from '@/profile/avatarImage';
import type { AccountProfile } from '@/profile/profileModel';
import { FormNote, type Note } from './FormNote';

export function AvatarEditor({ profile }: { profile: AccountProfile }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(DEFAULT_CROP);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  // Free decoded pixels when the draft is replaced or the editor unmounts.
  useEffect(() => () => image?.close(), [image]);

  // The preview is the exact compressed image that will be saved.
  useEffect(() => {
    if (!image) { setPreview(null); return; }
    try {
      setPreview(encodeAvatar(image, crop));
    } catch (error) {
      setPreview(null);
      setNote({ kind: 'error', text: error instanceof Error ? error.message : 'That image could not be prepared.' });
    }
  }, [image, crop]);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be picked again
    if (!file) return;
    setNote(null);
    try {
      setImage(await readAvatarFile(file));
      setCrop(DEFAULT_CROP);
    } catch (error) {
      setNote({ kind: 'error', text: error instanceof Error ? error.message : 'That image could not be read.' });
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setNote(null);
    const result = await accountStore.setAvatar(preview);
    setBusy(false);
    if (result.ok) {
      setImage(null);
      setNote({ kind: 'ok', text: 'Profile picture saved.' });
    } else setNote({ kind: 'error', text: result.error });
  }

  async function remove() {
    setBusy(true);
    setNote(null);
    const result = await accountStore.removeAvatar();
    setBusy(false);
    setNote(result.ok ? { kind: 'ok', text: 'Profile picture removed.' } : { kind: 'error', text: result.error });
  }

  const slider = (key: keyof AvatarCrop, label: string, min: number, max: number) => (
    <label className="account-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={crop[key]}
        disabled={busy}
        onChange={(e) => setCrop((c) => ({ ...c, [key]: Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <div className="account-avatar">
      <div className="account-avatar-row">
        <Avatar
          src={image ? preview : profile.avatar}
          name={profile.username}
          size={112}
          label={image ? 'New profile picture preview' : 'Your profile picture'}
          className="account-avatar-big"
        />
        <div className="account-avatar-actions">
          <input ref={inputRef} type="file" accept={AVATAR_INPUT_TYPES.join(',')} hidden onChange={onPick} />
          {image ? (
            <>
              <Button type="button" onClick={save} disabled={busy || !preview}>{busy ? 'Saving…' : 'Save picture'}</Button>
              <Button type="button" variant="secondary" onClick={() => setImage(null)} disabled={busy}>Cancel</Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                {profile.avatar ? 'Change picture' : 'Add picture'}
              </Button>
              {profile.avatar && (
                <Button type="button" variant="danger" onClick={remove} disabled={busy}>
                  {busy ? 'Removing…' : 'Remove'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {image && (
        <div className="account-crop">
          {slider('zoom', 'Zoom', 1, 3)}
          {slider('panX', 'Left / right', -1, 1)}
          {slider('panY', 'Up / down', -1, 1)}
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            Pick a different image
          </Button>
        </div>
      )}
      <FormNote note={note} />
    </div>
  );
}
