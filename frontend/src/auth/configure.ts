import { Amplify } from 'aws-amplify';
import { createAuthInitializer } from './configuration';

// Raw glob tolerates an absent file and lets malformed JSON fail closed at runtime.
const publicCognitoConfig = import.meta.glob<string>('../../cognito-config.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const authSetup = createAuthInitializer((resources) => Amplify.configure(resources))(
  publicCognitoConfig['../../cognito-config.json'],
);
