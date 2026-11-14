import type { SessionStore } from './sessionStore';

export type AuthMode = 'login' | 'signup' | 'confirmSignup' | 'requestReset' | 'confirmReset';
interface FlowSnapshot {
  mode: AuthMode;
  email: string;
  pending: boolean;
  error: string | null;
  message: string | null;
}

export interface AuthFlowSdk {
  signIn(input: { username: string; password: string; options: { authFlowType: 'USER_SRP_AUTH' } }): Promise<{ isSignedIn: boolean; nextStep: { signInStep: string } }>;
  autoSignIn(): Promise<{ isSignedIn: boolean; nextStep: { signInStep: string } }>;
  signUp(input: { username: string; password: string; options: { userAttributes: { email: string }; autoSignIn: { authFlowType: 'USER_SRP_AUTH' } } }): Promise<{ nextStep: { signUpStep: string } }>;
  confirmSignUp(input: { username: string; confirmationCode: string }): Promise<{ nextStep: { signUpStep: string } }>;
  resendSignUpCode(input: { username: string }): Promise<unknown>;
  resetPassword(input: { username: string }): Promise<{ nextStep: { resetPasswordStep: string } }>;
  confirmResetPassword(input: { username: string; confirmationCode: string; newPassword: string }): Promise<void>;
}

function errorText(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'CodeMismatchException': return 'That code is incorrect. Please try again.';
    case 'ExpiredCodeException': return 'That code has expired. Request a new code.';
    case 'UsernameExistsException': return 'An account with this email already exists. Log in or reset your password.';
    case 'NotAuthorizedException': return 'The email, password, or code was not accepted. Please try again.';
    case 'InvalidPasswordException': return 'Use at least 8 characters with uppercase, lowercase, a number, and a symbol.';
    case 'LimitExceededException':
    case 'TooManyRequestsException': return 'Too many attempts. Please wait before trying again.';
    default: return 'The request could not be completed. Check your connection and try again.';
  }
}

export function createAuthFlow(sdk: AuthFlowSdk, session: SessionStore, initialMode: AuthMode) {
  let snapshot: FlowSnapshot = { mode: initialMode, email: '', pending: false, error: null, message: null };
  let epoch = 0;
  let disposed = false;
  let activeAttempt: number | null = null;
  const listeners = new Set<() => void>();
  function update(change: Partial<FlowSnapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach((listener) => listener());
  }
  function cancel() {
    ++epoch;
    if (activeAttempt !== null) session.abandonSignIn(activeAttempt);
  }
  return {
    getSnapshot: () => snapshot,
    activate() { disposed = false; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setMode(mode: AuthMode) {
      cancel();
      update({ mode, pending: false, error: null, message: null });
    },
    dispose() { disposed = true; cancel(); },
    async submit(input: { email: string; password: string; code: string }, resend = false) {
      if (disposed || snapshot.pending) return;
      const ticket = ++epoch;
      const mode = snapshot.mode;
      const email = mode === 'confirmSignup' || mode === 'confirmReset' ? snapshot.email : input.email.trim();
      const active = () => !disposed && ticket === epoch;
      update({ pending: true, email, error: null, message: null });
      let attempt: number | null = null;
      async function completeSignupSignIn() {
        const fallback = 'Email confirmed. Automatic sign-in could not be completed. Log in to continue.';
        attempt = session.beginSignIn();
        if (attempt === null) { if (active()) update({ mode: 'login', message: fallback }); return; }
        activeAttempt = attempt;
        try {
          const result = await sdk.autoSignIn();
          const done = result.isSignedIn && result.nextStep.signInStep === 'DONE';
          const authenticated = await session.settleSignIn(attempt, done && active());
          attempt = null;
          activeAttempt = null;
          if (active() && !authenticated) update({ mode: 'login', message: fallback });
        } catch {
          if (attempt !== null) { await session.settleSignIn(attempt, false); attempt = null; activeAttempt = null; }
          if (active()) update({ mode: 'login', message: fallback });
        }
      }
      try {
        if (resend) {
          if (mode === 'confirmSignup') await sdk.resendSignUpCode({ username: email });
          else if (mode === 'confirmReset') {
            const result = await sdk.resetPassword({ username: email });
            if (active() && result.nextStep.resetPasswordStep === 'DONE') {
              update({ mode: 'login', message: 'Password reset finished. Log in to continue.' });
              return;
            }
            if (result.nextStep.resetPasswordStep !== 'CONFIRM_RESET_PASSWORD_WITH_CODE') throw new Error('Unsupported reset step');
          }
          else return;
          if (active()) update({ message: 'A new code was requested. Check your email.' });
        } else if (mode === 'login') {
          attempt = session.beginSignIn();
          if (attempt === null) throw new Error('SessionBusy');
          activeAttempt = attempt;
          const result = await sdk.signIn({ username: email, password: input.password, options: { authFlowType: 'USER_SRP_AUTH' } });
          const done = result.isSignedIn && result.nextStep.signInStep === 'DONE';
          const authenticated = await session.settleSignIn(attempt, done && active());
          attempt = null;
          activeAttempt = null;
          if (!active()) return;
          if (done) {
            if (!authenticated) update({ error: 'Sign-in finished, but your session could not be verified. Please retry.' });
          } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
            update({ mode: 'confirmSignup', message: 'Confirm your email to continue. You can request another code below.' });
          } else if (result.nextStep.signInStep === 'RESET_PASSWORD') {
            update({ mode: 'requestReset', message: 'Reset your password to continue.' });
          } else update({ error: 'This account requires an additional sign-in step that this app does not support. Contact the team.' });
        } else if (mode === 'signup') {
          const result = await sdk.signUp({ username: email, password: input.password, options: { userAttributes: { email }, autoSignIn: { authFlowType: 'USER_SRP_AUTH' } } });
          if (!active()) return;
          if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') update({ mode: 'confirmSignup', message: 'Check your email for a confirmation code.' });
          else if (result.nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') await completeSignupSignIn();
          else if (result.nextStep.signUpStep === 'DONE') update({ mode: 'login', message: 'Your account is ready. Log in to continue.' });
          else update({ error: 'Account setup requires an unsupported step. Contact the team.' });
        } else if (mode === 'confirmSignup') {
          const result = await sdk.confirmSignUp({ username: email, confirmationCode: input.code.trim() });
          if (!active()) return;
          if (result.nextStep.signUpStep === 'DONE') update({ mode: 'login', message: 'Email confirmed. Log in to continue.' });
          else if (result.nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') await completeSignupSignIn();
          else update({ error: 'Confirmation requires an unsupported step. Return to log in or contact the team.' });
        } else if (mode === 'requestReset') {
          const result = await sdk.resetPassword({ username: email });
          if (!active()) return;
          if (result.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') update({ mode: 'confirmReset', message: 'Check your email for a reset code.' });
          else if (result.nextStep.resetPasswordStep === 'DONE') update({ mode: 'login', message: 'Password reset finished. Log in to continue.' });
          else update({ error: 'Password recovery requires an unsupported step. Contact the team.' });
        } else {
          await sdk.confirmResetPassword({ username: email, confirmationCode: input.code.trim(), newPassword: input.password });
          if (active()) update({ mode: 'login', message: 'Password reset. Log in with your new password.' });
        }
      } catch (error) {
        if (attempt !== null) { await session.settleSignIn(attempt, false); activeAttempt = null; }
        if (!active()) return;
        const name = error instanceof Error ? error.name : '';
        if (mode === 'login' && name === 'UserNotConfirmedException') update({ mode: 'confirmSignup', message: 'Confirm your email to continue.' });
        else if (mode === 'login' && name === 'PasswordResetRequiredException') update({ mode: 'requestReset', message: 'Reset your password to continue.' });
        else update({ error: errorText(error) });
      } finally {
        if (active()) update({ pending: false });
      }
    },
  };
}
