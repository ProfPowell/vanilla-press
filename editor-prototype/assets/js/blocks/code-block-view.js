/**
 * CodeBlockView — NodeView for <code-block> elements.
 *
 * Features:
 * - Language selector dropdown
 * - Filename input
 * - Plain text editing (no marks)
 * - Tab inserts indentation (handled by keymap)
 * - Matches HTML renderer output: <code-block data-language data-filename><pre><code>
 *
 * @module editor/blocks/code-block-view
 */

const LANGUAGES = [
  'text', 'javascript', 'typescript', 'html', 'css', 'json',
  'bash', 'shell', 'python', 'ruby', 'go', 'rust', 'sql',
  'yaml', 'toml', 'xml', 'markdown', 'diff', 'graphql',
];

export class CodeBlockView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Build DOM to match HTML renderer: <code-block><pre><code>content</code></pre></code-block>
    this.dom = document.createElement('code-block');
    this.dom.classList.add('pm-node-view', 'pm-code-block');
    this.dom.setAttribute('data-language', node.attrs.language || 'text');
    if (node.attrs.filename) {
      this.dom.setAttribute('data-filename', node.attrs.filename);
    }

    // Controls overlay
    this.controls = document.createElement('div');
    this.controls.className = 'node-controls';
    this.controls.innerHTML = `
      <label>Lang:</label>
      <select class="lang-select">
        ${LANGUAGES.map(l => `<option value="${l}"${l === node.attrs.language ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <label>File:</label>
      <input type="text" class="filename-input" value="${node.attrs.filename || ''}" placeholder="filename"/>
    `;
    this.dom.appendChild(this.controls);

    // Wire up controls
    const langSelect = this.controls.querySelector('.lang-select');
    langSelect.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          language: langSelect.value,
        })
      );
    });

    const filenameInput = this.controls.querySelector('.filename-input');
    filenameInput.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, {
          ...this.node.attrs,
          filename: filenameInput.value,
        })
      );
    });
    // Prevent PM from grabbing keystrokes in the filename input
    filenameInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Content area: <pre><code>
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.classList.add('code-content');
    pre.appendChild(code);
    this.dom.appendChild(pre);

    // PM edits inside <code>
    this.contentDOM = code;
  }

  update(node) {
    if (node.type.name !== 'code_block') return false;
    this.node = node;

    // Update DOM attrs
    this.dom.setAttribute('data-language', node.attrs.language || 'text');
    if (node.attrs.filename) {
      this.dom.setAttribute('data-filename', node.attrs.filename);
    } else {
      this.dom.removeAttribute('data-filename');
    }

    // Sync controls
    const langSelect = this.controls.querySelector('.lang-select');
    if (langSelect.value !== node.attrs.language) {
      langSelect.value = node.attrs.language;
    }
    const filenameInput = this.controls.querySelector('.filename-input');
    if (filenameInput.value !== (node.attrs.filename || '')) {
      filenameInput.value = node.attrs.filename || '';
    }

    return true;
  }

  stopEvent(event) {
    // Let PM handle keyboard events in contentDOM
    // But stop events from controls
    return this.controls.contains(event.target);
  }

  ignoreMutation(mutation) {
    // Ignore changes to our controls
    return this.controls.contains(mutation.target);
  }
}
