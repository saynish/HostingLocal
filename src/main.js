const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore } = require('./store');
const { createProcesses } = require('./processes');
const { resolveFile, listFiles, MAX_UPLOAD } = require('./files');

function createApp({ dataRoot = path.join(__dirname, '..', 'data') } = {}) {
  const store = createStore(dataRoot);
  const processes = createProcesses(dataRoot);
  const publicRoot = path.join(__dirname, '..', 'public');
  function respond(res, status, body, headers = {}) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(json);
  }
  function fail(res, err) { respond(res, err.status || 400, { error: err.message || 'Ошибка запроса' }); }
  function bad(message, status = 400) { const err = new Error(message); err.status = status; throw err; }
  function body(req, max = 65536) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = []; let exceeded = false;
      req.on('data', chunk => { size += chunk.length; if (size > max) { if (!exceeded) reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); exceeded = true; } else chunks.push(chunk); });
      req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); }); req.on('error', reject);
    });
  }
  async function json(req) { const raw = await body(req); try { const value = JSON.parse(raw.toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { bad('Некорректный JSON'); } }
  function authorize(req) {
    // Режим без пароля рассчитан на доверенного владельца этого компьютера.
    // Loopback и same-origin снижают риск удалённого и межсайтового доступа,
    // но не защищают от других локальных программ и пользователей Windows.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) bad('Панель доступна только локально', 403);
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host) && !/^localhost(?::\d+)?$/i.test(host)) bad('Неверный адрес панели', 403);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin !== `http://${host}`) bad('Неверный источник запроса', 403);
      // Запуск, остановка и удаление не отправляют тело; у таких запросов нет Content-Type.
      // Для запросов с данными по-прежнему принимаем только JSON или загрузку файла.
      const type = req.headers['content-type'];
      if (type && type !== 'application/json' && type !== 'application/octet-stream') bad('Неверный тип запроса', 415);
    }
  }
  function serverFor(id) { const item = store.get(id); if (!item) bad('Сервер не найден', 404); return item; }
  function fileRoot(id) { return processes.dirs(serverFor(id).id); }
  function cleanServer(input, old = {}) {
    const name = String(input.name ?? old.name ?? '').trim();
    const kind = input.kind ?? old.kind;
    const entry = String(input.entry ?? old.entry ?? (kind === 'minecraft' ? 'server.jar' : 'index.js')).trim();
    const memory = Number(input.memory ?? old.memory ?? 1024);
    if (!name || name.length > 60 || /[\x00-\x1f]/.test(name)) bad('Имя должно содержать от 1 до 60 символов');
    if (!['minecraft', 'telegram'].includes(kind)) bad('Неизвестный тип сервера');
    if (kind === 'minecraft' ? !entry.endsWith('.jar') : !/\.(js|py)$/.test(entry)) bad('Файл запуска должен иметь расширение .jar, .js или .py согласно типу');
    resolveFile(path.join(dataRoot, 'servers', old.id || 'validation'), entry);
    if (!Number.isInteger(memory) || memory < 256 || memory > 16384) bad('Память: от 256 до 16384 МБ');
    return { name, kind, entry, memory, eula: input.eula === undefined ? (old.eula || 0) : (input.eula === true ? 1 : 0), port: old.port ?? 25565, bind: old.bind ?? '0.0.0.0' };
  }
  async function api(req, res, url) {
    const route = url.pathname;
    // Осознанный режим без входа: доступ к процессам имеет любой пользователь этого ПК.
    // Сервер слушает только 127.0.0.1; authorize проверяет фактический адрес
    // соединения, Origin и тип изменяющего запроса. В интернет панель не выводить.
    authorize(req);
    if (route === '/api/servers' && req.method === 'GET') return respond(res, 200, store.list().map(s => ({ ...s, ...processes.state(s.id), log: undefined })));
    if (route === '/api/servers' && req.method === 'POST') {
      const spec = cleanServer(await json(req)); const id = crypto.randomUUID();
      store.create({ id, ...spec, created_at: new Date().toISOString() });
      fs.mkdirSync(processes.dirs(id), { recursive: true });
      return respond(res, 201, { ...store.get(id), ...processes.state(id) });
    }
    const match = /^\/api\/servers\/([a-f0-9-]{36})(?:\/(files|file|start|stop|console|state))?$/.exec(route);
    if (!match) bad('Маршрут не найден', 404);
    const [, id, action] = match; const server = serverFor(id);
    if (!action && req.method === 'GET') return respond(res, 200, { ...server, ...processes.state(id) });
    if (!action && req.method === 'PATCH') {
      if (processes.state(id).status === 'running') bad('Остановите сервер перед изменением настроек');
      const updated = cleanServer(await json(req), server); if (updated.kind !== server.kind) bad('Тип сервера нельзя изменить');
      store.update({ id, ...updated }); return respond(res, 200, store.get(id));
    }
    if (!action && req.method === 'DELETE') {
      if (processes.state(id).status === 'running') bad('Остановите сервер перед удалением');
      store.remove(id); fs.rmSync(processes.dirs(id), { recursive: true, force: true }); return respond(res, 200, { ok: true });
    }
    if (action === 'state' && req.method === 'GET') return respond(res, 200, processes.state(id));
    if (action === 'files' && req.method === 'GET') return respond(res, 200, listFiles(fileRoot(id)));
    if (action === 'file') {
      const relative = url.searchParams.get('path'); const target = resolveFile(fileRoot(id), relative);
      if (req.method === 'PUT') {
        if (processes.state(id).status === 'running') bad('Остановите сервер перед загрузкой файлов');
        const content = await body(req, MAX_UPLOAD);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { flag: 'w' });
        return respond(res, 201, { ok: true, path: relative, size: content.length });
      }
      if (req.method === 'DELETE') {
        if (processes.state(id).status === 'running') bad('Остановите сервер перед удалением файлов');
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) bad('Файл не найден', 404);
        fs.unlinkSync(target); return respond(res, 200, { ok: true });
      }
      if (req.method === 'GET') {
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) bad('Файл не найден', 404);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`, 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(target).pipe(res);
      }
    }
    if (action === 'start' && req.method === 'POST') return respond(res, 200, processes.start(server));
    if (action === 'stop' && req.method === 'POST') { processes.stop(id); return respond(res, 200, { ok: true }); }
    if (action === 'console' && req.method === 'POST') {
      const input = await json(req); if (typeof input.line !== 'string' || !input.line.trim() || input.line.length > 1000 || input.line.includes('\n') || input.line.includes('\r')) bad('Введите одну строку команды');
      processes.input(id, input.line); return respond(res, 200, { ok: true });
    }
    bad('Маршрут не найден', 404);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') bad('Метод не поддерживается', 405);
      authorize(req);
      const asset = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }[url.pathname];
      if (!asset) bad('Страница не найдена', 404);
      const mime = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
      fs.createReadStream(path.join(publicRoot, asset)).pipe(res);
    } catch (err) { if (!res.headersSent) fail(res, err); else res.destroy(); }
  });
  return { server, store, processes, close: () => { processes.shutdown(); server.close(); store.db.close(); } };
}
if (require.main === module) {
  const app = createApp();
  app.server.listen(0, '127.0.0.1', () => console.log(`Панель открыта: http://127.0.0.1:${app.server.address().port}`));
  process.on('SIGINT', () => { app.close(); process.exit(0); });
  process.on('SIGTERM', () => { app.close(); process.exit(0); });
}
module.exports = { createApp };
