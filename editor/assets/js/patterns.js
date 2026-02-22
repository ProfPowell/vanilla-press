/**
 * Multi-block pattern registry for the slash command palette.
 *
 * Each pattern creates an array of ProseMirror nodes that are inserted
 * as a group. Patterns appear in the palette under a "Patterns" category.
 *
 * @module editor/patterns
 */

import { schema } from './schema.js';
import { getBlockPalette } from './components/block-palette.js';

function text(value, marks) {
  const pmMarks = marks ? marks.map(m => schema.marks[m].create()) : [];
  return schema.text(value, pmMarks);
}

function paragraph(content) {
  const children = content ? (Array.isArray(content) ? content : [text(content)]) : [];
  return schema.nodes.paragraph.create(null, children);
}

function heading(level, content) {
  return schema.nodes.heading.create({ level }, [text(content)]);
}

const patterns = [
  {
    id: 'pattern_faq',
    label: 'FAQ Section',
    description: 'Heading + 3 collapsible Q&A items',
    icon: '?',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      heading(2, 'FAQ'),
      schema.nodes.collapsible.create({ summary: 'What is this?' }, [
        paragraph('Answer goes here.'),
      ]),
      schema.nodes.collapsible.create({ summary: 'How does it work?' }, [
        paragraph('Explanation goes here.'),
      ]),
      schema.nodes.collapsible.create({ summary: 'Where can I learn more?' }, [
        paragraph('Resources go here.'),
      ]),
    ],
  },
  {
    id: 'pattern_tutorial',
    label: 'Tutorial',
    description: 'Step-by-step getting started guide',
    icon: '\ud83d\udcda',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      heading(2, 'Getting Started'),
      schema.nodes.steps.create(null, [
        schema.nodes.step.create({ title: 'Prerequisites' }, [
          paragraph('List what you need before starting.'),
        ]),
        schema.nodes.step.create({ title: 'Installation' }, [
          paragraph('How to install or set up.'),
        ]),
        schema.nodes.step.create({ title: 'First Steps' }, [
          paragraph('Walk through the initial setup.'),
        ]),
      ]),
    ],
  },
  {
    id: 'pattern_features',
    label: 'Feature Cards',
    description: 'Heading + 3 feature highlight cards',
    icon: '\u2605',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      heading(2, 'Features'),
      schema.nodes.card.create({ href: '' }, [
        paragraph([text('Feature One', ['strong'])]),
        paragraph('Description of the first feature.'),
      ]),
      schema.nodes.card.create({ href: '' }, [
        paragraph([text('Feature Two', ['strong'])]),
        paragraph('Description of the second feature.'),
      ]),
      schema.nodes.card.create({ href: '' }, [
        paragraph([text('Feature Three', ['strong'])]),
        paragraph('Description of the third feature.'),
      ]),
    ],
  },
  {
    id: 'pattern_code_example',
    label: 'Code Example',
    description: 'Annotated code with description',
    icon: '{}',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      heading(2, 'Example'),
      paragraph('Here is how it works:'),
      schema.nodes.code_block.create({ language: 'js' }),
    ],
  },
  {
    id: 'pattern_hero',
    label: 'Hero Image',
    description: 'Full-width image + heading + intro',
    icon: '\ud83c\udf05',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      schema.nodes.figure.create({ src: '', alt: '' }),
      heading(2, 'Title'),
      paragraph('Introductory paragraph goes here.'),
    ],
  },
  {
    id: 'pattern_comparison',
    label: 'Comparison Tabs',
    description: 'Before/After tabbed comparison',
    icon: '\u21c4',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      heading(2, 'Comparison'),
      schema.nodes.tabs.create(null, [
        schema.nodes.tab.create({ label: 'Before' }, [
          paragraph('Describe the before state.'),
        ]),
        schema.nodes.tab.create({ label: 'After' }, [
          paragraph('Describe the after state.'),
        ]),
      ]),
    ],
  },
  {
    id: 'pattern_warning_box',
    label: 'Warning Box',
    description: 'Important notice with bold lead',
    icon: '\u26a0',
    category: 'pattern',
    isPattern: true,
    createNodes: () => [
      schema.nodes.callout.create({ variant: 'danger' }, [
        paragraph([text('Important:', ['strong']), text(' Read this before proceeding.')]),
      ]),
    ],
  },
];

/**
 * Initialize patterns by registering them with the block palette.
 */
export function initPatterns() {
  const palette = getBlockPalette();
  palette.registerPatterns(patterns);
}
