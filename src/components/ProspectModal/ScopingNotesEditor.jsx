import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';

// Scoping-Details note editor. Plain free-text plus @-mentions of the
// services from the Services Explored picker — same canonical list, so
// "@strategic" + Enter inserts a coloured pill that records the user
// surfaced "Strategic sourcing" during scoping.
//
// On-disk format is just text with `@[Service Name]` tokens woven in
// — readable in exports, easy to round-trip into a contentEditable view
// where each token re-renders as a non-editable pill.

const TOKEN_RE = /@\[([^\]]+)\]/g;

const PILL_STYLE = {
  display: 'inline-block',
  padding: '0 6px',
  margin: '0 1px',
  borderRadius: 999,
  background: '#DCFCE7',
  border: '1px solid #86EFAC',
  color: '#166534',
  fontSize: '0.78rem',
  fontWeight: 700,
  lineHeight: '1.4',
  whiteSpace: 'nowrap',
  userSelect: 'all',
};

function buildChip(name) {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.scopingMention = name;
  span.textContent = `@${name}`;
  Object.assign(span.style, PILL_STYLE);
  return span;
}

// Render the stored text into the contenteditable. Splits on the
// `@[Name]` tokens, drops a chip span for each, and turns newlines into
// <br>s in the surrounding text.
function hydrate(el, text) {
  el.innerHTML = '';
  if (!text) return;
  const str = String(text);
  let lastIdx = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  const appendText = (chunk) => {
    if (!chunk) return;
    const parts = chunk.split('\n');
    parts.forEach((part, i) => {
      if (part) el.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) el.appendChild(document.createElement('br'));
    });
  };
  while ((m = TOKEN_RE.exec(str)) !== null) {
    appendText(str.slice(lastIdx, m.index));
    el.appendChild(buildChip(m[1]));
    lastIdx = m.index + m[0].length;
  }
  appendText(str.slice(lastIdx));
}

// Walk the contenteditable's nodes back into the storage format —
// chip spans become `@[Name]`, <br>/<div>/<p> boundaries become \n.
function serialize(el) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.dataset && node.dataset.scopingMention) {
      out += `@[${node.dataset.scopingMention}]`;
      return;
    }
    const tag = node.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    // Block-level wrappers (DIV / P) introduced by the browser when the
    // user presses Enter — emit a newline before their content (except
    // for the very first one, which is just the document root).
    const isBlock = tag === 'DIV' || tag === 'P';
    if (isBlock && out && !out.endsWith('\n')) out += '\n';
    for (const child of node.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return out;
}

// Find the @ that anchors the active mention query: scans backward
// from the caret over the current text node looking for an "@" with
// no whitespace between it and the caret. Returns { node, offset, query }
// or null when no live mention is being typed.
function findActiveMention() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.nodeValue || '';
  const caret = range.startOffset;
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // Make sure the @ is at a word boundary (start of node or
      // preceded by whitespace) so emails like a@b.com don't trigger.
      if (i === 0 || /\s/.test(text[i - 1])) {
        return { node, atOffset: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/[\s\n]/.test(ch)) return null;
    i--;
  }
  return null;
}

// Replace the live "@query" run with a chip + trailing space. Mutates
// the DOM and leaves the caret right after the inserted chip.
function insertMention(rootEl, mention, anchor) {
  const { node, atOffset } = anchor;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const caret = range.startOffset;
  // Split the text node into "before-the-@" and "after-the-caret".
  const text = node.nodeValue || '';
  const before = text.slice(0, atOffset);
  const after = text.slice(caret);
  const parent = node.parentNode;
  if (!parent || !rootEl.contains(parent)) return;
  const beforeNode = document.createTextNode(before);
  const chip = buildChip(mention);
  const space = document.createTextNode(` ${after}`);
  parent.replaceChild(space, node);
  parent.insertBefore(chip, space);
  parent.insertBefore(beforeNode, chip);
  // Place the caret right after the chip + the inserted space.
  const newRange = document.createRange();
  newRange.setStart(space, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function caretPixelPosition(rootEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const rects = range.getClientRects();
  let rect = rects[0];
  if (!rect) {
    // Empty line — fall back to a temporary marker. Uses a zero-width
    // space (U+200B) so the marker has measurable layout without
    // affecting the text the user sees.
    const marker = document.createElement('span');
    marker.appendChild(document.createTextNode(String.fromCharCode(0x200b)));
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.parentNode?.removeChild(marker);
  }
  const rootRect = rootEl.getBoundingClientRect();
  return {
    top: rect.bottom - rootRect.top + 4,
    left: rect.left - rootRect.left,
  };
}

export const ScopingNotesEditor = memo(function ScopingNotesEditor({
  value, onCommit, services, placeholder, style,
}) {
  const editorRef = useRef(null);
  const wrapperRef = useRef(null);
  const lastExternal = useRef(value ?? '');
  // Mention popover state — driven by the contenteditable's input
  // events, so it lives in React state but the textbox itself stays
  // uncontrolled (re-rendering it on every keystroke would blow the
  // caret away).
  const [popover, setPopover] = useState(null); // { query, top, left, index }

  // Initial hydrate + re-hydrate on legitimate external change. We avoid
  // touching the DOM on every keystroke because the user is the source
  // of truth while focused.
  useEffect(() => {
    const v = value ?? '';
    if (v === lastExternal.current) return;
    lastExternal.current = v;
    if (editorRef.current && document.activeElement !== editorRef.current) {
      hydrate(editorRef.current, v);
    }
  }, [value]);

  // First mount: paint the initial value.
  useEffect(() => {
    if (editorRef.current) hydrate(editorRef.current, value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredServices = useMemo(() => {
    if (!popover) return [];
    const q = popover.query.trim().toLowerCase();
    const list = services || [];
    if (!q) return list.slice(0, 8);
    // Prefix matches first, then substring matches — keeps the obvious
    // hits ("@stra" → Strategic sourcing) at the top.
    const prefix = [];
    const sub = [];
    for (const s of list) {
      const lower = s.toLowerCase();
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [popover, services]);

  const closePopover = useCallback(() => setPopover(null), []);

  const refreshMentionState = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const anchor = findActiveMention();
    if (!anchor || !root.contains(anchor.node)) {
      setPopover(p => (p ? null : p));
      return;
    }
    const pos = caretPixelPosition(root) || { top: 0, left: 0 };
    setPopover({ query: anchor.query, top: pos.top, left: pos.left, index: 0 });
  }, []);

  const commitMention = useCallback((mention) => {
    const root = editorRef.current;
    if (!root) return;
    const anchor = findActiveMention();
    if (!anchor) return;
    insertMention(root, mention, anchor);
    setPopover(null);
    // Keep focus in the editor and let the parent's onCommit fire on blur.
  }, []);

  const handleInput = useCallback(() => {
    refreshMentionState();
  }, [refreshMentionState]);

  const handleKeyDown = useCallback((e) => {
    if (popover && filteredServices.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPopover(p => p ? { ...p, index: (p.index + 1) % filteredServices.length } : p);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPopover(p => p ? { ...p, index: (p.index - 1 + filteredServices.length) % filteredServices.length } : p);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        commitMention(filteredServices[popover.index] || filteredServices[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopover();
        return;
      }
    }
    // Backspace right after a chip removes the chip cleanly instead of
    // leaving a stray text fragment.
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startOffset === 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
          const prev = range.startContainer.previousSibling;
          if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.dataset?.scopingMention) {
            e.preventDefault();
            prev.parentNode.removeChild(prev);
            refreshMentionState();
          }
        }
      }
    }
  }, [popover, filteredServices, commitMention, closePopover, refreshMentionState]);

  const handleBlur = useCallback(() => {
    // Defer so a click on the popover lands first (the popover sets a
    // mousedown handler that prevents blur, but be defensive).
    requestAnimationFrame(() => {
      if (!editorRef.current) return;
      if (document.activeElement === editorRef.current) return;
      const next = serialize(editorRef.current);
      if (next !== lastExternal.current) {
        lastExternal.current = next;
        if (onCommit) onCommit(next);
      }
      closePopover();
    });
  }, [onCommit, closePopover]);

  // Strip formatting from pasted content so a copy from Word / a web
  // page doesn't drag colored text + fonts into the field.
  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    document.execCommand('insertText', false, text);
    refreshMentionState();
  }, [refreshMentionState]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        data-placeholder={placeholder || 'Type @ to mention a service from the Services Explored list…'}
        style={{
          ...style,
          minHeight: '100px',
          padding: '0.4rem 0.55rem',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          fontFamily: 'inherit',
          fontSize: '0.82rem',
          lineHeight: 1.5,
          outline: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #94A3B8;
          font-style: italic;
          pointer-events: none;
        }
      `}</style>
      {popover && filteredServices.length > 0 && (
        <div
          // mousedown rather than click so we beat the contenteditable
          // blur and the editor stays focused after the pick.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            top: popover.top,
            left: popover.left,
            zIndex: 50,
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            minWidth: 220,
            maxHeight: 240,
            overflowY: 'auto',
            fontSize: '0.78rem',
          }}
        >
          {filteredServices.map((svc, i) => (
            <div
              key={svc}
              onClick={() => commitMention(svc)}
              onMouseEnter={() => setPopover(p => p ? { ...p, index: i } : p)}
              style={{
                padding: '0.35rem 0.6rem',
                cursor: 'pointer',
                background: i === popover.index ? '#DCFCE7' : 'transparent',
                color: i === popover.index ? '#166534' : '#1E293B',
                fontWeight: i === popover.index ? 700 : 500,
              }}
            >{svc}</div>
          ))}
        </div>
      )}
    </div>
  );
});
