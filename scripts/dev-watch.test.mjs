import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, createReadStream, createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('real development config watches sources without locking local backup staging', {timeout: 15000}, async () => {
  const previousHmr = process.env.DISABLE_HMR;
  process.env.DISABLE_HMR = 'false';
  const isolated = await fs.mkdtemp(join(tmpdir(), 'massajoy-dev-watch-'));
  let server;
  try {
    const source = join(isolated, 'src');
    const sourceFile = join(source, 'ordinary.ts');
    const backups = join(isolated, '.local', 'backups');
    const partial = join(backups, 'synthetic.bundle.partial');
    const published = join(backups, 'synthetic.bundle');
    await fs.mkdir(source, {recursive: true});
    await fs.mkdir(join(partial, 'media'), {recursive: true});
    await fs.writeFile(sourceFile, 'export const synthetic = 1;\n');
    server = await createServer({
      root: isolated,
      configFile: join(root, 'vite.config.ts'),
      configLoader: 'runner',
      logLevel: 'silent',
      server: {middlewareMode: true, hmr: false},
      optimizeDeps: {noDiscovery: true, include: []},
    });
    assert.equal(resolve(server.config.configFile), join(root, 'vite.config.ts'));
    assert.equal(server.httpServer, null, 'the regression server must not listen');
    // Chokidar may emit ready before createServer resolves. Observe the actual
    // source registration instead of waiting for a possibly past event.
    const deadline = Date.now() + 5000;
    while (!Object.keys(server.watcher.getWatched()).some(path => resolve(path) === source) && Date.now() < deadline) await delay(20);
    assert.ok(Object.keys(server.watcher.getWatched()).some(path => resolve(path) === source), 'ordinary src must still be watched');
    let sourceChange;
    let timer;
    const changed = new Promise((done, reject) => {
      sourceChange = path => { if (resolve(path) === sourceFile) done(); };
      server.watcher.on('change', sourceChange);
      timer = setTimeout(() => reject(Error('SOURCE_WATCH_EVENT_MISSING')), 5000);
    });
    try {
      await fs.writeFile(sourceFile, 'export const synthetic = 2;\n');
      await changed;
    } finally {
      clearTimeout(timer);
      server.watcher.off('change', sourceChange);
    }
    const dump = join(partial, 'database.sql.gz');
    await pipeline(Readable.from([randomBytes(2 * 1024 * 1024)]), createGzip(), createWriteStream(dump, {flags: 'wx', mode: 0o600}));
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(dump)) digest.update(chunk);
    await fs.writeFile(join(partial, 'manifest.json'), JSON.stringify({synthetic: true, digest: digest.digest('hex')}), {flag: 'wx', mode: 0o600});
    const watched = Object.keys(server.watcher.getWatched()).map(path => resolve(path));
    const local = join(isolated, '.local');
    assert.equal(watched.some(path => path === local || path.startsWith(local + '\\') || path.startsWith(local + '/')), false, 'local backup directories must not have development watcher handles');
    await fs.rename(partial, published); // Exactly one atomic publication attempt.
    assert.equal((await fs.stat(join(published, 'database.sql.gz'))).isFile(), true);
    assert.equal(await fs.stat(partial).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false);
  } finally {
    if (server) await server.close();
    if (previousHmr === undefined) delete process.env.DISABLE_HMR; else process.env.DISABLE_HMR = previousHmr;
    // isolated is the exact path returned by mkdtemp for this test only.
    assert.equal(dirname(isolated), tmpdir());
    await fs.rm(isolated, {recursive: true, force: true});
  }
});

test('DISABLE_HMR keeps the real development watcher disabled', {timeout: 15000}, async () => {
  const previousHmr = process.env.DISABLE_HMR;
  process.env.DISABLE_HMR = 'true';
  const isolated = await fs.mkdtemp(join(tmpdir(), 'massajoy-dev-watch-off-'));
  let server;
  try {
    const source = join(isolated, 'src');
    await fs.mkdir(source);
    await fs.writeFile(join(source, 'ordinary.ts'), 'export const synthetic = true;\n');
    server = await createServer({
      root: isolated,
      configFile: join(root, 'vite.config.ts'),
      configLoader: 'runner',
      logLevel: 'silent',
      server: {middlewareMode: true, hmr: false},
      optimizeDeps: {noDiscovery: true, include: []},
    });
    assert.equal(server.httpServer, null);
    assert.equal(server.config.server.watch, null);
    server.watcher.add(source);
    assert.deepEqual(server.watcher.getWatched(), {});
  } finally {
    if (server) await server.close();
    if (previousHmr === undefined) delete process.env.DISABLE_HMR; else process.env.DISABLE_HMR = previousHmr;
    assert.equal(dirname(isolated), tmpdir());
    await fs.rm(isolated, {recursive: true, force: true});
  }
});
