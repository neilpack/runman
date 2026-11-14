import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'runmanAudio',
  access: (allow) => ({
    'audio/{entity_id}/*': [allow.entity('identity').to(['read', 'write', 'delete'])],
  }),
});
