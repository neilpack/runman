import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl, remove, uploadData } from 'aws-amplify/storage';
import { createAudioStorage, PLAYBACK_URL_SECONDS } from './audioStorage';

// Uses the existing app-level Amplify.configure(generatedOutputs). No auth changes.
export const audioStorage = createAudioStorage({
  async identityId() {
    const session = await fetchAuthSession();
    if (!session.tokens || !session.identityId || !session.credentials) {
      throw new Error('Sign in before accessing cloud audio.');
    }
    return session.identityId;
  },
  randomId: () => crypto.randomUUID(),
  canPlayType: (type) => document.createElement('audio').canPlayType(type) !== '',
  upload: ({ path, data, contentType, onProgress }) => uploadData({
    path, data,
    options: { contentType, onProgress, preventOverwrite: true },
  }),
  playback: (path) => getUrl({
    path,
    options: { expiresIn: PLAYBACK_URL_SECONDS, validateObjectExistence: true },
  }),
  remove: async (path) => { await remove({ path }); },
});
