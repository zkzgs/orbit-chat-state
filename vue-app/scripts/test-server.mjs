import http from 'node:http'
import { readFile } from 'node:fs/promises'

const files = new Map([
  ['/vue-app/src/api/native-media.js', new URL('../src/api/native-media.js', import.meta.url)],
  ['/vue-app/src/api/image-agent.js', new URL('../src/api/image-agent.js', import.meta.url)],
  ['/index.html', new URL('../../index.html', import.meta.url)],
  ['/vue-app/dist/index.html', new URL('../dist/index.html', import.meta.url)],
])

http
  .createServer(async (request, response) => {
    const file = files.get(request.url)
    if (!file) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': request.url.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' })
    response.end(await readFile(file))
  })
  .listen(4178, '127.0.0.1')
