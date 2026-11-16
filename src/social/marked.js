// Load `marked` from the site's own Cook install, so the About preview renders with the
// same Markdown engine (and version) Cook builds the site with; null on any failure.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function importMarked(siteDir) {
  try {
    const require = createRequire(join(siteDir, 'node_modules', 'cook-ssg', 'package.json'));
    const mod = await import(pathToFileURL(require.resolve('marked')).href);
    return mod.marked ?? mod;
  } catch {
    return null;
  }
}
