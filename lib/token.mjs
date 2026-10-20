// Signed, self-describing render URLs. Nothing is stored: the URL carries its own
// parameters, and an HMAC (keyed from MCP_SECRET) proves that our MCP server made it.

import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url");

function renderKey(secret) {
  return createHmac("sha256", String(secret)).update("tellwave-render-v1").digest();
}

function sign(secret, payload) {
  return b64url(createHmac("sha256", renderKey(secret)).update("v1." + payload).digest()).slice(0, 22);
}

/** Returns { p, s } query parameters for the job. */
export function signJob(secret, job) {
  if (!secret) throw new Error("MCP_SECRET is not set");
  const p = b64url(deflateRawSync(Buffer.from(JSON.stringify(job), "utf8"), { level: 9 }));
  return { p, s: sign(secret, p) };
}

/** Verifies and decodes a job. Returns the job object or null. */
export function verifyJob(secret, p, s) {
  if (!secret || typeof p !== "string" || typeof s !== "string" || p.length > 12000 || s.length !== 22) return null;
  const expected = Buffer.from(sign(secret, p));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(inflateRawSync(fromB64url(p)).toString("utf8"));
  } catch {
    return null;
  }
}

/** Constant-time string comparison for the MCP path secret. */
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
