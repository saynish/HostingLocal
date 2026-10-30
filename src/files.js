const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_UPLOAD = 100 * 1024 * 1024;
const TEMPLATE_ROOT = path.join(__dirname, '..', 'templates');

function resolveFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(s => !s || s === '.' || s === '..' || s.includes(':'))) throw new Error('Недопустимый путь файла');
  const base = path.resolve(root);
  const target = path.resolve(base, ...relative.split('/'));
  if (!target.startsWith(base + path.sep)) throw new Error('Недопустимый путь файла');
  let current = base;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Ссылки на файлы запрещены'); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return target;
}
function listFiles(root) {
  fs.mkdirSync(root, { recursive: true });
  function walk(dir, prefix = '', depth = 0) {
    if (depth >= 6) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
      if (item.isSymbolicLink()) return [];
      const name = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDirectory()) return [{ path: name, type: 'directory' }, ...walk(path.join(dir, item.name), name, depth + 1)];
      return item.isFile() ? [{ path: name, type: 'file', size: fs.statSync(path.join(dir, item.name)).size }] : [];
    });
  }
  return walk(root).slice(0, 2000);
}
function localAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address);
    }
  }
  return result;
}
function templateCatalog() {
  const root = TEMPLATE_ROOT;
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => {
      const dir = path.join(root, item.name);
      const metaPath = path.join(dir, 'template.json');
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try { const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed; } catch { meta = {}; }
      }
      const files = listFiles(dir);
      return {
        id: item.name,
        name: String(meta.name || item.name),
        kind: ['minecraft', 'telegram', 'discord', 'website', 'custom'].includes(meta.kind) ? meta.kind : 'custom',
        description: String(meta.description || ''),
        entry: String(meta.entry || ''),
        port: Number.isInteger(meta.port) ? meta.port : null,
        memory: Number.isInteger(meta.memory) ? meta.memory : null,
        files
      };
    })
    .filter(item => item.files.some(f => f.type === 'file'))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
module.exports = { resolveFile, listFiles, MAX_UPLOAD, TEMPLATE_ROOT, templateCatalog, localAddresses };
