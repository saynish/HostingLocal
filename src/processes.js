const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFile } = require('./files');

function createProcesses(dataRoot) {
  const active = new Map();
  const logs = new Map();
  const dirs = id => path.join(dataRoot, 'servers', id);
  function append(id, chunk) {
    const text = (logs.get(id) || '') + chunk.toString('utf8');
    logs.set(id, text.slice(-100000));
  }
  function state(id) {
    const proc = active.get(id);
    return { status: proc ? 'running' : 'stopped', pid: proc?.pid || null, log: logs.get(id) || '' };
  }
  function start(server) {
    if (active.has(server.id)) throw new Error('Сервер уже запущен');
    const dir = dirs(server.id);
    const entry = resolveFile(dir, server.entry);
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error('Сначала загрузите файл запуска: ' + server.entry);
    let command, args;
    if (server.kind === 'minecraft') {
      if (!server.eula) throw new Error('Подтвердите принятие Minecraft EULA в настройках сервера');
      fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
      command = 'java'; args = [`-Xmx${server.memory}M`, '-jar', server.entry, 'nogui'];
    } else {
      command = server.entry.endsWith('.js') ? process.execPath : (process.platform === 'win32' ? 'py' : 'python3');
      args = [server.entry];
    }
    append(server.id, `\n[Панель] Запуск: ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env: { ...process.env, NODE_ENV: 'production' } });
    active.set(server.id, child);
    child.stdout.on('data', data => append(server.id, data));
    child.stderr.on('data', data => append(server.id, data));
    child.on('error', err => append(server.id, `[Панель] Ошибка запуска: ${err.message}\n`));
    child.on('exit', (code, signal) => { if (active.get(server.id) === child) active.delete(server.id); append(server.id, `[Панель] Процесс завершился (${signal || code}).\n`); });
    return state(server.id);
  }
  function input(id, line) {
    const proc = active.get(id);
    if (!proc || !proc.stdin.writable) throw new Error('Сервер не запущен');
    proc.stdin.write(line + '\n');
  }
  function stop(id) {
    const proc = active.get(id);
    if (!proc) throw new Error('Сервер не запущен');
    if (proc.stdin.writable && proc.spawnfile === 'java') proc.stdin.write('stop\n');
    else proc.kill();
    const timer = setTimeout(() => { if (active.get(id) === proc) proc.kill(); }, 4000);
    timer.unref();
    proc.once('exit', () => clearTimeout(timer));
  }
  function shutdown() { for (const proc of active.values()) proc.kill(); }
  return { state, start, stop, input, shutdown, dirs };
}
module.exports = { createProcesses };
