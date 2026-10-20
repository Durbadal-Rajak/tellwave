// Optional short links for Claude's voiceovers. A long script makes a long signed URL,
// and long random-looking URLs are easy for a model to copy wrongly. When a Vercel Blob
// store is connected (BLOB_READ_WRITE_TOKEN), the job is saved there and Claude gets a
// short signed link like /r/<store>/<file>/<sig>. Without Blob, nothing changes.

import { createHmac, randomBytes } from "node:crypto";

const memory = new Map(); // test stand-in (TELLWAVE_FAKE_BLOB=1)

export const shortLinksEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN) || process.env.TELLWAVE_FAKE_BLOB === "1";

function publicUrl(store, file) {
  const base = process.env.TELLWAVE_BLOB_PUBLIC_BASE;
  return base ? `${base}/${store}/jobs/${file}` : `https://${store}.public.blob.vercel-storage.com/jobs/${file}`;
}

const sig = (secret, store, file) =>
  createHmac("sha256", String(secret)).update(`tellwave-short-v1/${store}/${file}`).digest("base64url").slice(0, 16);

/** Saves the job and returns the short path ("/r/..."), or null if Blob isn't usable. */
export async function saveShortJob(secret, job) {
  if (!shortLinksEnabled()) return null;
  const id = randomBytes(9).toString("base64url");
  const body = JSON.stringify(job);
  let url;
  if (process.env.TELLWAVE_FAKE_BLOB === "1") {
    memory.set(id + ".json", body);
    url = publicUrl("teststore", id + ".json");
  } else {
    const { put } = await import("@vercel/blob");
    const res = await put(`jobs/${id}.json`, body, { access: "public", contentType: "application/json", addRandomSuffix: false });
    url = res.url;
  }
  const m = /^https?:\/\/([a-z0-9]+)\.public\.blob\.vercel-storage\.com\/jobs\/([A-Za-z0-9_-]+\.json)$/i.exec(url)
    || (process.env.TELLWAVE_BLOB_PUBLIC_BASE && new RegExp(`^${escapeRe(process.env.TELLWAVE_BLOB_PUBLIC_BASE)}/([a-z0-9]+)/jobs/([A-Za-z0-9_-]+\\.json)$`, "i").exec(url));
  if (!m) return null;
  const [, store, file] = m;
  return `/r/${store}/${file}/${sig(secret, store, file)}`;
}

/** Reads a job from a short path. Returns the job or null. */
export async function loadShortJob(secret, path) {
  const m = /^\/r\/([a-z0-9]{3,64})\/([A-Za-z0-9_-]{6,80}\.json)\/([A-Za-z0-9_-]{16})$/i.exec(path);
  if (!m || !secret) return null;
  const [, store, file, given] = m;
  if (sig(secret, store, file) !== given) return null;
  if (process.env.TELLWAVE_FAKE_BLOB === "1" && store === "teststore") {
    const body = memory.get(file);
    return body ? JSON.parse(body) : null;
  }
  const res = await fetch(publicUrl(store, file), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return res.json();
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export const _memoryForTests = memory;
