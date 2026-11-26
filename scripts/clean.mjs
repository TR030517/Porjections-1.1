import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['dist', 'server.js']) {
  const target = path.resolve(projectRoot, name);
  if (path.dirname(target) !== path.resolve(projectRoot)) throw new Error('Refusing to clean a path outside the project root.');
  rmSync(target, { recursive: true, force: true });
}
