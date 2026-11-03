/** Hand-built descriptor index for component tests. */
const d = (tag, kind, extra = {}) => ({
  tag, label: tag, icon: '', description: '', group: 'test', kind,
  defaults: {}, advanced: [], package: 'fixture', attributes: [], bundled: false, scriptPath: '', ...extra,
});

export const fixtureIndex = new Map([
  ['x-one', d('x-one', 'none', { attributes: [
    { name: 'mode', type: 'string', enum: ['a', 'b'] },
    { name: 'count', type: 'number' },
    { name: 'open', type: 'boolean' },
  ] })],
  ['x-text', d('x-text', 'text')],
  ['x-code', d('x-code', 'code', { codeWrap: 'template' })],
  ['x-blocks', d('x-blocks', 'blocks')],
  ['x-inline', d('x-inline', 'inline')],
]);
