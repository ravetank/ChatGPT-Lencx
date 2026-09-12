/**
 * @name export.js
 * @version 0.2.0-masamune.1
 * @url https://github.com/ravetank/ChatGPT-Lencx/tree/masamune/chatgpt-modern/scripts/export.js
 */

(() => {
  'use strict';

  const NS = '__MASAMUNE_EXPORT__';
  const VERSION = '0.2.0-masamune.1';
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
    return Array.from(document.querySelectorAll(MESSAGE_SELECTOR)).filter(
      (node) => !node.parentElement?.closest(MESSAGE_SELECTOR),
    );
  }

  function getContentRoot(message) {
    return (
      message.querySelector('.markdown') ||
      message.querySelector('[class*="markdown"]') ||
      message.querySelector('.whitespace-pre-wrap') ||
      message
    );
  }

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('button, svg, form, input, textarea, script, style, noscript')
      .forEach((el) => el.remove());
    clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    return clone;
  }

  function getConversationTitle() {
    const activeLink = Array.from(document.querySelectorAll('a[href]')).find((a) => {
      try {
        return new URL(a.href, location.href).pathname === location.pathname;
      } catch {
        return false;
      }
    });
    const fromSidebar = activeLink?.textContent?.trim();
    if (fromSidebar) return fromSidebar;
    const fromDocument = document.title?.replace(/\s*[|–-]\s*ChatGPT\s*$/i, '')?.trim();
    return fromDocument || 'ChatGPT Conversation';
  }

  function markdownForMessage(message, converter) {
    const role = message.getAttribute('data-message-author-role') || 'unknown';
    const label = ROLE_LABELS[role] || role;
    const root = cleanClone(getContentRoot(message));
    const body = converter.turndown(root.innerHTML).trim();
    if (!body) return '';
    return `## ${label}\n\n${body}`;
  }

  function buildMarkdown() {
    const converter = getConverter();
    if (!converter) throw new Error('Markdown converter is unavailable.');

    const messages = getMessages();
    if (!messages.length) throw new Error('No ChatGPT messages were found on this page.');

    const title = getConversationTitle();
    const parts = messages.map((message) => markdownForMessage(message, converter)).filter(Boolean);

    return [
      `# ${title}`,
      '',
      `> Exported from ${location.href}`,
      '',
      ...parts.flatMap((part, index) => (index ? ['---', '', part] : [part])),
      '',
    ].join('\n');
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

      const content = buildMarkdown();
      const id = makeId();
      const filename = getConversationTitle();

      await window.invoke('save_file', {
        name: `notes/${id}.md`,
        content,
      });
      await window.invoke('download_list', {
        pathname: 'chat.notes.json',
        filename,
        id,
        dir: 'notes',
      });

      console.info(`[MASAMUNE export] Markdown saved: notes/${id}.md`);
      showToast('Markdown export saved to ChatGPT Notes');
      return { id, filename, chars: content.length };
    } catch (error) {
      console.error('[MASAMUNE export] Markdown export failed:', error);
      showToast(`Markdown export failed: ${error.message || error}`, true);
      return null;
    }
  }

  function diagnostics() {
    const messages = getMessages();
    return {
      version: VERSION,
      href: location.href,
      converterReady: Boolean(getConverter()),
      messageCount: messages.length,
      roles: messages.map((m) => m.getAttribute('data-message-author-role')),
      title: getConversationTitle(),
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
