// Load `cook-ssg/social` from the site's own install; null on any failure.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function importCookSocial(siteDir) {
  try {
    const require = createRequire(join(siteDir, 'package.json'));
    return await import(pathToFileURL(require.resolve('cook-ssg/social')).href);
  } catch {
    return null;
  }
}
