import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve("dist");
const types = { ".html": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  const path = resolve(root, "." + decodeURIComponent(
    new URL(request.url, "http://localhost").pathname === "/"
      ? "/index.html" : new URL(request.url, "http://localhost").pathname));
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] ??
      "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.listen(4173, "127.0.0.1", () =>
  process.stdout.write("Crypto Savings is open at http://127.0.0.1:4173\n"));
