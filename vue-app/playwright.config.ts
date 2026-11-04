import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

const browserTemp = path.resolve('.cache/browser')
mkdirSync(browserTemp, { recursive: true })
process.env.TEMP = browserTemp
process.env.TMP = browserTemp
process.env.TMPDIR = browserTemp

const browser =
  process.env.ORBIT_TEST_BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync)

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: browser, downloadsPath: browserTemp },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:4178/vue-app/dist/index.html',
  },
})
