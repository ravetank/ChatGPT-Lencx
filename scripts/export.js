/**
 * @name export.js
 * @version 0.2.0-masamune.2
 * @url https://github.com/ravetank/ChatGPT-Lencx/tree/masamune/chatgpt-modern/scripts/export.js
 */

(() => {
  'use strict';

  const NS = '__MASAMUNE_EXPORT__';
  const VERSION = '0.2.0-masamune.2';
  const MESSAGE_SELECTOR = '[data-message-author-role]';
  const ROLE_LABELS = {
    user: 'You',
    assistant: 'Assistant',
    system: 'System',
    tool: 'Tool',
  };

  function getConverter() {
    if (window.ExportMD?.turndown) return window.ExportMD;
    return null;
  }

  function getMessages() {
    const modern = Array.from(document.querySelectorAll('[data-content-search-unit-key]'));
    if (modern.length) {
      return modern.map(node => {
        const key = node.getAttribute('data-content-search-unit-key');
        const role = key?.split(':').pop() || 'unknown';
        return { node, role, key };
      }).filter(message => ['user', 'assistant', 'system', 'tool'].includes(message.role));
    }
    return Array.from(document.querySelectorAll(MESSAGE_SELECTOR))
      .filter(node => !node.parentElement?.closest(MESSAGE_SELECTOR))
      .map((node, i) => ({
        node,
        role: node.getAttribute('data-message-author-role') || 'unknown',
        key: node.getAttribute('data-message-id') || `legacy-${i}`,
      }));
  }

  function getContentRoot(message) {
    const node = message.node;
    if (node.hasAttribute('data-content-search-unit-key')) {
      return message.role === 'user' ?
        (node.querySelector('[data-user-message-bubble]') || node) : node;
    }
    const sections = node.querySelectorAll('.markdown');
    return sections.length === 1 ? sections[0] : node;
  }

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    for (const button of clone.querySelectorAll('button')) {
      if (button.matches('[data-user-message-bubble]') ||
          button.querySelector('[data-user-message-bubble], .markdown')) {
        button.replaceWith(...button.childNodes);
      } else {
        button.remove();
      }
    }
    clone.querySelectorAll('svg, form, input, textarea, script, style, noscript, [aria-hidden="true"]')
      .forEach(el => el.remove());
    return clone;
  }

  function getConversationTitle() {
    const pathname = location.pathname;
    const links = [...document.querySelectorAll('a[href*="/c/"]')];
    const active = links.filter(a => {
      try { return new URL(a.href, location.href).pathname === pathname; }
      catch { return false; }
    });
    const meaningful = value => value && value.length < 200 &&
      !/^(skip to content|chatgpt|new chat|conversations?)$/i.test(value);
    for (const a of active) {
      const candidate = (a.innerText || a.getAttribute('title') || a.textContent || '').trim();
      if (meaningful(candidate)) return candidate;
    }
    const pageTitle = (document.title || '')
      .replace(/\s*[|–-]\s*ChatGPT\s*$/i, '').trim();
    if (meaningful(pageTitle)) return pageTitle;
    return `ChatGPT Conversation ${pathname.split('/').pop()?.slice(0, 8) || ''}`.trim();
  }

  function markdownForMessage(message, converter) {
    const label = ROLE_LABELS[message.role] || message.role;
    const html = message.html ?? cleanClone(getContentRoot(message)).innerHTML;
    const body = converter.turndown(html).trim();
    if (!body) return '';
    return `## ${label}\n\n${body}`;
  }

  function buildMarkdown(messages = getMessages()) {
    const converter = getConverter();
    if (!converter) throw new Error('Markdown converter is unavailable.');
    if (!messages.length) throw new Error('No ChatGPT messages were found on this page.');
    const title = getConversationTitle();
    const parts = messages.map(m => markdownForMessage(m, converter)).filter(Boolean);
    if (!parts.length) throw new Error('Message containers were found, but their contents were empty.');
    return [
      `# ${title}`, '', `> Exported from ${location.href}`, '',
      ...parts.flatMap((part, i) => (i ? ['---', '', part] : [part])), '',
    ].join('\n');
  }

    async function collectMessages() {
    const found = new Map();
    function capture() {
      for (const message of getMessages()) {
        const html = cleanClone(getContentRoot(message)).innerHTML;
        if (html.trim()) found.set(message.key, { key: message.key, role: message.role, html });
      }
    }
    capture();
    const anchor = getMessages()[0]?.node;
    let scroller = null;
    for (let node = anchor?.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight + 100) {
        scroller = node;
        break;
      }
    }
    scroller ||= document.scrollingElement;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 100) {
      return [...found.values()];
    }
    const prior = scroller.scrollTop;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let completed = false;
    try {
      scroller.scrollTop = 0;
      await pause(180);
      const stepSize = Math.max(160, Math.floor(scroller.clientHeight * 0.6));
      let endCount = 0;
      for (let i = 0; i < 300; i++) {
        capture();
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (scroller.scrollTop >= max - 3) {
          if (++endCount >= 2) { completed = true; break; }
          await pause(140);
          continue;
        }
        endCount = 0;
        const previous = scroller.scrollTop;
        scroller.scrollTop = Math.min(max, previous + stepSize);
        await pause(125);
        if (scroller.scrollTop <= previous && max > previous + 3) {
          throw new Error('Conversation scroller cannot advance; export aborted to avoid missing messages.');
        }
      }
      capture();
    } finally {
      scroller.scrollTop = prior;
    }
    if (!completed) throw new Error('Conversation exceeds the automatic capture limit; export aborted to avoid truncation.');
    return [...found.values()];
  }

  function makeId() {
    return window.crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  }

  function showToast(message, isError = false) {
    document.getElementById('masamune-export-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'masamune-export-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '10px 14px',
      borderRadius: '8px',
      background: isError ? '#7f1d1d' : '#1f2937',
      color: '#fff',
      font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,.28)',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  async function exportMarkdown() {
    try {
      if (typeof window.invoke !== 'function') {
        throw new Error('Tauri invoke bridge is unavailable.');
      }
      const messages = await collectMessages();
      const content = buildMarkdown(messages);
      const id = makeId();
      const filename = getConversationTitle();
  
      await window.invoke('save_file', { name: `notes/${id}.md`, content });
      await window.invoke('download_list', {
        pathname: 'chat.notes.json', filename, id, dir: 'notes',
      });
  
      console.info(`[MASAMUNE export] Markdown saved: notes/${id}.md (${messages.length} messages)`);
      showToast(`Markdown saved (${messages.length} messages)`);
      return { id, filename, chars: content.length, messages: messages.length };
    } catch (error) {
      console.error('[MASAMUNE export] Markdown export failed:', error);
      showToast(`Markdown export failed: ${error.message || error}`, true);
      return null;
    }
  }

  function diagnostics() {
    const messages = getMessages();
    return {
      version: VERSION, href: location.href,
      converterReady: Boolean(getConverter()),
      messageCount: messages.length,
      roles: messages.map(m => m.role),
      title: getConversationTitle(),
      selector: document.querySelector('[data-content-search-unit-key]') ?
        '[data-content-search-unit-key]' : MESSAGE_SELECTOR,
    };
  }

  window[NS] = {
    version: VERSION,
    markdown: exportMarkdown,
    previewMarkdown: buildMarkdown,
    diagnostics,
    teardown() {
      document.getElementById('masamune-export-toast')?.remove();
      delete window[NS];
    },
  };

  console.info(`[MASAMUNE export] initialized v${VERSION}`);
})();
