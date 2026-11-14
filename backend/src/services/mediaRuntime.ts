import { config, type MediaSettings } from '../config.js';
import { createDynamoMediaRepository } from '../aws/dynamoMedia.js';
import { createPrivateMediaStorage } from '../aws/privateMedia.js';
import { createMediaService } from './mediaService.js';
import type { MediaRepository } from './mediaRepository.js';
import type { PrivateMediaStorage } from './mediaStorage.js';

export interface MediaRuntimeOptions {
  settings?: MediaSettings;
  repository?: MediaRepository;
  storage?: PrivateMediaStorage;
  clock?: () => string;
  newId?: () => string;
}
export function createMediaRuntime(options: MediaRuntimeOptions = {}) {
  const settings = options.settings ?? config.media;
  const bucket = settings.bucket;
  const ready = settings.storageMode === 's3' && settings.cassetteStorageMode === 'dynamodb' &&
    ['us-west-2', 'us-east-1'].includes(settings.region) &&
    typeof settings.userPoolId === 'string' && new RegExp(`^${settings.region}_[a-zA-Z0-9]+$`).test(settings.userPoolId) &&
    typeof settings.clientId === 'string' && /^[a-zA-Z0-9]{1,128}$/.test(settings.clientId) &&
    typeof settings.tableName === 'string' && /^[a-zA-Z0-9_.-]{3,255}$/.test(settings.tableName) &&
    typeof bucket === 'string' && bucket.length >= 3 && bucket.length <= 63 && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) &&
    !bucket.includes('..') && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bucket) &&
    !bucket.startsWith('xn--') && !bucket.startsWith('sthree-') && !bucket.startsWith('amzn-s3-demo-') && !bucket.endsWith('-s3alias') && !bucket.endsWith('--ol-s3') && !bucket.endsWith('.mrap') && !bucket.endsWith('--x-s3') && !bucket.endsWith('--table-s3') &&
    bucket !== settings.publicBucket;
  if (!ready) return;
  return createMediaService(options.repository ?? createDynamoMediaRepository(settings.tableName!), options.storage ?? createPrivateMediaStorage(bucket!), options.clock, options.newId);
}
