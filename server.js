// Atlas local server — serves the app and reads/writes data/sites.json.
// No dependencies. Run with: node server.js
// Then open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data", "sites.json");

const CONTENT_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".json": "application/json"
};

// Make sure data/sites.json exists so a fresh clone works immediately.
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

const server = http.createServer((req, res) => {

  // --- API: read/write the pins file ---
  if (req.url === "/api/sites" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(fs.readFileSync(DATA_FILE, "utf8"));
    return;
  }

  if (req.url === "/api/sites" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      fs.writeFileSync(DATA_FILE, body);
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // --- Static files ---
  const filePath = req.url === "/" ? "/index.html" : req.url;
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });

});

server.listen(PORT, () => {
  console.log(`Atlas running at http://localhost:${PORT}`);
});
