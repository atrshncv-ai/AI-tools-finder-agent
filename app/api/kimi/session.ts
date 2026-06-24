import * as jose from "jose";
import { env } from "../lib/env";
import { findUserByUnionId } from "../queries/users";
import type { SessionPayload } from "./types";

const JWT_ALG = "HS256";
const JWT_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || "24", 10);

export async function signSessionToken(
  payload: SessionPayload & { tokenVersion?: number },
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
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
