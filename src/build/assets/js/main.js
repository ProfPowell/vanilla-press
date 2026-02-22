/**
 * Minimal progressive enhancement.
 * - Copy button on code blocks
 * - Clickable cards (navigate to href)
 */

// Copy button for code-block elements
for (const block of document.querySelectorAll('code-block')) {
  const pre = block.querySelector('pre');
  if (!pre) continue;

  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    const code = pre.querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    }
  });
  block.appendChild(btn);
}

// Clickable cards
for (const card of document.querySelectorAll('content-card[href]')) {
  card.addEventListener('click', (e) => {
    // Don't navigate if user clicked an actual link inside the card
    if (e.target.closest('a')) return;
    const href = card.getAttribute('href');
    if (href) window.location.href = href;
  });
}
