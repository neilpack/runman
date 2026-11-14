import type { RequestHandler } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { HttpError } from './errorHandler.js';

export interface AccessTokenVerifier { verify(token: string): Promise<{ sub: string }> }

// Fixed trusted configuration only; never select issuer/JWKS from a caller's JWT.
export function createAccessTokenVerifier(userPoolId: string, clientId: string) {
  return CognitoJwtVerifier.create({
    userPoolId, clientId, tokenUse: 'access',
    customJwtCheck: ({ payload }) => {
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw new Error('A numeric expiry is required.');
    },
  });
}

const verifiers = new Map<string, AccessTokenVerifier>();
export function cachedAccessTokenVerifier(userPoolId: string, clientId: string): AccessTokenVerifier {
  const key = `${userPoolId}:${clientId}`;
  let verifier = verifiers.get(key);
  if (!verifier) { verifier = createAccessTokenVerifier(userPoolId, clientId); verifiers.set(key, verifier); }
  return verifier;
}

export function cassetteAuth(verifier: AccessTokenVerifier): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || header.length > 16_384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
      next(new HttpError(401, 'A valid Cognito access token is required.')); return;
    }
    try {
      const payload = await verifier.verify(header.slice(7));
      if (typeof payload.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sub)) throw new Error();
      res.locals.cassetteOwner = payload.sub;
      next();
    } catch {
      // Never log the token, verifier exception, or untrusted claims.
      next(new HttpError(401, 'A valid Cognito access token is required.'));
    }
  };
}
