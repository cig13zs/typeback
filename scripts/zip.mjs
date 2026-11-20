import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const dist = path.join(root, 'dist');
const destination = path.join(root, `typeback-${version}.zip`);

if (!existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json is missing. Run npm run build first.');
  process.exit(1);
}

rmSync(destination, { force: true });
execFileSync('zip', ['-r', '-q', destination, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`Wrote typeback-${version}.zip`);
