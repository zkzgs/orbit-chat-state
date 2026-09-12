const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

http.createServer((request, response) => {
  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.join(root, requested);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(data);
  });
}).listen(4173, '127.0.0.1', () => {
  console.log('Orbit Chat running at http://localhost:4173');
});
