/**
 * session.ts — JWT session tokens for the private login/password service.
 *
 * HS256-signed tokens carried in an httpOnly cookie. The HMAC secret comes
 * from JWT_SECRET (APP_SECRET kept as a legacy fallback so existing envs keep
 * working). Token revocation is per-user via tokenVersion (logout increments
 * it, invalidating all previously issued tokens).
 */

import * as jose from "jose";
import { findUserByUnionId } from "../queries/users";

const JWT_ALG = "HS256";
export const JWT_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || "24", 10);

export interface SessionPayload extends jose.JWTPayload {
  unionId: string;
  clientId: string;
}

function sessionSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || process.env.APP_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET (or APP_SECRET) environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  payload: SessionPayload & { tokenVersion?: number },
): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .sign(sessionSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const { payload } = await jose.jwtVerify(token, sessionSecret(), {
      algorithms: [JWT_ALG],
    });
    const { unionId, clientId, tokenVersion } = payload;
    if (!unionId || !clientId) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    const user = await findUserByUnionId(unionId as string);
    if (!user) {
      console.warn("[session] User not found for token.");
      return null;
    }
    if ((tokenVersion as number | undefined) !== user.tokenVersion) {
      console.warn("[session] Token version mismatch.");
      return null;
    }
    return { unionId, clientId } as SessionPayload;
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
