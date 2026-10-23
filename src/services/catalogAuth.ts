import { createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { CatalogError } from "./automaticCatalogStore";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const issuer = "vox-api:loomey-catalogs";
const audience = "loomey:automatic-catalogs";
function sessionKey(): Uint8Array {
  const key = process.env.BOOKDATABASE_API_KEY;
  if (!key) throw new CatalogError("CATALOG_NOT_CONFIGURED");
  return createHmac("sha256", key).update("vox-api:automatic-catalog-session:v1").digest();
}

export async function exchangeCatalogSession(identityToken: string): Promise<{ token: string; userID: string }> {
  const { payload } = await jwtVerify(identityToken, appleKeys, {
    issuer: "https://appleid.apple.com", audience: process.env.LOOMEY_APPLE_AUDIENCE ?? "im.lystaria.Lumey", algorithms: ["RS256"],
  });
  if (!payload.sub) throw new CatalogError("UNAUTHORIZED", 401);
  const token = await new SignJWT({ scope: audience }).setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer).setAudience(audience).setSubject(payload.sub).setIssuedAt().setExpirationTime("30d").sign(sessionKey());
  return { token, userID: payload.sub };
}

export async function verifyCatalogSession(authorization: string | undefined): Promise<string> {
  if (!authorization?.startsWith("Bearer ")) throw new CatalogError("UNAUTHORIZED", 401);
  try {
    const { payload } = await jwtVerify(authorization.slice(7), sessionKey(), { issuer, audience, algorithms: ["HS256"] });
    if (!payload.sub || payload.scope !== audience) throw new Error("Invalid scope");
    return payload.sub;
  } catch { throw new CatalogError("UNAUTHORIZED", 401); }
}
