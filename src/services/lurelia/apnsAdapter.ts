// src/services/lurelia/apnsAdapter.ts
//
// APNs (Apple Push Notification service) delivery for shared-event
// notifications. Uses HTTP/2 (node:http2) + an ES256-signed JWT provider
// token (jose is already in deps). No new npm packages required.
//
// Required env vars (server-side only):
//   APNS_TEAM_ID       Your Apple Developer team ID (10 chars).
//   APNS_KEY_ID        The 10-char Key ID of the APNs auth key.
//   APNS_BUNDLE_ID     The iOS app's bundle identifier.
//   APNS_AUTH_KEY_P8   Base64-encoded contents of the .p8 auth key file.
//   APNS_USE_SANDBOX   Optional. Set to "true" to use the sandbox
//                      endpoint (development builds); defaults to
//                      production.
//
// Auth JWT is cached and rotated hourly per Apple's guidance (max 60 min).

import http2 from "node:http2";
import { importPKCS8, SignJWT, type KeyLike } from "jose";
import type { NotificationKind } from "./notificationService";

const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const TOKEN_TTL_MS = 55 * 60 * 1000; // rotate at 55 min to stay under Apple's 60-min cap

type CachedToken = { jwt: string; expiresAt: number };
let cachedToken: CachedToken | null = null;
let cachedKey: KeyLike | Uint8Array | null = null;
let cachedClient: http2.ClientHttp2Session | null = null;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`APNS_MISSING_ENV:${name}`);
  }
  return v.trim();
}

function isConfigured(): boolean {
  return (
    !!process.env.APNS_TEAM_ID &&
    !!process.env.APNS_KEY_ID &&
    !!process.env.APNS_BUNDLE_ID &&
    !!process.env.APNS_AUTH_KEY_P8
  );
}

function apnsHost(): string {
  return String(process.env.APNS_USE_SANDBOX || "").toLowerCase() === "true"
    ? APNS_SANDBOX_HOST
    : APNS_PRODUCTION_HOST;
}

async function loadPrivateKey(): Promise<KeyLike | Uint8Array> {
  if (cachedKey) return cachedKey;
  const b64 = readEnv("APNS_AUTH_KEY_P8");
  const pem = Buffer.from(b64, "base64").toString("utf8");
  cachedKey = await importPKCS8(pem, "ES256");
  return cachedKey;
}

async function providerToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.jwt;

  const teamId = readEnv("APNS_TEAM_ID");
  const keyId = readEnv("APNS_KEY_ID");
  const key = await loadPrivateKey();

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuedAt()
    .setIssuer(teamId)
    .sign(key);

  // Diagnostic: log the JWT's decoded header + claims plus the env
  // values so we can visually confirm what Apple is receiving. Safe to
  // log — the JWT is signed but the header + claims are already visible
  // to anyone with the token, and the signature isn't logged.
  const [headerB64, payloadB64] = jwt.split(".");
  const decodedHeader = JSON.parse(Buffer.from(headerB64, "base64url").toString());
  const decodedPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  console.log("[apns] JWT header:", decodedHeader);
  console.log("[apns] JWT payload:", decodedPayload);
  console.log("[apns] env: bundleId=" + process.env.APNS_BUNDLE_ID);
  console.log("[apns] host=" + apnsHost());

  cachedToken = { jwt, expiresAt: now + TOKEN_TTL_MS };
  return jwt;
}

/** Force the next call to re-sign a fresh JWT. Call after changing env vars. */
export function resetTokenCache() {
  cachedToken = null;
  cachedKey = null;
}

function getClient(): http2.ClientHttp2Session {
  if (cachedClient && !cachedClient.destroyed && !cachedClient.closed) {
    return cachedClient;
  }
  cachedClient = http2.connect(apnsHost());
  cachedClient.on("error", (err) => {
    console.error("[apns] client error:", err);
    cachedClient = null;
  });
  cachedClient.on("close", () => {
    cachedClient = null;
  });
  return cachedClient;
}

export type APNsAlert = { title: string; body: string };

/**
 * Send one push. Returns { status: number, reason?: string }. Callers
 * should log rather than throw — a bad device token shouldn't fail the
 * whole fan-out.
 */
export async function sendAPNs(
  deviceToken: string,
  alert: APNsAlert,
  extras: { kind: NotificationKind; payload: Record<string, unknown> },
): Promise<{ status: number; reason?: string | undefined }> {
  if (!isConfigured()) {
    console.warn("[apns] not configured — skipping send");
    return { status: 0, reason: "NOT_CONFIGURED" };
  }
  if (!deviceToken || deviceToken.length < 8) {
    return { status: 0, reason: "BAD_TOKEN" };
  }

  const bundleId = readEnv("APNS_BUNDLE_ID");
  const jwt = await providerToken();
  const client = getClient();

  const body = Buffer.from(
    JSON.stringify({
      aps: {
        alert: { title: alert.title, body: alert.body },
        sound: "default",
        "mutable-content": 1,
      },
      lurelia: {
        kind: extras.kind,
        ...extras.payload,
      },
    }),
  );

  return await new Promise<{ status: number; reason?: string | undefined }>((resolve) => {
    let status = 0;
    let reason: string | undefined;

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "content-length": String(body.length),
    });

    req.setEncoding("utf8");

    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });

    let responseData = "";
    req.on("data", (chunk) => {
      responseData += chunk;
    });

    req.on("end", () => {
      if (status >= 400 && responseData) {
        try {
          const parsed = JSON.parse(responseData);
          reason = parsed?.reason;
        } catch {
          reason = responseData.slice(0, 200);
        }
      }
      req.close();
      resolve({ status, reason });
    });

    req.on("error", (err) => {
      resolve({ status: 0, reason: String(err) });
    });

    req.end(body);
  });
}

/** Human-readable alert copy per notification kind. */
export function alertForKind(
  kind: NotificationKind,
  payload: Record<string, unknown>,
): APNsAlert {
  const eventTitle = (payload.eventTitle as string) || "Your event";
  const actorName = (payload.actorName as string) || "Someone";
  switch (kind) {
    case "invitation":
      return { title: eventTitle, body: `${actorName} invited you.` };
    case "join":
      return { title: eventTitle, body: `${actorName} joined.` };
    case "hostPost":
      return { title: eventTitle, body: `New post from ${actorName}.` };
    case "comment":
      return { title: eventTitle, body: `${actorName} commented.` };
    case "reply":
      return { title: eventTitle, body: `${actorName} replied.` };
    case "announcement":
      return { title: eventTitle, body: `Announcement from ${actorName}.` };
    case "edit":
      return { title: eventTitle, body: `${actorName} edited a post.` };
    case "cancellation":
      return { title: eventTitle, body: "The event was cancelled." };
    case "timeChanged":
      return { title: eventTitle, body: "The time changed." };
    case "locationChanged":
      return { title: eventTitle, body: "The location changed." };
    case "rsvpChanged":
      return { title: eventTitle, body: `${actorName} updated their RSVP.` };
    case "ownershipTransferred":
      return { title: eventTitle, body: "Ownership was transferred." };
  }
}
