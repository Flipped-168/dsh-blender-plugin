#!/usr/bin/env node
/** Isolated /host CORS regression; no addon, Blender, running backend, or new dependencies.
 * Executes the actual helpers and handleHost extracted from server.mjs in a VM, using a
 * fixture store on an ephemeral HTTP port. This does not test full backend startup.
 * Run: node tests/host_cors_selftest.mjs [--server /path/to/server.mjs]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--server');
const source = fs.readFileSync(arg < 0 ? path.join(ROOT, 'runtime/server.mjs') : process.argv[arg + 1], 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'server source layout changed: ' + start);
  return source.slice(a, b);
}
const png = Buffer.from('89504e470d0a1a0a', 'hex'); // Header-only fixture; not a Blender render.
let storeReads = 0;
const sandbox = vm.createContext({
  viewStore: {
    latest() { storeReads++; return { seq: 0, source: 'none' }; },
    pngFor(seq) { return seq === '1' ? { status: 200, png } : { status: 404, body: { ok: false, error: 'no_frame' } }; }
  },
  engine: { hostReady: () => ({ ok: true, ready: false }) }
});
vm.runInContext(section('const HOST_ORIGIN_RE = ', 'function hostErrText(')
  + section('async function handleHost(', '\nconst server = http.createServer(')
  + '\nglobalThis.handler = handleHost;', sandbox, { timeout: 2000 });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  sandbox.handler(req, res, url, url.pathname).catch((error) => {
    res.writeHead(500); res.end(String(error));
  });
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(method, route, origin) {
    const headers = origin === undefined ? {} : { Origin: origin };
    if (method === 'OPTIONS') {
      headers['Access-Control-Request-Method'] = 'POST';
      headers['Access-Control-Request-Headers'] = 'content-type';
    }
    const response = await fetch(base + route, { method, headers, signal: AbortSignal.timeout(3000) });
    return { response, body: Buffer.from(await response.arrayBuffer()) };
  }
  const allowed = ['dsh-app://app', 'http://127.0.0.1', 'http://127.0.0.1:3080', 'http://localhost', 'http://localhost:19387'];
  const denied = ['https://evil.example', 'http://evil.example', 'https://127.0.0.1', 'http://127.0.0.1.evil.example',
    'http://localhost.evil.example', 'http://127.0.0.1:3080@evil.example', 'null',
    'dsh-app://app.evil.example', 'dsh-app://evil', 'dsh-app://app/', 'dsh-app://app:19387',
    'dsh-app://app@evil.example', 'dsh-app://app?query', 'dsh-app://app#fragment', 'dsh-app://app.evil/app'];
  for (const origin of allowed) {
    for (const method of ['OPTIONS', 'GET']) {
      await test(`${method} exact allow ${origin}`, async () => {
        const before = storeReads;
        const { response: r, body } = await request(method, '/host/view/latest', origin);
        assert.equal(r.status, method === 'OPTIONS' ? 204 : 200);
        assert.equal(r.headers.get('access-control-allow-origin'), origin);
        assert.notEqual(r.headers.get('access-control-allow-origin'), '*');
        assert.equal(r.headers.get('access-control-allow-credentials'), null);
        assert.ok(r.headers.get('vary').split(',').some((value) => value.trim().toLowerCase() === 'origin'));
        if (method === 'OPTIONS') {
          assert.equal(body.length, 0); assert.equal(storeReads, before);
          assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
          assert.equal(r.headers.get('access-control-allow-headers'), 'content-type');
          assert.equal(r.headers.get('access-control-max-age'), '600');
        }
      });
    }
  }
  for (const origin of [...denied, undefined]) {
    for (const method of ['OPTIONS', 'GET']) {
      await test(`${method} no ACAO for ${origin ?? '(no Origin)'}`, async () => {
        const { response: r, body } = await request(method, '/host/view/latest', origin);
        // Existing policy is no ACAO, not an HTTP 403 guard or authentication.
        assert.equal(r.status, method === 'OPTIONS' ? 204 : 200);
        assert.equal(r.headers.get('access-control-allow-origin'), null);
        if (method === 'OPTIONS') assert.equal(body.length, 0);
      });
    }
  }
  for (const [route, status] of [['/host/not-a-route', 404], ['/host/view.png?seq=0', 404], ['/host/view.png?seq=1', 200], ['/host/ready', 200]]) {
    await test('desktop CORS survives response ' + route, async () => {
      const { response: r } = await request('GET', route, 'dsh-app://app');
      assert.equal(r.status, status); assert.equal(r.headers.get('access-control-allow-origin'), 'dsh-app://app');
      assert.equal(r.headers.get('vary'), 'Origin');
    });
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Isolated host CORS regression: ${passed} passed / ${failed} failed`);
process.exitCode = failed ? 1 : 0;
