// Legacy reference only; DO NOT DEPLOY in Learner Lab. Use the approved
// standalone Cognito user pool and public browser-client configuration instead.
import { defineAuth } from '@aws-amplify/backend';

// Cognito handles email confirmation and password recovery; no custom auth endpoints.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
