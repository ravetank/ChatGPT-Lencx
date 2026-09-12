/**
 * @name markdown.export.js
 * @version 0.2.0-masamune.1
 * @url https://github.com/ravetank/ChatGPT-Lencx/tree/masamune/chatgpt-modern/scripts/markdown.export.js
 */

var ExportMD = (() => {
  'use strict';

  const VERSION = '0.2.0-masamune.1';
  const Turndown = window.TurndownService;
  const plugins = window.turndownPluginGfm;

  if (typeof Turndown !== 'function') {
    console.error('[MASAMUNE md] TurndownService is unavailable');
    return null;
  }

  const service = new Turndown({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  if (plugins?.gfm) service.use(plugins.gfm);

  function fenceFor(text) {
    const runs = String(text).match(/`+/g) || [];
    const longest = runs.reduce((n, run) => Math.max(n, run.length), 0);
    return '`'.repeat(Math.max(3, longest + 1));
  }

  service.addRule('masamune-pre', {
    filter: 'pre',
    replacement(_content, node) {
      const code = node.querySelector('code');
      const text = (code?.textContent || node.textContent || '').replace(/\n$/, '');
      const classes = `${node.className || ''} ${code?.className || ''}`;
      const lang = classes.match(/language-([a-z0-9_+.-]+)/i)?.[1] || '';
      const fence = fenceFor(text);
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });

  service.addRule('masamune-katex', {
    filter(node) {
      return node.nodeName === 'SPAN' && node.classList?.contains('katex');
    },
    replacement(content, node) {
      if (node.parentElement?.closest('.katex')) return '';
      const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (!tex) return content;
      const block = Boolean(node.closest('.katex-display'));
      return block ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    },
  });

  service.addRule('masamune-ignore-ui', {
    filter: ['button', 'svg', 'form', 'input', 'textarea', 'script', 'style', 'noscript'],
    replacement: () => '',
  });

  window.__MASAMUNE_MD__ = {
    version: VERSION,
    turndown: (html) => service.turndown(html),
  };

  console.info(`[MASAMUNE md] initialized v${VERSION}`);
  return service;
})();
