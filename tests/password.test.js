const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createApp } = require('../src/main');

test('панель без пароля: создание сервера и защита от чужого сайта', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodecraft-local-'));
  const app = createApp({ dataRoot: root });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    app.processes.shutdown();
    await new Promise(resolve => app.server.close(resolve));
    app.store.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, options) => fetch(url + route, options);
  assert.equal((await request('/')).status, 200);
  assert.deepEqual(await (await request('/api/servers')).json(), []);
  const payload = JSON.stringify({ name: 'Мой мир', kind: 'minecraft', entry: 'server.jar', memory: 1024 });
  const headers = { Origin: url, 'Content-Type': 'application/json' };
  assert.equal((await request('/api/servers', { method: 'POST', headers: { ...headers, Origin: 'http://elsewhere.test' }, body: payload })).status, 403);
  assert.equal((await request('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })).status, 403);
  const response = await request('/api/servers', { method: 'POST', headers, body: payload });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.name, 'Мой мир');
  assert.equal((await request(`/api/servers/${created.id}`)).status, 200);
  assert.equal((await request('/api/servers')).status, 200);
  assert.equal((await request('/api/login', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal(fs.existsSync(path.join(root, 'panel.sqlite')), true);
  // Запросы без тела не содержат Content-Type, но требуют корректного Origin.
  const base = `/api/servers/${created.id}`;
  const noBody = { Origin: url };
  assert.equal((await request(`${base}/start`, { method: 'POST', headers: noBody })).status, 400);
  assert.equal((await request(`${base}/start`, { method: 'POST', headers: { Origin: 'http://elsewhere.test' } })).status, 403);
  const relative = 'test-file.txt';
  const file = `${base}/file?path=${relative}`;
  assert.equal((await request(file, { method: 'PUT', headers: { Origin: url, 'Content-Type': 'application/octet-stream' }, body: 'hello' })).status, 201);
  assert.equal((await request(file, { method: 'DELETE', headers: noBody })).status, 200);
  assert.equal((await request(file)).status, 404);
  assert.equal((await request(file, { method: 'PUT', headers: { Origin: url, 'Content-Type': 'text/plain' }, body: 'invalid' })).status, 415);
});
