/**
 * @name cmd.js
 * @version 0.2.0-masamune.4
 * @url https://github.com/ravetank/ChatGPT-Lencx/tree/masamune/chatgpt-modern/scripts/cmd.js
 *
 * MASAMUNE-maintained slash-command integration for modern ChatGPT.
 * Keeps the original Tauri get_chat_prompt_cmd backend, but replaces the
 * 2023 form/textarea DOM assumptions with an idempotent, SPA-safe adapter.
 */

(() => {
  'use strict';

  const NS = '__MASAMUNE_CHAT_CMD__';
  const VERSION = '0.2.0-masamune.4';
  const STYLE_ID = 'masamune-chat-cmd-style';
  const POPUP_ID = 'masamune-chat-cmd-popup';

  // Tear down an earlier injection cleanly. This matters because Tauri
  // initialization scripts can run again across navigation/webview lifecycle.
  try {
    window[NS]?.teardown?.();
  } catch (error) {
    console.warn('[MASAMUNE cmd] previous teardown failed:', error);
  }

  const state = {
    editor: null,
    commands: [],
    filtered: [],
    selectedIndex: 0,
    popup: null,
    style: null,
    observer: null,
    attachFrame: 0,
    visible: false,
    loading: false,
    lastError: null,
    lastExpandMs: null,
    lastInsertMethod: null,
    lastPromptChars: null,
  };

  const editorSelectors = [
    'div#prompt-textarea.ProseMirror[contenteditable="true"]',
    'div#prompt-textarea[contenteditable="true"]',
    '[data-testid="prompt-textarea"][contenteditable="true"]',
    'form [contenteditable="true"][role="textbox"]',
    'textarea#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    'form textarea',
  ];

  function isVisibleEditor(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    return true;
  }

  function findEditor() {
    for (const selector of editorSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (isUsableEditor(candidate)) return candidate;
      }
    }
    return null;
  }

  function isUsableEditor(node) {
    if (!(node instanceof HTMLElement) || !isVisibleEditor(node)) return false;

    // ChatGPT briefly mounts this hidden mirror textarea while constructing
    // the real ProseMirror composer. Never bind slash commands to it.
    if (node instanceof HTMLTextAreaElement && node.classList.contains('wcDTda_fallbackTextarea')) {
      return false;
    }

    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      if (node.disabled || node.readOnly) return false;
      if (node.getClientRects().length === 0) return false;
      return true;
    }

    return node.isContentEditable || node.getAttribute('contenteditable') === 'true';
  }

  function readEditor(editor = state.editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return editor.value ?? '';
    }
    return (editor.innerText ?? editor.textContent ?? '').replace(/\u00a0/g, ' ');
  }

  function dispatchInput(editor, text) {
    try {
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }),
      );
    } catch {
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  function selectEditorContents(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setEditor(text) {
    const editor = state.editor;
    if (!editor) return false;

    const started = performance.now();
    state.lastPromptChars = text.length;
    state.lastInsertMethod = null;
    state.lastExpandMs = null;

    editor.focus();

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto =
        editor instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

      if (descriptor?.set) {
        descriptor.set.call(editor, text);
      } else {
        editor.value = text;
      }

      dispatchInput(editor, text);
      editor.setSelectionRange?.(text.length, text.length);

      state.lastInsertMethod = 'native-value';
      state.lastExpandMs = performance.now() - started;
      return true;
    }

    let inserted = false;
    try {
      selectEditorContents(editor);
      inserted = document.execCommand?.('insertText', false, text) === true;
    } catch {
      inserted = false;
    }

    if (!inserted) {
      editor.textContent = text;
      dispatchInput(editor, text);
      state.lastInsertMethod = 'textContent-fallback';
    } else {
      // ChatGPT/ProseMirror has already processed the insertion here.
      // Dispatching a second synthetic input event caused large prompts to
      // be processed twice and produced severe latency in the v1 test.
      state.lastInsertMethod = 'execCommand';
    }

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Cursor positioning is cosmetic; input still succeeded.
    }

    state.lastExpandMs = performance.now() - started;
    return true;
  }

  function ensureStyle() {
    document.getElementById(STYLE_ID)?.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${POPUP_ID} {
        position: fixed;
        display: none;
        z-index: 2147483000;
        max-height: min(320px, 45vh);
        overflow-y: auto;
        padding: 6px;
        border: 1px solid rgba(127, 127, 127, 0.30);
        border-radius: 12px;
        background: var(--main-surface-primary, var(--surface-primary, #fff));
        color: var(--text-primary, #111);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
        font-family: inherit;
        font-size: 13px;
        box-sizing: border-box;
      }

      #${POPUP_ID}[data-open="true"] {
        display: block;
      }

      #${POPUP_ID} .masamune-cmd-item {
        display: grid;
        grid-template-columns: minmax(90px, 0.35fr) minmax(120px, 1fr);
        gap: 12px;
        align-items: center;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }

      #${POPUP_ID} .masamune-cmd-item:hover,
      #${POPUP_ID} .masamune-cmd-item[data-selected="true"] {
        background: rgba(127, 127, 127, 0.16);
      }

      #${POPUP_ID} .masamune-cmd-name {
        overflow: hidden;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${POPUP_ID} .masamune-cmd-act {
        overflow: hidden;
        opacity: 0.68;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${POPUP_ID} .masamune-cmd-empty {
        padding: 9px 10px;
        opacity: 0.65;
      }
    `;

    document.head.appendChild(style);
    state.style = style;
  }

  function ensurePopup() {
    document.getElementById(POPUP_ID)?.remove();

    const popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', 'ChatGPT prompt commands');
    popup.dataset.open = 'false';

    // mousedown occurs before editor blur. Preventing default keeps focus stable.
    popup.addEventListener('mousedown', (event) => {
      const item = event.target.closest?.('.masamune-cmd-item');
      if (!item) return;
      event.preventDefault();

      const index = Number(item.dataset.index);
      if (Number.isInteger(index)) {
        choose(index);
      }
    });

    document.body.appendChild(popup);
    state.popup = popup;
  }

  async function loadCommands(force = false) {
    if (state.loading) return state.commands;
    if (state.commands.length && !force) return state.commands;

    state.loading = true;
    state.lastError = null;

    try {
      if (typeof window.invoke !== 'function') {
        throw new Error('Tauri invoke bridge is not available');
      }

      const payload = (await window.invoke('get_chat_prompt_cmd')) || {};
      const raw = Array.isArray(payload.data) ? payload.data : [];

      state.commands = raw
        .filter(
          (item) =>
            item &&
            typeof item.cmd === 'string' &&
            item.cmd.trim() &&
            typeof item.prompt === 'string' &&
            item.prompt.trim() &&
            item.enable !== false,
        )
        .map((item) => ({
          cmd: item.cmd.trim(),
          act: typeof item.act === 'string' ? item.act.trim() : '',
          prompt: item.prompt,
          tags: Array.isArray(item.tags) ? item.tags : [],
        }))
        .sort((a, b) => a.cmd.localeCompare(b.cmd));

      console.info(
        `[MASAMUNE cmd] loaded ${state.commands.length} slash command(s), version ${VERSION}`,
      );
    } catch (error) {
      state.lastError = String(error?.message || error);
      state.commands = [];
      console.error('[MASAMUNE cmd] command load failed:', error);
    } finally {
      state.loading = false;
    }

    return state.commands;
  }

  function currentQuery() {
    const value = readEditor();
    if (!value.startsWith('/') || value.includes('\n')) return null;

    const body = value.slice(1);
    const firstWhitespace = body.search(/\s/);
    const token = (firstWhitespace === -1 ? body : body.slice(0, firstWhitespace)).trim();
    const remainder = firstWhitespace === -1 ? '' : body.slice(firstWhitespace).trimStart();

    return { raw: value, token, remainder };
  }

  function filterCommands(token) {
    const query = token.toLocaleLowerCase();
    if (!query) return state.commands.slice(0, 80);

    const starts = [];
    const contains = [];

    for (const command of state.commands) {
      const cmd = command.cmd.toLocaleLowerCase();
      if (cmd.startsWith(query)) starts.push(command);
      else if (cmd.includes(query)) contains.push(command);
    }

    return [...starts, ...contains].slice(0, 80);
  }

  function positionPopup() {
    if (!state.visible || !state.popup || !state.editor?.isConnected) return;

    const rect = state.editor.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const preferredWidth = Math.max(300, Math.min(620, rect.width));

    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, viewportWidth - preferredWidth - margin),
    );

    state.popup.style.left = `${Math.round(left)}px`;
    state.popup.style.width = `${Math.round(preferredWidth)}px`;
    state.popup.style.bottom = `${Math.round(window.innerHeight - rect.top + margin)}px`;
  }

  function hidePopup() {
    state.visible = false;
    state.filtered = [];
    state.selectedIndex = 0;

    if (state.popup) {
      state.popup.dataset.open = 'false';
      state.popup.replaceChildren();
    }
  }

  function renderPopup(commands) {
    if (!state.popup) ensurePopup();

    state.filtered = commands;
    state.selectedIndex = Math.min(
      Math.max(state.selectedIndex, 0),
      Math.max(commands.length - 1, 0),
    );

    const fragment = document.createDocumentFragment();

    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'masamune-cmd-empty';
      empty.textContent = 'No matching prompt commands';
      fragment.appendChild(empty);
    } else {
      commands.forEach((command, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'masamune-cmd-item';
        button.dataset.index = String(index);
        button.dataset.selected = String(index === state.selectedIndex);
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === state.selectedIndex));
        button.title = command.prompt;

        const name = document.createElement('span');
        name.className = 'masamune-cmd-name';
        name.textContent = `/${command.cmd}`;

        const act = document.createElement('span');
        act.className = 'masamune-cmd-act';
        act.textContent = command.act || command.prompt;

        button.append(name, act);
        fragment.appendChild(button);
      });
    }

    state.popup.replaceChildren(fragment);
    state.popup.dataset.open = 'true';
    state.visible = true;
    positionPopup();
    scrollSelectionIntoView();
  }

  function scrollSelectionIntoView() {
    const selected = state.popup?.querySelector(
      `.masamune-cmd-item[data-index="${state.selectedIndex}"]`,
    );
    selected?.scrollIntoView?.({ block: 'nearest' });
  }

  function updateSelection(nextIndex) {
    if (!state.filtered.length || !state.popup) return;

    const count = state.filtered.length;
    state.selectedIndex = (nextIndex + count) % count;

    for (const item of state.popup.querySelectorAll('.masamune-cmd-item')) {
      const selected = Number(item.dataset.index) === state.selectedIndex;
      item.dataset.selected = String(selected);
      item.setAttribute('aria-selected', String(selected));
    }

    scrollSelectionIntoView();
  }

  function materializePrompt(command, remainder) {
    let prompt = command.prompt;

    // Modernized convenience: `/command some text` substitutes the first
    // {...} placeholder directly. `/command` alone inserts the original
    // template unchanged so nothing is silently destroyed.
    if (remainder && /\{[^{}]*\}/.test(prompt)) {
      prompt = prompt.replace(/\{[^{}]*\}/, remainder);
    }

    return prompt;
  }

  function choose(index = state.selectedIndex) {
    const command = state.filtered[index];
    const query = currentQuery();
    if (!command || !query) return false;

    const prompt = materializePrompt(command, query.remainder);
    hidePopup();

    const changed = setEditor(prompt);

    if (changed) {
      console.info(
        `[MASAMUNE cmd] expanded /${command.cmd} (${prompt.length} chars) via ${
          state.lastInsertMethod
        } in ${state.lastExpandMs?.toFixed(1)} ms`,
      );
    }

    return changed;
  }

  async function onInput() {
    const query = currentQuery();
    if (!query) {
      hidePopup();
      return;
    }

    await loadCommands();
    renderPopup(filterCommands(query.token));
  }

  function onKeydown(event) {
    if (!state.visible) return;

    if (event.key === 'Escape') {
      hidePopup();
      return;
    }

    if (!state.filtered.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateSelection(state.selectedIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateSelection(state.selectedIndex - 1);
      return;
    }

    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      choose();
    }
  }

  function detachEditor() {
    if (!state.editor) return;
    state.editor.removeEventListener('input', onInput);
    state.editor.removeEventListener('keydown', onKeydown, true);
    state.editor = null;
    hidePopup();
  }

  function attachEditor(editor) {
    if (editor === state.editor) return;

    detachEditor();
    state.editor = editor;
    editor.addEventListener('input', onInput);
    editor.addEventListener('keydown', onKeydown, true);

    console.info('[MASAMUNE cmd] attached to composer:', editor);
    loadCommands();
  }

  function ensureAttached() {
    state.attachFrame = 0;

    const editor = findEditor();
    if (!editor) {
      if (state.editor && !state.editor.isConnected) detachEditor();
      return;
    }

    attachEditor(editor);
  }

  function scheduleAttach() {
    if (state.attachFrame) return;
    state.attachFrame = requestAnimationFrame(ensureAttached);
  }

  function onViewportChange() {
    if (state.visible) positionPopup();
  }

  function diagnostics() {
    return {
      version: VERSION,
      href: location.href,
      editorFound: Boolean(state.editor?.isConnected),
      editorTag: state.editor?.tagName || null,
      editorId: state.editor?.id || null,
      contentEditable: state.editor?.isContentEditable ?? null,
      commandCount: state.commands.length,
      popupVisible: state.visible,
      lastError: state.lastError,
      lastPromptChars: state.lastPromptChars,
      lastInsertMethod: state.lastInsertMethod,
      lastExpandMs: state.lastExpandMs,
    };
  }

  function teardown() {
    if (state.attachFrame) {
      cancelAnimationFrame(state.attachFrame);
      state.attachFrame = 0;
    }

    state.observer?.disconnect();
    state.observer = null;

    detachEditor();

    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);

    state.popup?.remove();
    state.popup = null;

    state.style?.remove();
    state.style = null;
  }

  function init() {
    if (!document.head || !document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    ensureStyle();
    ensurePopup();
    ensureAttached();

    // We never inspect removedNodes or assume mutation nodes are Elements.
    // Any relevant DOM replacement simply schedules one cheap editor lookup.
    state.observer = new MutationObserver(scheduleAttach);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    console.info(`[MASAMUNE cmd] initialized v${VERSION}`);
  }

  window[NS] = {
    version: VERSION,
    diagnostics,
    reload: () => loadCommands(true),
    teardown,
  };

  init();
})();
