const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createStore(root) {
  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, 'panel.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      entry TEXT NOT NULL, memory INTEGER NOT NULL DEFAULT 1024,
      eula INTEGER NOT NULL DEFAULT 0, port INTEGER NOT NULL DEFAULT 25565,
      bind TEXT NOT NULL DEFAULT '0.0.0.0', created_at TEXT NOT NULL
    );`);
  for (const sql of [
    "ALTER TABLE servers ADD COLUMN port INTEGER NOT NULL DEFAULT 25565",
    "ALTER TABLE servers ADD COLUMN bind TEXT NOT NULL DEFAULT '0.0.0.0'"
  ]) {
    try { db.exec(sql); } catch (err) {
      if (!String(err.message).toLowerCase().includes('duplicate column')) throw err;
    }
  }
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
  const setSetting = (key, value) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  const list = () => db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all();
  const get = id => db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  const create = server => db.prepare('INSERT INTO servers (id,name,kind,entry,memory,eula,port,bind,created_at) VALUES (@id,@name,@kind,@entry,@memory,@eula,@port,@bind,@created_at)').run(server);
  const update = server => db.prepare('UPDATE servers SET name=@name, entry=@entry, memory=@memory, eula=@eula, port=@port, bind=@bind WHERE id=@id').run(server);
  const remove = id => db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  return { db, getSetting, setSetting, list, get, create, update, remove };
}
module.exports = { createStore };
