import { api } from '@/api/client';
import { getMediaAccount, subscribeMediaAccount } from '@/auth/mediaContext';
import { createAudioStorage } from './audioStorage';
import { audioSha256, postAudio } from './audioTransport';
export const audioStorage = createAudioStorage({ api: api.media, account: getMediaAccount, subscribeAccount: subscribeMediaAccount, canPlayType: (type) => document.createElement('audio').canPlayType(type) !== '', hash: audioSha256, post: postAudio });
