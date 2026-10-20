// Free-licence audio search through the Openverse API (CC0 / public domain and CC BY only,
// so results are usable in monetised videos; CC BY needs the returned credit line).

const API = process.env.OPENVERSE_API_BASE || "https://api.openverse.org/v1";
const UA = "Tellwave/1.0 (personal video tool)";
let token = null; // { value, expires }

async function getToken() {
  const id = process.env.OPENVERSE_CLIENT_ID, secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(`${API}/auth_tokens/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  token = { value: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.value;
}

const LICENSE_NAMES = { cc0: "CC0", pdm: "Public domain", by: "CC BY" };

function licenseLabel(r) {
  const base = LICENSE_NAMES[String(r.license || "").toLowerCase()] || String(r.license || "").toUpperCase();
  return r.license_version && r.license !== "pdm" ? `${base} ${r.license_version}` : base;
}

function seconds(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / 1000); // Openverse reports milliseconds
}

function credit(r) {
  if (r.attribution) return String(r.attribution).replace(/\s+/g, " ").trim();
  const by = r.creator ? ` by ${r.creator}` : "";
  return `"${r.title || "Untitled"}"${by}, ${licenseLabel(r)}${r.license_url ? ` (${r.license_url})` : ""}`;
}

/**
 * search({ q, kind: "music" | "sfx", license: "cc0" | "any", length, page, pageSize })
 * Returns { results: [...], total, page, pages }.
 */
export async function searchAudio({ q, kind = "music", license = "any", length, page = 1, pageSize = 12 } = {}) {
  const query = String(q ?? "").trim().slice(0, 120);
  if (!query) throw Object.assign(new Error("Type something to search for."), { status: 400 });
  const params = new URLSearchParams({
    q: query,
    license: license === "cc0" ? "cc0,pdm" : "cc0,pdm,by",
    page: String(Math.max(1, Math.min(20, Number(page) || 1))),
    page_size: String(Math.max(1, Math.min(20, Number(pageSize) || 12))),
    mature: "false",
  });
  params.set("category", kind === "sfx" ? "sound_effect" : "music");
  if (["short", "medium", "long"].includes(length)) params.set("length", length);
  const headers = { accept: "application/json", "user-agent": UA };
  const t = await getToken().catch(() => null);
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${API}/audio/?${params}`, { headers, signal: AbortSignal.timeout(12000) });
  if (res.status === 429) throw Object.assign(new Error("The music library is busy. Try again in a minute."), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(`The music library returned an error (${res.status}).`), { status: 502 });
  const j = await res.json();
  const results = (j.results || [])
    .filter((r) => r.url && ["cc0", "pdm", "by"].includes(String(r.license || "").toLowerCase()))
    .map((r) => ({
      id: r.id,
      title: r.title || "Untitled",
      creator: r.creator || null,
      seconds: seconds(r.duration),
      license: licenseLabel(r),
      licenseUrl: r.license_url || null,
      creditNeeded: String(r.license).toLowerCase() === "by",
      audioUrl: r.url,
      pageUrl: r.foreign_landing_url || r.detail_url || null,
      source: r.source || r.provider || null,
      filetype: r.filetype || null,
      credit: credit(r),
    }));
  return { results, total: j.result_count ?? results.length, page: Number(params.get("page")), pages: j.page_count ?? 1 };
}
