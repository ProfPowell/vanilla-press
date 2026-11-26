/**
 * Grading agencies and scales for Collections. Pure and browser-safe.
 * Each scale runs from lowest to highest grade.
 *
 * @module catalogs/grading
 */

const range = (from, to, step, digits = 1) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v.toFixed(digits));
  return out;
};
const trim = (list) => list.map((v) => v.replace(/\.0$/, ''));

const SHELDON = ['P-1', 'FR-2', 'AG-3', 'G-4', 'G-6', 'VG-8', 'VG-10', 'F-12', 'F-15', 'VF-20', 'VF-25', 'VF-30', 'VF-35',
  'XF-40', 'XF-45', 'AU-50', 'AU-53', 'AU-55', 'AU-58', ...range(60, 70, 1, 0).map((n) => `MS-${n}`)];
const proof = (prefix) => range(60, 70, 1, 0).map((n) => `${prefix}-${n}`);

const COIN_SCALE_PR = [...SHELDON, ...proof('PR')];
const COIN_SCALE_PF = [...SHELDON, ...proof('PF')];
const CAC_EXTRA = { id: 'cac', label: 'CAC sticker', type: 'bool' };

const HALF_POINTS = trim(range(1, 10, 0.5));
const COMIC_SCALE = ['0.5', '1.0', '1.5', '1.8', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5',
  '7.0', '7.5', '8.0', '8.5', '9.0', '9.2', '9.4', '9.6', '9.8', '10.0'];
const PAGES = { id: 'pages', label: 'Page quality', type: 'text' };

/** @type {Record<string, {label: string, scale: string[], extras?: Array<{id: string, label: string, type: 'bool'|'number'|'text'}>}>} */
export const AGENCIES = {
  pcgs: { label: 'PCGS', scale: COIN_SCALE_PR, extras: [CAC_EXTRA] },
  ngc: { label: 'NGC', scale: COIN_SCALE_PF, extras: [CAC_EXTRA] },
  anacs: { label: 'ANACS', scale: COIN_SCALE_PR },
  cac: { label: 'CAC', scale: COIN_SCALE_PR },
  psa: { label: 'PSA', scale: ['1', '1.5', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
  bgs: {
    label: 'Beckett (BGS)',
    scale: HALF_POINTS,
    extras: [
      { id: 'centering', label: 'Centering', type: 'number' },
      { id: 'corners', label: 'Corners', type: 'number' },
      { id: 'edges', label: 'Edges', type: 'number' },
      { id: 'surface', label: 'Surface', type: 'number' },
    ],
  },
  'cgc-cards': { label: 'CGC Cards', scale: HALF_POINTS },
  sgc: { label: 'SGC', scale: HALF_POINTS },
  'cgc-comics': { label: 'CGC Comics', scale: COMIC_SCALE, extras: [PAGES] },
  cbcs: { label: 'CBCS', scale: COMIC_SCALE, extras: [PAGES] },
  wata: { label: 'WATA', scale: HALF_POINTS, extras: [{ id: 'seal', label: 'Seal rating', type: 'text' }] },
  vga: { label: 'VGA', scale: range(10, 100, 5, 0) },
  raw: { label: 'Raw (ungraded)', scale: ['Poor', 'Fair', 'Good', 'Very Good', 'Fine', 'Very Fine', 'Near Mint', 'Mint'] },
};

function position(grade) {
  const agency = AGENCIES[grade?.agency];
  if (!agency) return null;
  const i = agency.scale.indexOf(grade.value);
  return { index: i, pos: i < 0 ? 0 : i / (agency.scale.length - 1) };
}

/**
 * Order two grades: same agency by scale index, different agencies by their
 * normalised 0-1 position. Unknown agencies ("other") and missing grades sort last.
 * @returns {number} negative, zero or positive
 */
export function compareGrades(a, b) {
  const pa = position(a);
  const pb = position(b);
  if (!pa || !pb) return (pa ? 0 : 1) - (pb ? 0 : 1);
  if (a.agency === b.agency) return pa.index - pb.index;
  return pa.pos - pb.pos;
}
