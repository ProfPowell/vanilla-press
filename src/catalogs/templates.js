/**
 * Starter collection templates. Pure and browser-safe. Every call to
 * designFromTemplate builds a design with fresh ids.
 *
 * @module catalogs/templates
 */

import { newId } from './model.js';

const field = (label, type, level = 'public', extra = {}) => ({ id: newId('f'), label, type, level, ...extra });
const choice = (label, children = []) => ({ id: newId('c'), label, children });
const list = (label, choices) => ({ id: newId('l'), label, choices });

/** Build a tree from { Label: { Child: [grandchildren] | {…} } } shorthand. */
function tree(spec) {
  if (Array.isArray(spec)) return spec.map((label) => choice(label));
  return Object.entries(spec).map(([label, kids]) => choice(label, tree(kids)));
}

const privateFields = () => [
  field('Price paid', 'money', 'private', { total: false }),
  field('Date acquired', 'date', 'private'),
  field('Where/how acquired', 'text', 'private'),
  field('Private notes', 'text', 'private'),
  field('Estimated value', 'money', 'private', { total: true }),
];

const REGIONS = ['NTSC-U', 'NTSC-J', 'PAL', 'Other'];
const COMPLETENESS = ['Loose', 'Cart + box', 'CIB', 'Sealed'];
const CONDITIONS = ['Poor', 'Fair', 'Good', 'Very Good', 'Fine', 'Near Mint', 'Mint'];

const COIN_LISTS = () => [list('Denomination', tree({
  '1¢': {
    'Flying Eagle': [],
    'Indian Head': [],
    Lincoln: ['Wheat', 'Memorial', 'Shield'],
  },
  '5¢': { 'Shield': [], 'Liberty "V"': [], Buffalo: [], Jefferson: ['Pre-war', 'War nickel', 'Modern'] },
  '10¢': { 'Barber': [], 'Mercury': [], Roosevelt: ['Silver', 'Clad'] },
  '25¢': { Barber: [], 'Standing Liberty': [], Washington: ['Silver', 'Clad', 'Bicentennial'], 'State quarters': [], 'America the Beautiful': [] },
  '50¢': { Barber: [], 'Walking Liberty': [], Franklin: [], Kennedy: ['1964 silver', '40% silver', 'Clad'] },
  '$1': { 'Morgan': [], Peace: [], Eisenhower: [], 'Susan B. Anthony': [], Sacagawea: [], 'Presidential': [] },
}))];

const BUILDERS = {
  'us-coins': () => ({
    fields: [
      field('Year', 'number'),
      field('Mint mark', 'text'),
      field('Strike', 'choice', 'public', { options: ['Business', 'Proof'] }),
      field('Composition', 'text'),
      field('Catalog number', 'text'),
      field('Notes', 'text'),
      ...privateFields(),
    ],
    lists: COIN_LISTS(),
    grading: { level: 'public', agencies: ['pcgs', 'ngc', 'anacs', 'cac'] },
  }),
  'retro-games': () => ({
    fields: [
      field('Region', 'choice', 'public', { options: REGIONS }),
      field('Publisher', 'text'),
      field('Developer', 'text'),
      field('Year', 'number'),
      field('Completeness', 'choice', 'public', { options: COMPLETENESS }),
      field('Box condition', 'choice', 'public', { options: CONDITIONS }),
      field('Manual condition', 'choice', 'public', { options: CONDITIONS }),
      ...privateFields(),
    ],
    lists: [
      list('System', tree({
        Nintendo: ['NES', 'SNES', 'Nintendo 64', 'GameCube', 'Game Boy', 'Game Boy Advance'],
        Sega: ['Master System', 'Genesis', 'Saturn', 'Dreamcast', 'Game Gear'],
        Sony: ['PlayStation', 'PlayStation 2'],
        Atari: ['2600', '7800', 'Lynx'],
      })),
      list('Genre', ['Action', 'Platformer', 'Role-playing', 'Shooter', 'Sports', 'Racing', 'Puzzle', 'Fighting', 'Adventure']
        .map((g) => choice(g))),
    ],
    grading: { level: 'public', agencies: ['wata', 'vga'] },
  }),
  'retro-hardware': () => ({
    fields: [
      field('Region', 'choice', 'public', { options: REGIONS }),
      field('Serial number', 'text'),
      field('Revision', 'text'),
      field('Edition / colour', 'text'),
      field('Mods', 'text'),
      field('Working state', 'choice', 'public', { options: ['Working', 'Needs repair', 'Untested', 'For parts'] }),
      field('Included items', 'text'),
      ...privateFields(),
    ],
    lists: [list('System', tree({
      Nintendo: { NES: ['Front-loader', 'Top-loader'], SNES: ['Original', 'SNES Jr.'], 'Nintendo 64': [], 'Game Boy': ['Original', 'Pocket', 'Color'] },
      Sega: { Genesis: ['Model 1', 'Model 2', 'Model 3'], Saturn: [], Dreamcast: [] },
      Sony: { PlayStation: ['Original', 'PSone'], 'PlayStation 2': ['Fat', 'Slim'] },
      Atari: { '2600': ['Heavy sixer', 'Light sixer', '4-switch'] },
    }))],
    grading: null,
  }),
  'trading-cards': () => ({
    fields: [
      field('Card name', 'text'),
      field('Card number', 'text'),
      field('Year', 'number'),
      field('Rarity', 'text'),
      field('Finish', 'choice', 'public', { options: ['Standard', 'Holo', 'Reverse holo', 'Foil', 'Refractor'] }),
      field('Language', 'text'),
      field('Edition', 'text'),
      ...privateFields(),
    ],
    lists: [list('Game or sport', tree({
      Pokémon: { 'Base Set': ['1st Edition', 'Shadowless', 'Unlimited'], Jungle: ['1st Edition', 'Unlimited'], Fossil: ['1st Edition', 'Unlimited'] },
      'Magic: The Gathering': { Alpha: [], Beta: [], Unlimited: [], Revised: [] },
      Baseball: { '1952 Topps': ['Series 1', 'High numbers'], '1986 Fleer': [], '1989 Upper Deck': [] },
      Basketball: { '1986 Fleer': ['Base', 'Stickers'], '1996 Topps Chrome': [] },
      Football: { '1986 Topps': [], '2000 Playoff Contenders': [] },
    }))],
    grading: { level: 'public', agencies: ['psa', 'bgs', 'cgc-cards', 'sgc'] },
  }),
  comics: () => ({
    fields: [
      field('Issue', 'text'),
      field('Cover date', 'date'),
      field('Variant', 'text'),
      field('Key issue note', 'text'),
      field('Writer', 'text'),
      field('Artist', 'text'),
      ...privateFields(),
    ],
    lists: [list('Publisher', tree({
      Marvel: ['Amazing Spider-Man', 'X-Men', 'Fantastic Four', 'Avengers'],
      'DC Comics': ['Action Comics', 'Detective Comics', 'Batman', 'Superman'],
      'Image Comics': ['Spawn', 'The Walking Dead'],
      'Dark Horse': [],
    }))],
    grading: { level: 'public', agencies: ['cgc-comics', 'cbcs'] },
  }),
  books: () => ({
    fields: [
      field('Author', 'text'),
      field('ISBN', 'text'),
      field('Publisher', 'text'),
      field('Edition', 'text'),
      field('Printing', 'text'),
      field('Binding', 'choice', 'public', { options: ['Hardcover', 'Paperback', 'Other'] }),
      field('Signed', 'bool'),
      ...privateFields(),
    ],
    lists: [list('Genre', ['Fiction', 'Science fiction', 'Fantasy', 'Mystery', 'History', 'Biography', 'Science', 'Technology', 'Art']
      .map((g) => choice(g)))],
    grading: { level: 'public', agencies: ['raw'] },
  }),
  blank: () => ({ fields: [], lists: [], grading: null }),
};

/** @type {Array<{id: string, label: string, description: string}>} */
const META = [
  { id: 'us-coins', label: 'US coins', description: 'Denomination, series and variety; year, mint mark, strike; PCGS, NGC, ANACS and CAC grades.' },
  { id: 'retro-games', label: 'Retro games', description: 'System and genre; region, publisher, completeness and box condition; WATA and VGA grades.' },
  { id: 'retro-hardware', label: 'Retro hardware', description: 'Maker, system and model; region, serial, revision, mods and working state.' },
  { id: 'trading-cards', label: 'Trading cards', description: 'Game or sport and set; card number, rarity, finish and edition; PSA, BGS, CGC and SGC grades.' },
  { id: 'comics', label: 'Comics', description: 'Publisher and series; issue, cover date, variant and key issues; CGC and CBCS grades.' },
  { id: 'books', label: 'Books', description: 'Genre; author, ISBN, edition, printing, binding and signed; condition words.' },
  { id: 'blank', label: 'Blank', description: 'Start from nothing and design your own fields and categories.' },
];

/**
 * Design for a template id, with fresh ids and the default sort.
 * @param {string} id
 * @returns {{fields: Object[], lists: Object[], grading: Object|null, sort: string[]}}
 * @throws {Error} unknown template id
 */
export function designFromTemplate(id) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown template: ${id}`);
  return { ...build(), sort: ['title', 'added'] };
}

/** @type {Array<{id: string, label: string, description: string, design: Object}>} */
export const TEMPLATES = META.map((m) => ({
  ...m,
  get design() { return designFromTemplate(m.id); },
}));
