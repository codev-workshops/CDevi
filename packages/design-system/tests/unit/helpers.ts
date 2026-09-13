import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Walks up from cwd to the directory containing packages/design-system/package.json. */
function findPackageRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, 'packages/design-system/package.json'))) {
      return resolve(dir, 'packages/design-system');
    }
    if (existsSync(resolve(dir, 'package.json')) && dir.endsWith('design-system')) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('packages/design-system not found from ' + process.cwd());
    dir = parent;
  }
}

const ROOT = findPackageRoot();

/** Absolute path to a file inside packages/design-system. */
export function pkgPath(...segments: string[]): string {
  return resolve(ROOT, ...segments);
}
