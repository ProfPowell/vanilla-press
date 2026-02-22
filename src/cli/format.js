/**
 * CLI output formatting helpers.
 *
 * @module cli/format
 */

/**
 * Print a table of objects to stdout.
 * Columns are auto-sized to fit content.
 * @param {Object[]} rows
 * @param {string[]} columns - Keys to display
 * @param {Object} [labels] - Optional column header labels (key → label)
 */
export function table(rows, columns, labels = {}) {
  if (rows.length === 0) {
    console.log('(no results)');
    return;
  }

  const headers = columns.map(c => labels[c] || c.toUpperCase());
  const widths = columns.map((col, i) => {
    const values = rows.map(r => String(r[col] ?? ''));
    return Math.max(headers[i].length, ...values.map(v => v.length));
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const separator = widths.map(w => '-'.repeat(w)).join('  ');

  console.log(headerLine);
  console.log(separator);

  for (const row of rows) {
    const line = columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join('  ');
    console.log(line);
  }
}

/**
 * Print JSON to stdout.
 * @param {*} data
 */
export function json(data) {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print a success message to stderr.
 * @param {string} msg
 */
export function success(msg) {
  console.error(`ok: ${msg}`);
}

/**
 * Print an error message to stderr and exit with code 1.
 * @param {string} msg
 */
export function error(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
