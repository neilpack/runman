import { Amplify } from 'aws-amplify';
import { createAuthInitializer } from './configuration';

// Raw glob tolerates an absent file and lets malformed JSON fail closed at runtime.
const generatedOutputs = import.meta.glob<string>('../../amplify_outputs.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const authSetup = createAuthInitializer((outputs) => Amplify.configure(outputs))(
  generatedOutputs['../../amplify_outputs.json'],
);
