/**
 * Vanilla Press CLI — arg parsing, DB init, subcommand routing.
 *
 * @module cli/run
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { migrate } from '../store/migrate.js';
import {
  getDocument,
  getDocumentBySlug,
  listCollection,
  saveDocument,
  deleteDocument,
  searchDocuments,
  getCollections,
  getAllPublished,
} from '../store/content.js';
import { validate } from '../schema/validate.js';
import { render as renderHtml } from '../renderers/html.js';
import { render as renderMarkdown } from '../renderers/markdown.js';
import { table, json, success, error } from './format.js';
import { parseMarkdown } from './markdown-parser.js';
import { resolveWorkspace, openWorkspaceDb } from '../workspace/workspace.js';
import { exportDocument, removeExport } from '../export/export.js';
import { syncFromContent } from '../export/sync.js';
import { getCollectionsConfig, preflightSave, exportAll } from '../export/site-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const VERSION = '0.1.0';
/** `vp serve` port; Cook's dev server (`cook dev`, the preview) keeps 3000. */
const DEFAULT_PORT = '3007';

// --- Helpers ---

/**
 * Generate a document ID: doc_ + 8 random hex chars.
 * @returns {string}
 */
function generateId() {
  return 'doc_' + crypto.randomUUID().slice(0, 8);
}

/** Site directory from the global --site flag (falls back to VP_SITE). */
let siteOption;

/**
 * Resolve the workspace for this invocation (--site / VP_SITE, else fixture mode).
 * @returns {import('../workspace/workspace.js').Workspace}
 */
function getWorkspace() {
  return resolveWorkspace({ site: siteOption, repoRoot: ROOT });
}

/**
 * Open the database, running migrations.
 * Uses the site workspace when set; in fixture mode VP_DB overrides the DB path.
 * @returns {import('better-sqlite3').Database}
 */
function openDb() {
  const ws = getWorkspace();
  if (!ws.siteDir && process.env.VP_DB) {
    const db = new Database(process.env.VP_DB);
    migrate(db);
    return db;
  }
  return openWorkspaceDb(ws);
}

/**
 * Save a document and, when a site is set, export it, without exiting.
 * Refuses (not saved) when the stored version's JSON changed on disk or the
 * export would be rejected.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} doc
 * @returns {{ saved: Object } | { problem: string }} problem: a message for the user
 */
function trySaveAndExport(db, doc) {
  const ws = getWorkspace();
  let previousDoc = null;
  if (ws.exportEnabled) {
    previousDoc = getDocument(db, doc.id);
    let problem;
    try {
      problem = preflightSave(ws, db, doc, getCollectionsConfig(db));
    } catch (err) {
      return { problem: `not saved: ${err.message}` };
    }
    if (problem?.status === 409) {
      return { problem: `${problem.path} changed on disk (e.g. git pull); not saved. Run 'vp import:content' to load it.` };
    }
    if (problem) return { problem: problem.error.replace(/^Not saved/, 'not saved') };
  }
  const saved = saveDocument(db, doc);
  if (ws.exportEnabled) {
    try {
      exportDocument(ws, saved, { collectionsConfig: getCollectionsConfig(db), previousDoc });
    } catch (err) {
      return { problem: `saved, but not exported: ${err.message}` };
    }
  }
  return { saved };
}

/**
 * Save and export (see trySaveAndExport); on a problem, exit 1 with its message.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} doc
 * @returns {Object} saved document
 */
function saveAndExport(db, doc) {
  const result = trySaveAndExport(db, doc);
  if (result.problem) {
    db.close();
    error(result.problem);
  }
  return result.saved;
}

/** Workspace for a command that needs a site; exits with an error without one. */
function requireSite(command) {
  const ws = getWorkspace();
  if (!ws.exportEnabled) error(`${command} needs a site: pass --site <path> or set VP_SITE`);
  return ws;
}

/**
 * Resolve a document from a `collection/slug` or bare `id` argument.
 * @param {import('better-sqlite3').Database} db
 * @param {string} arg
 * @returns {Object} document
 */
function resolveDoc(db, arg) {
  if (arg.includes('/')) {
    const [collection, slug] = arg.split('/', 2);
    const doc = getDocumentBySlug(db, collection, slug);
    if (!doc) error(`document not found: ${arg}`);
    return doc;
  }
  const doc = getDocument(db, arg);
  if (!doc) error(`document not found: ${arg}`);
  return doc;
}

/**
 * Prompt user for yes/no confirmation.
 * @param {string} msg
 * @returns {Promise<boolean>}
 */
function confirm(msg) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${msg} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Create a document template for $EDITOR.
 * @param {string} collection
 * @param {string} [slug]
 * @returns {Object}
 */
function docTemplate(collection, slug) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    meta: {
      title: '',
      slug: slug || '',
      collection,
      status: 'draft',
      description: '',
      created: now,
      updated: now,
      tags: [],
    },
    blocks: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: '' }],
      },
    ],
  };
}

/**
 * Open content in $EDITOR and return edited JSON.
 * @param {Object} doc
 * @returns {Object} parsed document
 */
function openInEditor(doc) {
  const editorCmd = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmpFile = join(tmpdir(), `vp-${Date.now()}.json`);

  writeFileSync(tmpFile, JSON.stringify(doc, null, 2), 'utf-8');

  try {
    spawnSync(editorCmd, [tmpFile], { stdio: 'inherit' });
    const content = readFileSync(tmpFile, 'utf-8');
    return JSON.parse(content);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// --- Commands ---

function cmdHelp() {
  console.log(`Vanilla Press CLI v${VERSION}

Usage: vp <command> [options]

Content:
  list [collection]         List documents
  get <ref>                 Print document JSON (collection/slug or id)
  new <collection> [slug]   Create a new document
  edit <ref>                Edit document in $EDITOR
  publish <ref>             Set status to published
  unpublish <ref>           Set status to draft
  delete <ref>              Delete a document

Site:
  serve [--port <n>]        Start editor + API dev server (default ${DEFAULT_PORT})
  export                    Export every document to the site (needs --site)

Import:
  import:content [--replace]  Load the site's content JSON into the store (needs --site)
  import:json <file>        Import a JSON document
  import:markdown <file>    Import a markdown file
  import:dir <path>         Bulk import .json and .md files

Utility:
  validate <ref>            Validate a document
  render <ref>              Render to stdout
  search <query>            Full-text search
  stats                     Show database statistics

Options:
  --site <path>             Edit the Cook site at <path> (or set VP_SITE)
  --help, -h                Show this help
  --version, -v             Show version`);
}

function cmdVersion() {
  console.log(VERSION);
}

function cmdList(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      status: { type: 'string' },
      tag: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const db = openDb();
  const collections = positionals.length > 0
    ? [positionals[0]]
    : getCollections(db);

  const statuses = values.status
    ? [values.status]
    : ['published', 'draft', 'archived'];

  const allDocs = [];
  for (const collection of collections) {
    for (const status of statuses) {
      const opts = { status };
      if (values.tag) opts.tag = values.tag;
      allDocs.push(...listCollection(db, collection, opts));
    }
  }

  db.close();

  if (values.json) {
    json(allDocs);
    return;
  }

  const rows = allDocs.map(d => ({
    id: d.id,
    collection: d.meta.collection,
    slug: d.meta.slug,
    title: d.meta.title,
    status: d.meta.status,
  }));

  table(rows, ['id', 'collection', 'slug', 'title', 'status']);
}

function cmdGet(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp get <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);
  db.close();

  json(doc);
}

function cmdNew(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'string' },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) error('usage: vp new <collection> [slug]');

  const collection = positionals[0];
  const slug = positionals[1];

  if (values.title) {
    // Non-interactive mode
    const doc = docTemplate(collection, slug || slugify(values.title));
    doc.meta.title = values.title;
    if (values.description) doc.meta.description = values.description;
    if (values.tags) doc.meta.tags = values.tags.split(',').map(t => t.trim());

    const result = validate(doc);
    if (!result.valid) error(`validation failed:\n  ${result.errors.join('\n  ')}`);

    const db = openDb();
    const saved = saveAndExport(db, doc);
    db.close();
    success(`created ${saved.meta.collection}/${saved.meta.slug} (${saved.id})`);
  } else {
    // Interactive: open $EDITOR
    const template = docTemplate(collection, slug);
    const edited = openInEditor(template);

    const result = validate(edited);
    if (!result.valid) error(`validation failed:\n  ${result.errors.join('\n  ')}`);

    const db = openDb();
    const saved = saveAndExport(db, edited);
    db.close();
    success(`created ${saved.meta.collection}/${saved.meta.slug} (${saved.id})`);
  }
}

function cmdEdit(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp edit <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);
  const edited = openInEditor(doc);

  const result = validate(edited);
  if (!result.valid) {
    db.close();
    error(`validation failed:\n  ${result.errors.join('\n  ')}`);
  }

  edited.meta.updated = new Date().toISOString();
  saveAndExport(db, edited);
  db.close();
  success(`updated ${edited.meta.collection}/${edited.meta.slug}`);
}

function cmdPublish(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp publish <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);

  const now = new Date().toISOString();
  doc.meta.status = 'published';
  doc.meta.published = doc.meta.published || now;
  doc.meta.updated = now;
  saveAndExport(db, doc);
  db.close();
  success(`published ${doc.meta.collection}/${doc.meta.slug}`);
}

function cmdUnpublish(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp unpublish <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);

  doc.meta.status = 'draft';
  doc.meta.published = undefined;
  doc.meta.updated = new Date().toISOString();
  saveAndExport(db, doc);
  db.close();
  success(`unpublished ${doc.meta.collection}/${doc.meta.slug}`);
}

async function cmdDelete(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      force: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) error('usage: vp delete <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);

  if (!values.force) {
    const ok = await confirm(`Delete ${doc.meta.collection}/${doc.meta.slug}?`);
    if (!ok) {
      db.close();
      console.error('cancelled');
      return;
    }
  }

  const ws = getWorkspace();
  if (ws.exportEnabled) {
    try {
      removeExport(ws, doc.id, { previousDoc: doc, collectionsConfig: getCollectionsConfig(db) });
    } catch (err) {
      db.close();
      error(`not deleted: ${err.message}`);
    }
  }

  deleteDocument(db, doc.id);
  db.close();
  success(`deleted ${doc.meta.collection}/${doc.meta.slug} (${doc.id})`);
}

async function cmdServe(args) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: DEFAULT_PORT },
    },
    allowPositionals: true,
  });

  const port = parseInt(values.port, 10);

  // Use the dev server (editor + API)
  const { startServer } = await import('../server/index.js');
  startServer({ port, site: siteOption });
}

function cmdExport() {
  const ws = requireSite('export');
  const db = openDb();
  let result;
  try {
    result = exportAll(ws, db);
  } catch (err) {
    db.close();
    error(`export failed: ${err.message}`);
  }
  db.close();
  for (const c of result.conflicts) console.error(`skipped: ${c}`);
  success(`exported ${result.exported} documents to ${ws.siteDir}` +
    (result.conflicts.length ? ` (${result.conflicts.length} skipped)` : ''));
}

function cmdImportContent(args) {
  const { values } = parseArgs({
    args,
    options: { replace: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const ws = requireSite('import:content');
  const db = openDb();
  const { imported, skipped, removed } = syncFromContent(ws, db, { replace: values.replace });
  db.close();
  success(`imported ${imported.length}, skipped ${skipped.length}, removed ${removed.length} from ${ws.contentDir}`);
}

function cmdImportJson(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp import:json <file>');

  const filePath = resolve(positionals[0]);
  const content = readFileSync(filePath, 'utf-8');
  const doc = JSON.parse(content);

  if (!doc.id) doc.id = generateId();

  const result = validate(doc);
  if (!result.valid) error(`validation failed:\n  ${result.errors.join('\n  ')}`);

  const db = openDb();
  const saved = saveAndExport(db, doc);
  db.close();
  success(`imported ${saved.meta.collection}/${saved.meta.slug} (${saved.id})`);
}

function cmdImportMarkdown(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp import:markdown <file>');

  const filePath = resolve(positionals[0]);
  const content = readFileSync(filePath, 'utf-8');
  const doc = parseMarkdown(content);

  if (!doc.id) doc.id = generateId();

  const result = validate(doc);
  if (!result.valid) error(`validation failed:\n  ${result.errors.join('\n  ')}`);

  const db = openDb();
  const saved = saveAndExport(db, doc);
  db.close();
  success(`imported ${saved.meta.collection}/${saved.meta.slug} (${saved.id})`);
}

function cmdImportDir(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  if (positionals.length === 0) error('usage: vp import:dir <path>');

  const dirPath = resolve(positionals[0]);
  if (!existsSync(dirPath)) error(`directory not found: ${dirPath}`);

  const files = readdirSync(dirPath).filter(f =>
    f.endsWith('.json') || f.endsWith('.md')
  );

  if (files.length === 0) {
    console.error('no .json or .md files found');
    return;
  }

  const db = openDb();
  let imported = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      let doc;
      if (file.endsWith('.json')) {
        doc = JSON.parse(readFileSync(filePath, 'utf-8'));
      } else {
        doc = parseMarkdown(readFileSync(filePath, 'utf-8'));
      }

      if (!doc.id) doc.id = generateId();

      const result = validate(doc);
      if (!result.valid) {
        console.error(`  skip: ${file} (${result.errors[0]})`);
        failed++;
        continue;
      }

      const { problem } = trySaveAndExport(db, doc);
      if (problem) {
        console.error(`  skip: ${file} (${problem})`);
        failed++;
        continue;
      }
      console.error(`  imported: ${file}`);
      imported++;
    } catch (e) {
      console.error(`  skip: ${file} (${e.message})`);
      failed++;
    }
  }

  db.close();
  if (failed) error(`imported ${imported} files, ${failed} skipped`);
  success(`imported ${imported} files`);
}

function cmdValidate(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      file: { type: 'string' },
    },
    allowPositionals: true,
  });

  let doc;
  if (values.file) {
    const content = readFileSync(resolve(values.file), 'utf-8');
    doc = JSON.parse(content);
  } else {
    if (positionals.length === 0) error('usage: vp validate <collection/slug or id> | --file <path>');
    const db = openDb();
    doc = resolveDoc(db, positionals[0]);
    db.close();
  }

  const result = validate(doc);
  if (result.valid) {
    success('document is valid');
  } else {
    console.error('validation errors:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}

function cmdRender(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      format: { type: 'string', default: 'html' },
      scope: { type: 'string', default: 'content' },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) error('usage: vp render <collection/slug or id>');

  const db = openDb();
  const doc = resolveDoc(db, positionals[0]);
  db.close();

  switch (values.format) {
    case 'html':
      console.log(renderHtml(doc, { scope: values.scope }));
      break;
    case 'md':
    case 'markdown':
      console.log(renderMarkdown(doc));
      break;
    case 'json':
      json(doc);
      break;
    default:
      error(`unknown format: ${values.format}. Use html, md, or json`);
  }
}

function cmdSearch(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      limit: { type: 'string', default: '20' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) error('usage: vp search <query>');

  const db = openDb();
  const results = searchDocuments(db, positionals[0], {
    limit: parseInt(values.limit, 10),
  });
  db.close();

  if (values.json) {
    json(results);
    return;
  }

  if (results.length === 0) {
    console.log('no results');
    return;
  }

  const rows = results.map(d => ({
    id: d.id,
    collection: d.meta.collection,
    slug: d.meta.slug,
    title: d.meta.title,
    status: d.meta.status,
  }));

  table(rows, ['id', 'collection', 'slug', 'title', 'status']);
}

function cmdStats(args) {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const db = openDb();
  const ws = getWorkspace();
  const dbPath = ws.siteDir ? ws.dbPath : process.env.VP_DB || ws.dbPath;

  // Count by status
  const statusCounts = {};
  for (const status of ['published', 'draft', 'archived']) {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM documents WHERE status = ?'
    ).get(status);
    statusCounts[status] = row.count;
  }

  // Count by collection
  const collectionCounts = {};
  const collections = getCollections(db);
  for (const collection of collections) {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM documents WHERE collection = ?'
    ).get(collection);
    collectionCounts[collection] = row.count;
  }

  // Tag counts
  const tagCounts = {};
  const tagRows = db.prepare(
    'SELECT tags FROM documents WHERE tags IS NOT NULL'
  ).all();
  for (const row of tagRows) {
    const tags = JSON.parse(row.tags);
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  // DB size
  let dbSize = 0;
  try {
    dbSize = statSync(dbPath).size;
  } catch { /* in-memory or missing */ }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  db.close();

  const stats = {
    total,
    byStatus: statusCounts,
    byCollection: collectionCounts,
    byTag: tagCounts,
    dbSize,
    dbPath,
  };

  if (values.json) {
    json(stats);
    return;
  }

  console.log(`Documents: ${total}`);
  console.log('');
  console.log('By status:');
  for (const [status, count] of Object.entries(statusCounts)) {
    if (count > 0) console.log(`  ${status}: ${count}`);
  }
  console.log('');
  console.log('By collection:');
  for (const [col, count] of Object.entries(collectionCounts)) {
    console.log(`  ${col}: ${count}`);
  }
  if (Object.keys(tagCounts).length > 0) {
    console.log('');
    console.log('By tag:');
    for (const [tag, count] of Object.entries(tagCounts)) {
      console.log(`  ${tag}: ${count}`);
    }
  }
  if (dbSize > 0) {
    const sizeKB = (dbSize / 1024).toFixed(1);
    console.log('');
    console.log(`DB size: ${sizeKB} KB`);
  }
}

// --- Slug helper ---

/**
 * Convert a title to a URL-safe slug.
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Main router ---

/**
 * Run the CLI with the given argv (process.argv.slice(2)).
 * @param {string[]} argv
 */
export async function run(argv) {
  // Global --site <path> / --site=<path>, accepted anywhere in argv
  siteOption = undefined;
  argv = [...argv];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site') {
      siteOption = argv[i + 1];
      if (!siteOption) error('--site requires a path');
      argv.splice(i, 2);
      break;
    }
    if (argv[i].startsWith('--site=')) {
      siteOption = argv[i].slice('--site='.length);
      argv.splice(i, 1);
      break;
    }
  }

  // Handle top-level flags
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      cmdHelp();
      return;
    }
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    cmdVersion();
    return;
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);

  switch (command) {
    case 'help':
      cmdHelp();
      break;
    case 'version':
      cmdVersion();
      break;
    case 'list':
      cmdList(commandArgs);
      break;
    case 'get':
      cmdGet(commandArgs);
      break;
    case 'new':
      cmdNew(commandArgs);
      break;
    case 'edit':
      cmdEdit(commandArgs);
      break;
    case 'publish':
      cmdPublish(commandArgs);
      break;
    case 'unpublish':
      cmdUnpublish(commandArgs);
      break;
    case 'delete':
      await cmdDelete(commandArgs);
      break;
    case 'serve':
      cmdServe(commandArgs);
      break;
    case 'export':
      cmdExport();
      break;
    case 'import:content':
      cmdImportContent(commandArgs);
      break;
    case 'import:json':
      cmdImportJson(commandArgs);
      break;
    case 'import:markdown':
      cmdImportMarkdown(commandArgs);
      break;
    case 'import:dir':
      cmdImportDir(commandArgs);
      break;
    case 'validate':
      cmdValidate(commandArgs);
      break;
    case 'render':
      cmdRender(commandArgs);
      break;
    case 'search':
      cmdSearch(commandArgs);
      break;
    case 'stats':
      cmdStats(commandArgs);
      break;
    default:
      error(`unknown command: ${command}. Run 'vp --help' for usage.`);
  }
}
