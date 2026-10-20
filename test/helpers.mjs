import { createServer } from "node:http";

/** A stand-in for api.openverse.org used by the tests. */
export function startMockOpenverse() {
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    calls.push(url);
    if (url.pathname.endsWith("/audio/")) {
      const q = url.searchParams.get("q");
      if (q === "busy") { res.writeHead(429); res.end("{}"); return; }
      const results = q === "nothing" ? [] : [
        { id: "a1", title: "Night Rain", creator: "Field Recorder", license: "cc0", license_version: "1.0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/", url: "https://cdn.example/rain.mp3", foreign_landing_url: "https://freesound.example/rain", duration: 93000, source: "freesound", filetype: "mp3", attribution: null },
        { id: "a2", title: "Dark Hall", creator: "Composer X", license: "by", license_version: "4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", url: "https://cdn.example/hall.mp3", foreign_landing_url: "https://jamendo.example/hall", duration: 154000, source: "jamendo", filetype: "mp3", attribution: '"Dark Hall" by Composer X is licensed under CC BY 4.0.' },
        { id: "a3", title: "Not Allowed", creator: "NC Person", license: "by-nc", license_version: "4.0", url: "https://cdn.example/nc.mp3", duration: 60000 },
      ];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result_count: results.length, page_count: 1, page: 1, results }));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}/v1` })));
}

export async function rpc(base, path, body, headers = {}) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}
