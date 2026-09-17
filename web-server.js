'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const host = '0.0.0.0';
const port = Number(process.env.ORBIT_WEB_PORT || process.argv[2] || 5500);
const indexPath = path.join(__dirname, 'index.html');

function sendText(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function getLanAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    addresses
      .filter((address) => address.family === 'IPv4' && !address.internal)
      .map((address) => ({ name, address: address.address }))
  );
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid web server port');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Method Not Allowed');
    return;
  }

  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname !== '/' && pathname !== '/index.html') {
    sendText(response, 404, 'Not Found');
    return;
  }

  fs.readFile(indexPath, (error, content) => {
    if (error) {
      sendText(response, 500, 'Unable to read index.html');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': content.length,
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  });
});

server.listen(port, host, () => {
  console.log(`Orbit Web: http://127.0.0.1:${port}/index.html`);
  getLanAddresses().forEach(({ name, address }) => console.log(`LAN (${name}): http://${address}:${port}/index.html`));
  console.log('Keep this window open while using Orbit. Press Ctrl+C to stop.');
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message);
  process.exit(1);
});
