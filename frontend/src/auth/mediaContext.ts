import { sessionStore } from './session';
import { createMediaContext } from './mediaContextStore';

const context = createMediaContext(sessionStore);
export const getMediaAccount = context.account;
export const subscribeMediaAccount = context.subscribe;
