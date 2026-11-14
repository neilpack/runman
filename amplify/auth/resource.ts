import { defineAuth } from '@aws-amplify/backend';

// Cognito handles email confirmation and password recovery; no custom auth endpoints.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
