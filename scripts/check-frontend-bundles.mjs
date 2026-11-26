import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Artifact regression limits, not claims about device loading time or Core Web Vitals.
const budgets = {
  admin: { initialJsBytes: 400_000, initialJsGzipBytes: 130_000, maxChunkBytes: 500_000,
    deferred: ['src/components/StoreManagement.tsx', 'src/components/OperationalPage.tsx', 'src/components/Dashboard.tsx'] },
  merchant: { initialJsBytes: 900_000, initialJsGzipBytes: 310_000, maxChunkBytes: 500_000,
    deferred: ['src/layouts/MerchantLayout.tsx', 'src/pages/bookings/index.tsx', 'src/pages/price-menu/index.tsx', 'src/pages/settings/index.tsx'] },
};
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf('--' + name);
  if (index < 0) return fallback;
  assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), 'Missing --' + name + ' value');
  return args[index + 1];
}
const measureOnly = args.includes('--measure-only');
const report = { measuredAt: new Date().toISOString(),
  scope: 'Build artifact bytes. Initial JS follows only static manifest imports; authenticated routes add their selected lazy chunks. No network, device or LCP/INP/CLS measurement.',
  gzip: 'Sum of each asset compressed independently with Node gzipSync default settings; excludes HTTP headers, HTML, CSS and images.',
  measureOnly, apps: {}, passed: true };
for (const app of ['admin', 'merchant']) {
  const dir = path.resolve(option(app, app === 'admin' ? 'dist' : 'merchant-web/dist'));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, '.vite/manifest.json'), 'utf8'));
  assert.ok(manifest['index.html']?.isEntry, app + ': missing index manifest entry');
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    assert.ok(manifest[key], app + ': missing import ' + key);
    initial.add(key);
    for (const imported of manifest[key].imports ?? []) visit(imported);
  }
  visit('index.html');
  async function size(file) {
    const full = path.resolve(dir, file);
    assert.ok(full.startsWith(dir + path.sep), app + ': asset escaped output directory');
    const bytes = await fs.readFile(full);
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }
  const allJs = [...new Set(Object.values(manifest).map(item => item.file).filter(file => file.endsWith('.js')))];
  const sizes = await Promise.all(allJs.map(size));
  const initialFiles = new Set([...initial].map(key => manifest[key].file));
  const initialJs = sizes.filter(item => initialFiles.has(item.file));
  const total = items => items.reduce((sum, item) => ({ bytes: sum.bytes + item.bytes, gzipBytes: sum.gzipBytes + item.gzipBytes }), { bytes: 0, gzipBytes: 0 });
  const initialSize = total(initialJs);
  const largestChunk = [...sizes].sort((a, b) => b.bytes - a.bytes)[0];
  const deferred = budgets[app].deferred.map(key => ({ key, isDynamicEntry: manifest[key]?.isDynamicEntry === true, inInitialGraph: initial.has(key) }));
  const selectedRoutes = {};
  for (const item of deferred.filter(item => item.isDynamicEntry)) {
    const keys = new Set(initial);
    function add(key) {
      if (keys.has(key)) return;
      assert.ok(manifest[key], app + ': missing selected route import ' + key);
      keys.add(key);
      for (const imported of manifest[key].imports ?? []) add(imported);
    }
    add(item.key);
    if (app === 'merchant') add('src/layouts/MerchantLayout.tsx');
    const files = new Set([...keys].map(key => manifest[key].file));
    selectedRoutes[item.key] = total(sizes.filter(size => files.has(size.file)));
  }
  const failures = [];
  if (initialSize.bytes > budgets[app].initialJsBytes) failures.push('Initial JS byte budget exceeded');
  if (initialSize.gzipBytes > budgets[app].initialJsGzipBytes) failures.push('Initial JS gzip budget exceeded');
  if (largestChunk.bytes > budgets[app].maxChunkBytes) failures.push('500 kB maximum chunk budget exceeded');
  for (const item of deferred) if (!item.isDynamicEntry || item.inInitialGraph) failures.push('Business route eagerly included: ' + item.key);
  report.apps[app] = { output: dir, budget: budgets[app], initialJs: initialSize, largestChunk, totalJs: total(sizes),
    initialFiles: initialJs, dynamicEntries: Object.values(manifest).filter(item => item.isDynamicEntry).length, deferred, selectedRoutes, failures };
  if (failures.length) report.passed = false;
}
const reportFile = option('report');
if (reportFile) {
  await fs.mkdir(path.dirname(path.resolve(reportFile)), { recursive: true });
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.passed && !measureOnly) process.exitCode = 1;
