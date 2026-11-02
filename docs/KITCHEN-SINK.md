# Kitchen Sink: Vanilla Breeze Feature Inventory

A comprehensive inventory of every Vanilla Breeze (VB) capability and how it maps to Vanilla Press (VP) content blocks.

## VP Content Block Inventory

### Block Types

| Block Type | Category | Content Model | Attrs | HTML Output | Fixture |
|---|---|---|---|---|---|
| `paragraph` | prose | inline | — | `<p>` | ks-prose |
| `heading` | prose | inline | level (2-6) | `<h2>`–`<h6>` | ks-prose |
| `blockquote` | prose | block | — | `<blockquote>` | ks-prose |
| `list` | prose | list_item | ordered | `<ul>` / `<ol>` | ks-prose |
| `list_item` | prose | block | — | `<li>` | ks-prose |
| `hr` | prose | leaf | variant (default, decorative) | `<hr/>` / `<hr class="decorative"/>` | ks-prose |
| `table` | prose | table_row | striped, bordered, compact, caption | `<table>` with classes | ks-tables |
| `table_row` | prose | [table_cell, table_header] | — | `<tr>` | ks-tables |
| `table_header` | prose | inline | align (left, center, right) | `<th>` | ks-tables |
| `table_cell` | prose | inline | align, numeric | `<td>` | ks-tables |
| `definition_list` | prose | [definition_term, definition_desc] | — | `<dl>` | ks-definitions |
| `definition_term` | prose | inline | — | `<dt>` | ks-definitions |
| `definition_desc` | prose | block | — | `<dd>` | ks-definitions |
| `figure` | media | [figcaption] | src, alt, variant | `<figure>` with class | ks-media |
| `figcaption` | media | inline | — | `<figcaption>` | ks-media |
| `embed` | media | leaf | url, type | `<div data-embed>` | ks-media |
| `code_block` | code | leaf (value) | language, filename | `<code-block>` | ks-code |
| `callout` | component | block | variant (note, tip, warning, danger) | `<status-message>` | ks-components |
| `collapsible` | component | block | summary | `<details>` | ks-components |
| `card` | component | block | href | `<layout-card>` | ks-components |
| `tabs` | component | tab | — | `<tab-set>` | ks-components |
| `tab` | component | block | label | `.tab-panel` | ks-components |
| `steps` | component | step | — | `<ol data-steps>` | ks-components |
| `step` | component | block | title | `<li data-step-title>` | ks-components |

### Inline Types

| Type | Attrs | HTML Output | Fixture |
|---|---|---|---|
| `text` | value, marks | plain text with mark wrappers | ks-prose |
| `link` | href, title | `<a href>` | ks-prose |
| `footnote_ref` | id | `<sup><a href="#fn-...">` | ks-prose |

### Marks

| Mark | HTML | Markdown | Fixture |
|---|---|---|---|
| `strong` | `<strong>` | `**text**` | ks-prose |
| `em` | `<em>` | `*text*` | ks-prose |
| `code` | `<code>` | `` `text` `` | ks-prose |
| `strikethrough` | `<s>` | `~~text~~` | ks-prose |
| `mark` | `<mark>` | `==text==` | ks-prose |
| `kbd` | `<kbd>` | `<kbd>text</kbd>` | ks-prose |
| `sub` | `<sub>` | `<sub>text</sub>` | ks-prose |
| `sup` | `<sup>` | `<sup>text</sup>` | ks-prose |

---

## Vanilla Breeze Feature Inventory

### Typography & Prose Elements

| Feature | VB Support | VP Block | Kitchen Sink Page |
|---|---|---|---|
| Headings h1-h6 | Styled | heading (h2-h6) | typography.html, ks-prose |
| Paragraphs | Styled | paragraph | typography.html, ks-prose |
| Blockquotes | Styled with cite | blockquote | typography.html, ks-prose |
| Lists (ul, ol) | Styled, nested | list | typography.html, ks-prose |
| Definition lists | Styled dl/dt/dd | definition_list | typography.html, ks-definitions |
| Tables | striped, bordered, compact, caption, numeric, alignment | table | typography.html, ks-tables |
| Figures | .full, .bordered, .float-start/end, .centered | figure (variant) | typography.html, ks-media |
| Code blocks | code-block custom element | code_block | typography.html, ks-code |
| Horizontal rules | hr, hr.decorative | hr (variant) | typography.html, ks-prose |
| kbd | `<kbd>` styling | kbd mark | typography.html, ks-prose |
| mark | `<mark>` highlight | mark mark | typography.html, ks-prose |
| abbr | `<abbr>` with dotted underline | — (static only) | typography.html |
| small | `<small>` | — (static only) | typography.html |
| address | `<address>` | — (static only) | typography.html |
| hgroup | `<hgroup>` | — (static only) | typography.html |
| sub/sup | `<sub>` / `<sup>` | sub/sup marks | typography.html, ks-prose |

### Layout System

| Layout | data-layout Value | VP Block | Kitchen Sink Page |
|---|---|---|---|
| Stack | `stack` | — | layout.html |
| Cluster | `cluster` | — | layout.html |
| Grid | `grid` | — | layout.html |
| Center | `center` | — | layout.html |
| Split | `split` | — | layout.html |
| Sidebar | `sidebar` | — | layout.html |
| Holy Grail | `holy-grail` | — | layout.html |
| Dashboard | `dashboard` | — | layout.html |
| Cover | `cover` | — | layout.html |
| Switcher | `switcher` | — | layout.html |
| Prose | `prose` | — | layout.html |
| Regions | `regions` | — | layout.html |
| Media | `media` | — | layout.html |

### CSS-Only Custom Elements

| Element | Purpose | VP Block | Kitchen Sink Page |
|---|---|---|---|
| `layout-stack` | Vertical stack with gap | — | custom-elements.html |
| `layout-cluster` | Horizontal cluster | — | custom-elements.html |
| `layout-grid` | Auto-fit grid | — | custom-elements.html |
| `layout-center` | Centered content | — | custom-elements.html |
| `layout-sidebar` | Main + sidebar | — | custom-elements.html |
| `layout-cover` | Cover layout | — | custom-elements.html |
| `layout-switcher` | Responsive switch | — | custom-elements.html |
| `layout-reel` | Horizontal scroll | — | custom-elements.html |
| `layout-imposter` | Overlay positioning | — | custom-elements.html |
| `semantic-card` | Card with slots | — | custom-elements.html |
| `layout-card` | Simple card | — | custom-elements.html |
| `layout-badge` | Badge/chip | — | custom-elements.html |
| `status-message` | Status display (info/success/warning/error) | — | custom-elements.html |
| `user-avatar` | User avatar display | — | custom-elements.html |
| `brand-mark` | Brand logo/mark | — | custom-elements.html |
| `text-divider` | Divider with text | — | custom-elements.html |
| `loading-spinner` | Loading indicator | — | custom-elements.html |
| `progress-ring` | Circular progress | — | custom-elements.html |
| `token-swatch` | Color/token preview | — | custom-elements.html |
| `form-field` | Form field wrapper | — | custom-elements.html, forms.html |

### JS-Enhanced Web Components

| Component | Purpose | VP Block | Kitchen Sink Page |
|---|---|---|---|
| `accordion-wc` | Collapsible sections | collapsible (single) | web-components.html |
| `tabs-wc` | Tab panels | tabs | web-components.html |
| `tooltip-wc` | Tooltip popover | — | web-components.html |
| `dropdown-wc` | Dropdown menu | — | web-components.html |
| `toast-wc` | Toast notifications | — | web-components.html |
| `footnotes-wc` | Footnote management | footnote_ref (inline) | web-components.html |
| `icon-wc` | Icon display | — | web-components.html |
| `table-wc` | Enhanced table | table (content model) | web-components.html |
| `search-wc` | Search interface | — | web-components.html |
| `card-list` | Card grid | card (single) | web-components.html |
| `flip-card-wc` | Card flip animation | — | web-components.html |
| `comparison-wc` | Before/after slider | — | web-components.html |
| `splitter-wc` | Resizable panels | — | web-components.html |
| `carousel-wc` | Image carousel | — | web-components.html |
| `rating-wc` | Star rating | — | web-components.html |
| `combobox-wc` | Combo box input | — | web-components.html |
| `tags-wc` | Tag input | — | web-components.html |
| `context-menu-wc` | Context menu | — | web-components.html |
| `command-wc` | Command palette | — | web-components.html |
| `shortcuts-wc` | Keyboard shortcuts | — | web-components.html |
| `qr-code-wc` | QR code generator | — | web-components.html |
| `slide-accept-wc` | Slide to confirm | — | web-components.html |

### Data Attribute Utilities

| Attribute | Purpose | VP Block | Kitchen Sink Page |
|---|---|---|---|
| `data-copy` | Copy to clipboard | — | data-attributes.html |
| `data-spoiler` | Hidden/spoiler text | — | data-attributes.html |
| `data-switch` | Toggle switch | — | data-attributes.html |
| `data-hotkey` | Keyboard shortcut | — | data-attributes.html |
| `data-mask` | Input masking | — | data-attributes.html |
| `data-count` | Character counter | — | data-attributes.html |
| `data-grow` | Auto-resize textarea | — | data-attributes.html |
| `data-show-when` | Conditional show | — | data-attributes.html |
| `data-hide-when` | Conditional hide | — | data-attributes.html |
| `data-range` | Range slider | — | data-attributes.html |
| `data-upload` | File upload | — | data-attributes.html |
| `data-toggle-tags` | Tag toggle | — | data-attributes.html |
| `data-stepper` | Number stepper | — | data-attributes.html |
| `data-color` | Color picker | — | data-attributes.html |
| `data-gradient-text` | Gradient text effect | — | data-attributes.html |
| `data-shimmer` | Shimmer effect | — | data-attributes.html |
| `data-glitch` | Glitch text effect | — | data-attributes.html |
| `data-reveal` | Scroll reveal | — | data-attributes.html |
| `data-blur-reveal` | Blur reveal on hover | — | data-attributes.html |
| `data-highlight` | Text highlight | — | data-attributes.html |
| `data-typewriter` | Typewriter effect | — | data-attributes.html |
| `data-scramble` | Text scramble | — | data-attributes.html |
| `data-ticker` | Ticker/marquee | — | data-attributes.html |
| `data-format-number` | Number formatting | — | data-attributes.html |
| `data-format-bytes` | Byte formatting | — | data-attributes.html |
| `data-format-date` | Date formatting | — | data-attributes.html |

### Form Elements

| Element | VP Block | Kitchen Sink Page |
|---|---|---|
| Input types (text, email, password, number, date, etc.) | — | forms.html |
| Textarea | — | forms.html |
| Select (single, multiple) | — | forms.html |
| Fieldset/legend | — | forms.html |
| Form layouts (.stacked, .inline, .grid) | — | forms.html |
| Validation states | — | forms.html |

### Buttons

| Variant | Kitchen Sink Page |
|---|---|
| Default | buttons.html |
| .secondary | buttons.html |
| .ghost | buttons.html |
| .small / .large | buttons.html |
| .full-width | buttons.html |
| a.button (link) | buttons.html |
| Button groups | buttons.html |

### Themes

| Theme | Category | Kitchen Sink Page |
|---|---|---|
| Default | default | themes.html |
| Ocean | color | themes.html |
| Forest | color | themes.html |
| Sunset | color | themes.html |
| Rose | color | themes.html |
| Lavender | color | themes.html |
| Coral | color | themes.html |
| Slate | color | themes.html |
| Emerald | color | themes.html |
| Amber | color | themes.html |
| Indigo | color | themes.html |
| Modern | personality | themes.html |
| Minimal | personality | themes.html |
| Classic | personality | themes.html |
| Brutalist | extreme | themes.html |
| Swiss | extreme | themes.html |
| Cyber | extreme | themes.html |
| Organic | extreme | themes.html |
| Editorial | extreme | themes.html |
| Terminal | extreme | themes.html |
| Kawaii | extreme | themes.html |
| 8-Bit | extreme | themes.html |
| NES | extreme | themes.html |
| Win9x | extreme | themes.html |

---

## Gap Analysis

### Features Not Covered by VP Content Blocks

These VB features are interactive/layout concerns that don't map to a content model:

| Feature | Reason |
|---|---|
| Layout primitives (data-layout) | Layout is a presentation concern, not content |
| CSS-only layout elements (layout-stack, etc.) | Same — layout, not content |
| Form elements | Forms are interactive, not static content |
| Button variants | Presentation styling, not content structure |
| Themes | Applied at page level, not per-block |
| Most web components (tooltip, dropdown, toast, etc.) | Interactive UI, not document content |
| Data attribute utilities | Behavioral enhancements, not content |
| `comparison-wc` | Needs paired images — could be a future block |
| `carousel-wc` | Multi-image — could extend figure in the future |
| `geo-map` | Needs API key and coordinates — not content |
| `abbr` | Rare inline element — could be a mark in the future |
| `small` | Presentation, not semantic content |

### VP Blocks That Map to VB Components

These VP blocks have direct VB counterparts:

| VP Block | VB Component |
|---|---|
| callout | `<status-message>` |
| collapsible | `<details>` (native + VB styling) |
| card | `<layout-card>` |
| tabs | `<tab-set>` |
| steps | `<ol data-steps>` |
| code_block | `<code-block>` |
| table | `<table>` (with VB classes) |
| figure | `<figure>` (with VB variant classes) |
| hr.decorative | `<hr class="decorative">` |

### Future Expansion Candidates

| Feature | Potential VP Block | Priority |
|---|---|---|
| `abbr` | New inline mark | Low |
| `carousel-wc` | Multi-figure container | Medium |
| `comparison-wc` | Before/after figure | Low |
| `footnotes-wc` | Footnote section block | Medium |
| `rating-wc` | Rating display block | Low |
