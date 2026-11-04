import http from 'node:http'
import { readFile } from 'node:fs/promises'

const files = new Map([
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
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(await readFile(file))
  })
  .listen(4178, '127.0.0.1')
