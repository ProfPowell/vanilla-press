#!/usr/bin/env node

/**
 * Vanilla Press CLI entry point.
 */

import { run } from '../src/cli/run.js';

run(process.argv.slice(2));
