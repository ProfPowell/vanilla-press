/**
 * The layout inspector's model (pure, no DOM): which settings a selected
 * block shows (`inspectorFields`) and the node attrs a change gives
 * (`applyField`). The panel (inspector.js) draws the fields and puts the
 * attrs back through a ProseMirror transaction.
 *
 * - Every block: `repeat` (source from the site's lists, limit and offset
 *   as pipes, alias, optional index), `Show only when` (a field or
 *   `slot:<name>`, as data-if or data-unless), and `id`, `class` and
 *   `aria-label`. Regions and a child's slot pieces don't repeat (Cook
 *   refuses it); an inline component carries its conditions and
 *   attributes as plain attribute pairs and can't repeat either.
 * - Text blocks pick their tag; containers their tag, `data-layout` and
 *   the VB layout attributes (gap, align…); components their tag (a name
 *   with a hyphen) and attributes from VB's custom-elements.json when
 *   known, else raw name/value pairs.
 * - A field atom picks its key: document, site and declared fields, plus
 *   item fields inside a repeat.
 *
 * Field keys: `tag`, `data-layout`, `attr:<name>`, `attrs` (the remaining
 * pairs), `repeat.source|limit|offset|alias|index`, `show.key`,
 * `show.mode`, `path`, `name`, `slot.label`, `text`.
 *
 * @module editor/layout-editor/inspector-model
 */

/** Text block tags. */
export const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'figcaption', 'blockquote'];
/** Base regions. */
export const REGION_TAGS = ['header', 'nav', 'main', 'aside', 'footer'];
/** VB layout elements. */
export const LAYOUT_ELEMENTS = [
  'layout-stack', 'layout-grid', 'layout-cluster', 'layout-sidebar', 'layout-center', 'layout-cover',
  'layout-columns', 'layout-switcher', 'layout-reel', 'layout-imposter', 'layout-card', 'layout-text',
];
/** Container tags: sectioning, header and footer, `div[data-layout]` and the VB layout elements. */
export const CONTAINER_TAGS = ['section', 'article', 'aside', 'nav', 'header', 'footer', 'div', ...LAYOUT_ELEMENTS];
/** Elements that are containers only with `data-layout`. */
const LAYOUT_WRAPPERS = ['div', 'header', 'footer', 'main', 'aside', 'nav', 'section', 'article'];
/** VB `data-layout` values (each styles like its `layout-*` element). */
export const DATA_LAYOUTS = ['stack', 'cluster', 'grid', 'sidebar', 'center', 'cover', 'columns', 'reel', 'switcher', 'split', 'prose', 'media', 'regions'];
export const MENU_TAGS = ['ul', 'ol', 'menu'];
/** The attributes every block has its own field for. */
export const COMMON_ATTRS = ['id', 'class', 'aria-label'];

/** Cook's document fields (cook-ssg/layouts DOCUMENT_FIELDS), when the context has none. */
const FALLBACK_DOCUMENT_FIELDS = [
  'title', 'description', 'date', 'published', 'updated', 'author', 'tags',
  'image', 'imageAlt', 'theme', 'themeScope', 'layout', 'slug', 'vp_id',
  'url', 'pageLayout',
];

const GAP = ['none', '3xs', '2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl'];
const SIZES = ['narrow', 'normal', 'wide'];
const e = (name, values) => ({ name, type: 'string', enum: values });
const b = (name) => ({ name, type: 'boolean' });
/**
 * VB's layout element attributes (its html-validate table), for when the
 * context has none: a published VB package doesn't ship that table.
 */
export const LAYOUT_ATTRS = {
  'layout-stack': [e('data-layout-gap', GAP), e('data-layout-align', ['start', 'center', 'end', 'stretch'])],
  'layout-grid': [e('data-layout-min', ['xs', 's', 'm', 'l', 'xl']), e('data-layout-gap', GAP)],
  'layout-cluster': [e('data-layout-gap', GAP), e('data-layout-justify', ['start', 'end', 'center', 'between']),
    e('data-layout-align', ['start', 'end', 'center', 'stretch', 'baseline']), b('data-layout-nowrap')],
  'layout-sidebar': [e('data-layout-gap', GAP), e('data-layout-side', ['end']), e('data-layout-sidebar-width', SIZES),
    e('data-layout-content-min', ['s', 'm', 'l']), b('data-layout-nowrap')],
  'layout-center': [e('data-layout-max', [...SIZES, 'prose']), b('data-layout-intrinsic'), b('data-layout-text'), e('data-layout-gutter', ['none', 's', 'l'])],
  'layout-cover': [e('data-layout-min', ['s', 'm', 'l', 'xl', 'auto']), e('data-layout-padding', ['none', 's', 'm', 'l', 'xl']),
    e('data-layout-gap', GAP), b('data-layout-centered')],
  'layout-columns': [e('data-layout-align', ['justify']), e('data-layout-column-count', ['1', '2', '3', 'auto']),
    e('data-layout-measure', SIZES), e('data-layout-max', SIZES), b('data-layout-centered')],
  'layout-switcher': [e('data-layout-gap', GAP), e('data-layout-threshold', ['s', 'm', 'l']), e('data-layout-limit', ['2', '3', '4']), b('data-layout-reverse')],
  'layout-reel': [b('data-layout-scrollbar'), e('data-layout-gap', GAP), e('data-layout-padding', ['none', 's', 'm', 'l']),
    e('data-layout-item-width', ['auto', 's', 'm', 'l', 'xl', 'full']), e('data-layout-align', ['start', 'center', 'end', 'stretch'])],
  'layout-imposter': [b('data-layout-fixed'), e('data-layout-margin', ['s', 'm', 'l', 'xl']),
    e('data-layout-position', ['center', 'top', 'bottom', 'start', 'end', 'top-start', 'top-end', 'bottom-start', 'bottom-end']), b('data-layout-contain')],
  'layout-card': [e('data-variant', ['elevated', 'outlined', 'ghost']), e('data-padding', ['none', 's', 'm', 'l', 'xl']), e('data-max', [...SIZES, 'prose'])],
  'layout-text': [e('data-layout-measure', SIZES), e('data-layout-max', SIZES), b('data-layout-centered')],
};

/** Attributes whose empty value is kept (an empty alt is meaningful). */
const KEEP_EMPTY = ['alt'];

export const COMPONENT_TAG_MESSAGE = 'A component name needs a hyphen, like site-search';
const COMPONENT_TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const SLOT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** Cook's repeat grammar: alias and index are `\w+` (and a name starts with a letter or _). */
const ALIAS = /^[A-Za-z_]\w*$/;
/** Cook's field keys (cook-ssg check.js PLAIN_KEY, SLOT_KEY). */
const PLAIN_KEY = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const SLOT_KEY = /^slot:([\w-]+)$/;
/** Attribute names a raw pair can't use: event handlers, and those with their own control or that are structural. */
const RESERVED_ATTRS = ['data-if', 'data-unless', 'data-repeat', 'data-include', 'data-layout-info', 'data-template'];
const reservedAttr = (name) => /^on/i.test(name) || RESERVED_ATTRS.includes(String(name).toLowerCase());
export const COMPONENT_NAME_MESSAGE = 'This component needs a name, like site-search';
const COUNT = /^\d+$/;

// HELPERS
// -----------------------------
const typeOf = (node) => node.type?.name ?? node.type;
const pairsOf = (node) => node.attrs.attrs || [];
const attrValue = (pairs, name) => pairs.find(([k]) => k === name)?.[1] ?? null;

/** `pairs` with `name` set to `value` (in place when present), or removed for null. */
export function setPair(pairs, name, value) {
  const out = pairs.map(p => [...p]);
  const at = out.findIndex(([k]) => k === name);
  if (value === null) {
    if (at !== -1) out.splice(at, 1);
  } else if (at !== -1) out[at][1] = value;
  else out.push([name, value]);
  return out;
}

/** Whether a node type carries the tree's common fields as node attrs. */
const hasCommon = (type) => [
  'region', 'container', 'figure', 'figcaption', 'text_block', 'image', 'menu', 'menu_item',
  'menu_item_blocks', 'include', 'component', 'slot_piece',
].includes(type);

/** Whether a node type can repeat (Cook refuses it on regions and slot pieces). */
const canRepeat = (type) => hasCommon(type) && type !== 'region' && type !== 'slot_piece';

/** Whether a node type has id/class/aria-label fields. */
const hasAttrFields = (type) => (hasCommon(type) && type !== 'slot_piece') || type === 'inline_component';

/** A default alias for a source: its last part, singular (`collections.posts` → `post`). */
export function defaultAlias(source) {
  const last = String(source).split('.').pop().replace(/[^\w$]/g, '') || 'item';
  const singular = last.length > 2 && last.endsWith('s') ? last.slice(0, -1) : last;
  return ALIAS.test(singular) && singular !== source ? singular : 'item';
}

const pipeValue = (pipes, name) => {
  const hit = (pipes || []).map(p => new RegExp(`^${name}:\\s*(\\d+)$`).exec(p)).find(Boolean);
  return hit ? hit[1] : '';
};

function setPipe(pipes, name, value) {
  const out = [...(pipes || [])];
  const at = out.findIndex(p => p.startsWith(`${name}:`));
  if (value === '' || value === null) {
    if (at !== -1) out.splice(at, 1);
  } else if (at !== -1) out[at] = `${name}:${value}`;
  else out.push(`${name}:${value}`);
  return out;
}

/** Item fields for one repeat: its alias (and alias.<field> for a collection), its index. */
function itemFields(repeat, documentFields) {
  const out = [repeat.alias];
  if (String(repeat.source).startsWith('collections.')) out.push(...documentFields.map(f => `${repeat.alias}.${f}`));
  if (repeat.index) out.push(repeat.index);
  return out;
}

const opt = (value, label = value, group = null) => (group ? { value, label, group } : { value, label });

/** The context with defaults filled in. */
export function normalizeContext(context = {}) {
  const list = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  return {
    siteFields: list(context.siteFields),
    documentFields: list(context.documentFields).length ? list(context.documentFields) : FALLBACK_DOCUMENT_FIELDS,
    declaredFields: list(context.declaredFields),
    lists: list(context.lists),
    slots: list(context.slots),
    components: context.components && typeof context.components === 'object' ? context.components : {},
    layoutElements: context.layoutElements && typeof context.layoutElements === 'object' ? context.layoutElements : {},
    repeats: Array.isArray(context.repeats) ? context.repeats.filter(r => r && r.alias) : [],
  };
}

/**
 * The repeats in scope at a node: those of its ancestors (outermost first)
 * and its own (a block's own data-if sees its alias, as Cook checks it).
 * @param {import('prosemirror-model').Node} doc
 * @param {number} pos - the node's position (before it)
 * @returns {Array<{ source: string, alias: string, index?: string }>}
 */
export function repeatsAt(doc, pos) {
  const out = [];
  const $pos = doc.resolve(pos);
  for (let d = 1; d <= $pos.depth; d++) {
    const repeat = $pos.node(d).attrs.repeat;
    if (repeat) out.push(repeat);
  }
  const own = doc.nodeAt(pos)?.attrs?.repeat;
  if (own) out.push(own);
  return out;
}

// FIELDS
// -----------------------------
/**
 * The key options of a field picker: document, site and declared fields,
 * then item fields of the repeats in scope.
 */
function keyOptions(ctx, { slots = false } = {}) {
  const out = [
    ...ctx.documentFields.map(f => opt(f, f, 'Document')),
    ...ctx.siteFields.map(f => opt(f, f, 'Site')),
    ...ctx.declaredFields.map(f => opt(f, f, 'Declared')),
  ];
  for (const repeat of ctx.repeats) out.push(...itemFields(repeat, ctx.documentFields).map(f => opt(f, f, 'Item')));
  if (slots) out.push(...ctx.slots.map(s => opt(`slot:${s}`, `slot:${s}`, 'Region')));
  const seen = new Set();
  return out.filter(o => (seen.has(o.value) ? false : seen.add(o.value)));
}

/** The attribute definitions VB knows for a container (its `layout-*` tag or `data-layout`). */
function layoutAttrDefs(node, ctx) {
  const tag = node.attrs.tag;
  const layout = attrValue(pairsOf(node), 'data-layout');
  const key = tag.startsWith('layout-') ? tag : layout ? `layout-${layout}` : null;
  if (!key) return [];
  const defs = Array.isArray(ctx.layoutElements[key]) ? ctx.layoutElements[key] : LAYOUT_ATTRS[key];
  return Array.isArray(defs) ? defs : [];
}

/** A field per attribute definition (`{ name, type, enum? }`). */
function attrDefFields(pairs, defs) {
  return defs.map((def) => {
    const value = attrValue(pairs, def.name);
    if (def.type === 'boolean') {
      return { key: `attr:${def.name}`, label: def.name, type: 'checkbox', value: value !== null, group: 'attributes', description: def.description };
    }
    if (Array.isArray(def.enum) && def.enum.length) {
      const options = [opt('', '—'), ...def.enum.map(v => opt(v))];
      if (value !== null && !def.enum.includes(value) && value !== '') options.push(opt(value));
      return { key: `attr:${def.name}`, label: def.name, type: 'select', value: value ?? '', options, group: 'attributes', description: def.description };
    }
    return { key: `attr:${def.name}`, label: def.name, type: 'text', value: value ?? '', group: 'attributes', description: def.description };
  });
}

/** The remaining attribute pairs (none of the names given fields of their own). */
function restField(pairs, taken) {
  return { key: 'attrs', label: 'Other attributes', type: 'pairs', value: pairs.filter(([k]) => !taken.includes(k)).map(p => [...p]), group: 'attributes', taken };
}

/** Repeat fields: source, limit, offset, alias, index. */
function repeatFields(node, ctx) {
  const repeat = node.attrs.repeat;
  const source = repeat?.source ?? '';
  const options = [opt('', 'Doesn\'t repeat'), ...ctx.lists.map(l => opt(l))];
  if (source && !ctx.lists.includes(source)) options.push(opt(source));
  const off = !repeat;
  return [
    { key: 'repeat.source', label: 'Repeat for each item in', type: 'select', value: source, options, group: 'repeat' },
    { key: 'repeat.limit', label: 'Limit', type: 'number', value: pipeValue(repeat?.pipes, 'limit'), disabled: off, group: 'repeat' },
    { key: 'repeat.offset', label: 'Skip first', type: 'number', value: pipeValue(repeat?.pipes, 'offset'), disabled: off, group: 'repeat' },
    { key: 'repeat.alias', label: 'Each item is called', type: 'text', value: repeat?.alias ?? '', disabled: off, group: 'repeat' },
    { key: 'repeat.index', label: 'Position is called', type: 'text', value: repeat?.index ?? '', disabled: off, group: 'repeat' },
  ];
}

/** The condition on a node: `{ key, mode }` (data-if wins when both are set). */
function conditionOf(node) {
  const type = typeOf(node);
  if (hasCommon(type)) {
    if (node.attrs.if != null) return { key: node.attrs.if, mode: 'if' };
    if (node.attrs.unless != null) return { key: node.attrs.unless, mode: 'unless' };
    return { key: '', mode: 'if' };
  }
  const pairs = pairsOf(node);
  const cond = attrValue(pairs, 'data-if');
  if (cond !== null) return { key: cond, mode: 'if' };
  const unless = attrValue(pairs, 'data-unless');
  if (unless !== null) return { key: unless, mode: 'unless' };
  return { key: '', mode: 'if' };
}

function showFields(node, ctx) {
  const { key, mode } = conditionOf(node);
  const options = keyOptions(ctx, { slots: true });
  return [
    { key: 'show.key', label: 'Show only when', type: 'combo', value: key, options, group: 'show', error: keyError(key, ctx, { condition: true }) },
    {
      key: 'show.mode', label: 'Show it when that is', type: 'select', value: mode, group: 'show', disabled: key === '',
      options: [opt('if', 'set'), opt('unless', 'not set')],
    },
  ];
}

function commonFields(node, ctx) {
  const type = typeOf(node);
  const out = [];
  if (canRepeat(type)) out.push(...repeatFields(node, ctx));
  if (hasCommon(type) || type === 'inline_component') out.push(...showFields(node, ctx));
  if (hasAttrFields(type)) {
    out.push(...COMMON_ATTRS.map(name => ({
      key: `attr:${name}`, label: name, type: 'text', value: attrValue(pairsOf(node), name) ?? '', group: 'common',
    })));
  }
  return out;
}

const select = (key, label, value, values) => {
  const options = values.map(v => opt(v));
  if (value && !values.includes(value)) options.push(opt(value));
  return { key, label, type: 'select', value, options, group: 'block' };
};

/** The message for a child's piece that fills a region its parent doesn't have. */
export const noParentRegion = (name) => `The layout this is built on has no region "${name}"`;

/** The parent's regions a piece can fill, when they are known (`context.parentSlots`), else null. */
function parentRegions(context) {
  if (!Array.isArray(context?.parentSlots)) return null;
  return context.parentSlots.filter(r => r && typeof r.name === 'string' && r.name && r.name !== 'head');
}

/**
 * A child's piece's region: a select of the parent's regions (by label) that no
 * other piece fills, with an error when the stored name isn't one of the parent's.
 * Free text when the parent's regions aren't known.
 */
function fillsField(node, context) {
  const name = node.attrs.name;
  const regions = parentRegions(context);
  if (!regions) return { key: 'name', label: 'Fills region', type: 'text', value: name, group: 'block' };
  const filled = Array.isArray(context.filledSlots) ? context.filledSlots : [];
  const options = regions.filter(r => r.name === name || !filled.includes(r.name)).map(r => opt(r.name, r.label || r.name));
  const known = regions.some(r => r.name === name);
  if (!known) options.push(opt(name));
  return { key: 'name', label: 'Fills region', type: 'select', value: name, options, group: 'block', error: known ? null : noParentRegion(name) };
}

/** Component fields: tag, then the manifest's attributes (or raw pairs) less the common ones. */
function componentFields(node, ctx, pairs) {
  const tag = node.attrs.tag;
  const known = Object.keys(ctx.components).sort();
  const def = ctx.components[tag];
  const fields = [{
    key: 'tag', label: 'Component', type: 'combo', value: tag, options: known.map(t => opt(t)),
    group: 'block', required: true, error: !tag ? COMPONENT_NAME_MESSAGE : !COMPONENT_TAG.test(tag) ? COMPONENT_TAG_MESSAGE : null,
  }];
  const defs = (def?.attributes || []).filter(a => a && a.name && !COMMON_ATTRS.includes(a.name)
    && !['data-if', 'data-unless', 'data-repeat'].includes(a.name));
  fields.push(...attrDefFields(pairs, defs));
  fields.push(restField(pairs, [...COMMON_ATTRS, ...defs.map(d => d.name), 'data-if', 'data-unless']));
  return fields;
}

/**
 * The fields the inspector shows for a node.
 * @param {import('prosemirror-model').Node|{ type: string|{ name: string }, attrs: Object }} node
 * @param {{ siteFields?: string[], documentFields?: string[], declaredFields?: string[], lists?: string[],
 *   components?: Object, layoutElements?: Object, slots?: string[], repeats?: Object[] }} context -
 *   `repeats`: those in scope at the node (repeatsAt); `slots`: the layout's slot names
 * @returns {Array<{ key: string, label: string, type: string, value: *, options?: Array, group: string }>}
 */
export function inspectorFields(node, context = {}) {
  const ctx = normalizeContext(context);
  const type = typeOf(node);
  const pairs = pairsOf(node);
  const own = [];
  switch (type) {
    case 'text_block':
      own.push(select('tag', 'Element', node.attrs.tag, TEXT_TAGS));
      own.push(restField(pairs, COMMON_ATTRS));
      break;
    case 'region':
      own.push(select('tag', 'Region', node.attrs.tag, REGION_TAGS));
      own.push(restField(pairs, COMMON_ATTRS));
      break;
    case 'container': {
      own.push(select('tag', 'Element', node.attrs.tag, CONTAINER_TAGS));
      const taken = [...COMMON_ATTRS];
      if (LAYOUT_WRAPPERS.includes(node.attrs.tag)) {
        const value = attrValue(pairs, 'data-layout') ?? '';
        const f = select('data-layout', 'Layout', value, ['', ...DATA_LAYOUTS]);
        f.options[0].label = '—';
        own.push(f);
        taken.push('data-layout');
      }
      const defs = layoutAttrDefs(node, ctx);
      own.push(...attrDefFields(pairs, defs));
      taken.push(...defs.map(d => d.name));
      own.push(restField(pairs, taken));
      break;
    }
    case 'menu':
      own.push(select('tag', 'List', node.attrs.tag, MENU_TAGS));
      own.push(restField(pairs, COMMON_ATTRS));
      break;
    case 'image':
      if (node.attrs.html === null) {
        own.push({ key: 'attr:src', label: 'Image address', type: 'text', value: attrValue(pairs, 'src') ?? '', group: 'block' });
        own.push({ key: 'attr:alt', label: 'Alt text', type: 'text', value: attrValue(pairs, 'alt') ?? '', group: 'block' });
        own.push(restField(pairs, [...COMMON_ATTRS, 'src', 'alt']));
      } else {
        own.push(restField(pairs, COMMON_ATTRS));
      }
      break;
    case 'include':
      own.push({ key: 'path', label: 'Include', type: 'text', value: node.attrs.path, group: 'block', placeholder: '/includes/header.html' });
      own.push(restField(pairs, COMMON_ATTRS));
      break;
    case 'component':
    case 'inline_component':
      own.push(...componentFields(node, ctx, pairs));
      break;
    case 'figure': case 'figcaption': case 'menu_item': case 'menu_item_blocks':
      own.push(restField(pairs, COMMON_ATTRS));
      break;
    case 'slot_ref': {
      const entry = context.slotLabels?.[node.attrs.name];
      own.push({ key: 'name', label: 'Region name', type: 'text', value: node.attrs.name, group: 'block' });
      own.push({ key: 'slot.label', label: 'Label', type: 'text', value: typeof entry === 'string' ? entry : '', group: 'block' });
      break;
    }
    case 'slot_piece':
      own.push(fillsField(node, context));
      break;
    case 'field':
      own.push({
        key: 'name', label: 'Field', type: 'combo', value: node.attrs.name, options: keyOptions(ctx), group: 'block',
        error: keyError(node.attrs.name, ctx, { condition: false }),
      });
      break;
    case 'comment':
      own.push({ key: 'text', label: 'Comment', type: 'textarea', value: node.attrs.text, group: 'block' });
      break;
    default:
      break;
  }
  return [...own, ...commonFields(node, ctx)];
}

// APPLY
// -----------------------------
/**
 * Why a field key (a field atom's, or Show only when's) isn't one Cook
 * accepts, or null. Shapes as Cook's checker: a plain key (`title`,
 * `post.title`) or, for a condition, `slot:<name>`. With a context, the
 * key's root must be a document, site or declared field or an alias in
 * scope, and a slot one the layout declares (as Cook's `unknown field`).
 * @param {string} key
 * @param {Object|null} context - null: the shape only
 * @param {{ condition: boolean }} opts
 */
export function keyError(key, context, { condition }) {
  const k = String(key ?? '').trim();
  if (condition && k === '') return null;
  const slot = condition ? k.match(SLOT_KEY) : null;
  if (!slot && !PLAIN_KEY.test(k)) {
    return condition ? `"${k}" must name one field, slot:name or item.field` : `"${k}" isn't a field name (like title or post.title)`;
  }
  if (!context) return null;
  const ctx = normalizeContext(context);
  if (slot) return ctx.slots.includes(slot[1]) ? null : `slot "${slot[1]}" isn't a region this layout declares`;
  const root = k.split('.')[0];
  const aliases = ctx.repeats.flatMap(r => [r.alias, r.index].filter(Boolean));
  const known = [...ctx.documentFields, ...ctx.siteFields, ...ctx.declaredFields, ...aliases];
  return known.includes(root) ? null : `unknown field "${k}"`;
}

/**
 * Why a value can't be set, or null.
 * @param {Object} node
 * @param {string|{ key: string }} field
 * @param {*} value
 * @param {Object|null} [context] - as inspectorFields (with `repeats` and `slots`); without it only shapes are checked
 * @returns {string|null}
 */
export function fieldError(node, field, value, context = null) {
  const key = typeof field === 'string' ? field : field.key;
  const type = typeOf(node);
  const v = typeof value === 'string' ? value.trim() : value;
  if (key === 'show.key') return keyError(v, context, { condition: true });
  if (key.startsWith('attr:') && reservedAttr(key.slice(5))) return `${key.slice(5)} can't be set here`;
  if (key === 'tag' && (type === 'component' || type === 'inline_component')) {
    if (!v) return COMPONENT_NAME_MESSAGE;
    if (!COMPONENT_TAG.test(v)) return COMPONENT_TAG_MESSAGE;
    if (LAYOUT_ELEMENTS.includes(v)) return `${v} is a layout element: add it as a container`;
  }
  if (key === 'name' && (type === 'slot_ref' || type === 'slot_piece')) {
    if (!SLOT_NAME.test(v)) return 'A region name starts with a letter and uses letters, digits, - and _';
    if (v === 'head' && type === 'slot_ref') return '"head" is kept for head items';
    const regions = type === 'slot_piece' ? parentRegions(context) : null;
    if (regions && !regions.some(r => r.name === v)) return noParentRegion(v);
  }
  if (key === 'name' && type === 'field') {
    const error = keyError(v, context, { condition: false });
    if (error) return error;
  }
  if ((key === 'repeat.limit' || key === 'repeat.offset') && v !== '' && !COUNT.test(String(v))) return 'Use a whole number';
  if (key === 'repeat.alias' && !ALIAS.test(v)) return 'Use a single word, like post';
  if (key === 'repeat.index' && v !== '' && !ALIAS.test(v)) return 'Use a single word, like i';
  if (key === 'attrs' && Array.isArray(value)) {
    const bad = value.find(([k]) => !/^[A-Za-z_:][-\w.:]*$/.test(k));
    if (bad) return `"${bad[0]}" isn't an attribute name`;
    const reserved = value.find(([k]) => reservedAttr(String(k).trim()));
    if (reserved) return `${reserved[0]} can't be set here`;
  }
  return null;
}

/** The condition fields on a node's attrs (node attrs, or data-if/data-unless pairs). */
function withCondition(node, attrs, key, mode) {
  const type = typeOf(node);
  if (hasCommon(type)) {
    attrs.if = null;
    attrs.unless = null;
    if (key !== '') attrs[mode] = key;
    return attrs;
  }
  let pairs = setPair(attrs.attrs, 'data-if', null);
  pairs = setPair(pairs, 'data-unless', null);
  if (key !== '') pairs = setPair(pairs, mode === 'unless' ? 'data-unless' : 'data-if', key);
  attrs.attrs = pairs;
  return attrs;
}

/**
 * The node attrs after a field change: the inspector puts them back with
 * `setNodeMarkup`. An invalid value (`fieldError`) leaves them as they were.
 * `slot.label` isn't a node attr (it lives in meta: `setSlotLabel`).
 * @param {Object} node
 * @param {string|{ key: string, taken?: string[] }} field
 * @param {*} value
 * @returns {Object} attrs
 */
export function applyField(node, field, value) {
  const key = typeof field === 'string' ? field : field.key;
  const attrs = structuredClone({ ...node.attrs });
  if (fieldError(node, key, value)) return attrs;
  const v = typeof value === 'string' ? value.trim() : value;
  const pairs = attrs.attrs || [];

  if (key.startsWith('attr:')) {
    const name = key.slice(5);
    let next;
    if (v === true) next = '';
    else if (v === false || v === null || (v === '' && !KEEP_EMPTY.includes(name))) next = null;
    else next = String(v);
    attrs.attrs = setPair(pairs, name, next);
    return attrs;
  }

  switch (key) {
    case 'tag':
    case 'path':
    case 'name':
    case 'text':
      attrs[key] = key === 'text' ? String(value) : v;
      return attrs;
    case 'data-layout':
      attrs.attrs = setPair(pairs, 'data-layout', v === '' ? null : v);
      return attrs;
    case 'attrs': {
      const taken = (typeof field === 'object' && field.taken) || inspectorFields(node).find(f => f.key === 'attrs')?.taken || [];
      const kept = pairs.filter(([k]) => taken.includes(k) || k === 'data-if' || k === 'data-unless');
      const given = (Array.isArray(value) ? value : [])
        .filter(([k]) => k && !taken.includes(k))
        .map(([k, val]) => [String(k).trim(), String(val ?? '')]);
      attrs.attrs = [...kept, ...given];
      return attrs;
    }
    case 'repeat.source':
      if (v === '') attrs.repeat = null;
      else if (attrs.repeat) attrs.repeat = { ...attrs.repeat, source: v };
      else attrs.repeat = { source: v, pipes: [], alias: defaultAlias(v) };
      return attrs;
    case 'repeat.limit':
    case 'repeat.offset':
      if (attrs.repeat) attrs.repeat = { ...attrs.repeat, pipes: setPipe(attrs.repeat.pipes, key.slice(7), String(v)) };
      return attrs;
    case 'repeat.alias':
      if (attrs.repeat) attrs.repeat = { ...attrs.repeat, alias: v };
      return attrs;
    case 'repeat.index':
      if (attrs.repeat) {
        const next = { ...attrs.repeat };
        if (v === '') delete next.index;
        else next.index = v;
        attrs.repeat = next;
      }
      return attrs;
    case 'show.key':
      return withCondition(node, attrs, v, conditionOf(node).mode);
    case 'show.mode': {
      const { key: cond } = conditionOf(node);
      return cond === '' ? attrs : withCondition(node, attrs, cond, v === 'unless' ? 'unless' : 'if');
    }
    default:
      return attrs;
  }
}

/**
 * Attrs (a node's, or a mark's) without any `slot:<name>` condition: the
 * `if`/`unless` node attrs cleared and `data-if`/`data-unless` pairs
 * dropped. Null when nothing names the slot.
 * @param {Object} attrs
 * @param {string} name
 * @returns {Object|null}
 */
export function dropSlotConditions(attrs, name) {
  const old = `slot:${name}`;
  let changed = false;
  const out = { ...attrs };
  for (const k of ['if', 'unless']) {
    if (typeof out[k] === 'string' && out[k].trim() === old) { out[k] = null; changed = true; }
  }
  if (Array.isArray(out.attrs)) {
    const kept = out.attrs.filter(([k, v]) => !((k === 'data-if' || k === 'data-unless') && String(v).trim() === old));
    if (kept.length !== out.attrs.length) { out.attrs = kept; changed = true; }
  }
  return changed ? out : null;
}

/**
 * Attrs (a node's, or a mark's) with every `slot:<from>` condition renamed
 * to `slot:<to>`: the `if`/`unless` node attrs and `data-if`/`data-unless`
 * pairs. Null when nothing names the slot.
 * @param {Object} attrs
 * @param {string} from
 * @param {string} to
 * @returns {Object|null}
 */
export function renameSlotConditions(attrs, from, to) {
  const old = `slot:${from}`;
  let changed = false;
  const out = { ...attrs };
  for (const k of ['if', 'unless']) {
    if (typeof out[k] === 'string' && out[k].trim() === old) { out[k] = `slot:${to}`; changed = true; }
  }
  if (Array.isArray(out.attrs)) {
    out.attrs = out.attrs.map(([k, v]) => {
      if ((k === 'data-if' || k === 'data-unless') && String(v).trim() === old) { changed = true; return [k, `slot:${to}`]; }
      return [k, v];
    });
  }
  return changed ? out : null;
}

// MARKS
// -----------------------------
/** The attribute each inline element has a field for. */
export const MARK_ATTRS = { a: 'href', time: 'datetime', abbr: 'title' };

/**
 * The range `[from, to)` of one mark instance around a position in a
 * textblock: the neighbouring inline nodes that carry a mark equal to it.
 * @param {import('prosemirror-model').ResolvedPos} $pos - inside the textblock
 * @param {import('prosemirror-model').Mark} mark
 * @returns {{ from: number, to: number }|null}
 */
export function markRange($pos, mark) {
  const parent = $pos.parent;
  const start = $pos.start();
  const children = [];
  parent.forEach((child, offset) => children.push({ child, from: start + offset, to: start + offset + child.nodeSize }));
  let at = children.findIndex(c => c.from <= $pos.pos && $pos.pos < c.to && mark.isInSet(c.child.marks));
  if (at === -1) at = children.findIndex(c => c.to === $pos.pos && mark.isInSet(c.child.marks));
  if (at === -1) return null;
  let first = at;
  let last = at;
  while (first > 0 && mark.isInSet(children[first - 1].child.marks)) first--;
  while (last < children.length - 1 && mark.isInSet(children[last + 1].child.marks)) last++;
  return { from: children[first].from, to: children[last].to };
}

/** Whether `[from, to)` holds or sits inside a link: a new link there would nest. */
export function linkWouldNest(doc, from, to) {
  const type = doc.type.schema.marks.a;
  if (doc.rangeHasMark(from, to, type)) return true;
  const $from = doc.resolve(from);
  return Boolean(type.isInSet($from.marks())) && Boolean($from.nodeAfter && type.isInSet($from.nodeAfter.marks));
}
