#!/usr/bin/env node
/**
 * Minimal static server for local preview. No deps.
 * Serves files from the project root on port 8080 by default.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(url.parse(req.url).pathname || "/");
    if (pathname === "/") pathname = "/index.html";

    // Resolve and guard path
    const fullPath = path.normalize(path.join(ROOT, pathname));
    if (!fullPath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Try the path, then with .html appended, then 404.html
    const candidates = [
      fullPath,
      fullPath + ".html",
      path.join(fullPath, "index.html"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const ext = path.extname(candidate).toLowerCase();
        const type = MIME[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }

    // 404 fallback
    const notFound = path.join(ROOT, "404.html");
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  } catch (err) {
    res.writeHead(500);
    res.end("Internal Server Error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`AltAI preview running at http://localhost:${PORT}`);
});
