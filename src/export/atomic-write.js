/**
 * Atomic file writes: write a temp file beside the target, then rename.
 *
 * @module export/atomic-write
 */

import { mkdirSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write a file atomically, creating parent directories as needed.
 * @param {string} path - Absolute target path
 * @param {string|Buffer} data
 */
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
