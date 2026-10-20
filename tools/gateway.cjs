// Local stand-in for Supabase's API gateway, for development and rehearsal tests only.
// Like Supabase: /auth/v1 -> Auth, /rest/v1 -> PostgREST, an apikey header is required, and a request without
// Authorization is sent with the apikey as its bearer token. Everything else is served from dist/.
// usage: node tools/gateway.cjs <port> <authPort> <restPort> <distDir> <anonKey> <serviceKey>
const http = require("http"), fs = require("fs"), path = require("path");
const [port, authPort, restPort, dist, anonKey, serviceKey] = process.argv.slice(2);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, prefer, accept-profile, content-profile, x-client-info, range", "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" };

function headersFile() {
  // Reads dist/_headers (the same file the static host uses) so local runs get the same security headers.
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) {
      const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/); if (m) out[m[1].toLowerCase()] = m[2].trim();
    }
  } catch (e) { }
  return out;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const api = url.pathname.startsWith("/auth/v1/") ? [authPort, "/auth/v1"] : url.pathname.startsWith("/rest/v1/") ? [restPort, "/rest/v1"] : null;
  if (api) {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const key = req.headers.apikey;
    if (key !== anonKey && key !== serviceKey) { res.writeHead(401, { "content-type": "application/json", ...CORS }); return res.end('{"message":"Invalid API key"}'); }
    const headers = { ...req.headers, host: "127.0.0.1:" + api[0] };
    if (!headers.authorization) headers.authorization = "Bearer " + key;
    const up = http.request({ host: "127.0.0.1", port: api[0], method: req.method, path: url.pathname.slice(api[1].length) + url.search, headers }, r => {
      res.writeHead(r.statusCode, { ...r.headers, ...CORS }); r.pipe(res);
    });
    up.on("error", e => { res.writeHead(502); res.end(String(e)); });
    return req.pipe(up);
  }
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(path.normalize(dist))) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || path.basename(file).startsWith("_")) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", ...headersFile() });
  fs.createReadStream(file).pipe(res);
}).listen(+port, "127.0.0.1");
