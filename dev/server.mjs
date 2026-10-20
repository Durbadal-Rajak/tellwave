// Local stand-in for Vercel: static files from public/, the same rewrites and headers
// as vercel.json, and api/index.mjs called with a Web Request.
// Run: npm run dev   (PORT=3000; set MCP_SECRET to try the Claude connection)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const pub = join(root, "public");
const api = (await import(join(root, "api/index.mjs"))).default;
const config = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

function rewrite(pathname) {
  for (const r of config.rewrites) {
    const names = [];
    const re = new RegExp("^" + r.source.replace(/:(\w+)\*/g, (_, n) => { names.push(n); return "(.*)"; }).replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    const m = re.exec(pathname);
    if (m) {
      let dest = r.destination;
      names.forEach((n, i) => { dest = dest.replace(new RegExp(":" + n + "\\*?", "g"), m[i + 1]); });
      return dest;
    }
  }
  return null;
}

function headersFor(pathname) {
  const out = {};
  for (const h of config.headers) {
    const re = new RegExp("^" + h.source.replace(/\(\.\*\)/g, ".*") + "$");
    if (re.test(pathname)) for (const { key, value } of h.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const extra = headersFor(url.pathname);
    try {
      // static first (like Vercel's filesystem check)
      let file = normalize(join(pub, decodeURIComponent(url.pathname)));
      if (file.startsWith(pub)) {
        try {
          let st = await stat(file);
          if (st.isDirectory()) { file = join(file, "index.html"); st = await stat(file); }
          const body = await readFile(file);
          res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "content-length": body.length, ...extra });
          res.end(req.method === "HEAD" ? undefined : body);
          return;
        } catch { /* not a file */ }
      }
      const dest = rewrite(url.pathname);
      if (!dest) { res.writeHead(404, { "content-type": "text/plain", ...extra }); res.end("Not found"); return; }
      const target = new URL(dest, url.origin);
      for (const [k, v] of url.searchParams) if (!target.searchParams.has(k)) target.searchParams.set(k, v);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const request = new Request(target, { method: req.method, headers: req.headers, body });
      const response = await api.fetch(request);
      const hdrs = { ...extra };
      response.headers.forEach((v, k) => { hdrs[k] = v; });
      res.writeHead(response.status, hdrs);
      if (response.body && req.method !== "HEAD") {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("dev server error: " + err.message);
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startServer(Number(process.env.PORT || 3000));
  console.log(`Tellwave dev server on http://127.0.0.1:${server.address().port}`);
}
