import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';

// Scoping-Details / General-Notes inline editor. Plain free-text plus
// two flavours of @-mention:
//
//   • Service mentions (green pill) — services from the Services
//     Explored picker. Stored as `@[Service Name]`.
//   • Competitor mentions (red pill) — companies the user is treating
//     as competitors on this opportunity. Stored as `@![Name]`. When
//     a competitor is committed, onMentionCompetitor(name, recentService)
//     fires so the parent can mirror the entry into the Competitors
//     box on the company popup, paired with whatever service was the
//     most recent green pill on the same line.
//
// On-disk format is just text with those tokens woven in — readable in
// exports, easy to round-trip into a contentEditable view.

// Capture both token shapes in one pass. Group 1 = "!" if competitor,
// undefined otherwise. Group 2 = the canonical name.
const TOKEN_RE = /@(!)?\[([^\]]+)\]/g;

const SERVICE_PILL_STYLE = {
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

const COMPETITOR_PILL_STYLE = {
  ...SERVICE_PILL_STYLE,
  background: '#FEE2E2',
  border: '1px solid #FCA5A5',
  color: '#991B1B',
};

function buildChip(name, kind = 'service') {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  if (kind === 'competitor') {
    span.dataset.scopingCompetitor = name;
    Object.assign(span.style, COMPETITOR_PILL_STYLE);
  } else {
    span.dataset.scopingMention = name;
    Object.assign(span.style, SERVICE_PILL_STYLE);
  }
  span.textContent = `@${name}`;
  return span;
}

// True when `n` is a chip span of either flavour.
function isAnyChip(n) {
  return !!(n
    && n.nodeType === Node.ELEMENT_NODE
    && (n.dataset?.scopingMention || n.dataset?.scopingCompetitor));
}

function chipKind(n) {
  if (!n || n.nodeType !== Node.ELEMENT_NODE) return null;
  if (n.dataset?.scopingMention) return 'service';
  if (n.dataset?.scopingCompetitor) return 'competitor';
  return null;
}

function chipName(n) {
  if (!n) return '';
  return n.dataset?.scopingMention || n.dataset?.scopingCompetitor || '';
}

// Walk the contenteditable's nodes back into the storage format —
// chip spans become `@[Name]` (service) or `@![Name]` (competitor),
// <br>/<div>/<p> boundaries become \n.
function serialize(el) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.dataset?.scopingMention) {
      out += `@[${node.dataset.scopingMention}]`;
      return;
    }
    if (node.dataset?.scopingCompetitor) {
      out += `@![${node.dataset.scopingCompetitor}]`;
      return;
    }
    const tag = node.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    const isBlock = tag === 'DIV' || tag === 'P';
    if (isBlock && out && !out.endsWith('\n')) out += '\n';
    for (const child of node.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return out;
}

// Render the stored text into the contenteditable.
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
    const kind = m[1] === '!' ? 'competitor' : 'service';
    el.appendChild(buildChip(m[2], kind));
    lastIdx = m.index + m[0].length;
  }
  appendText(str.slice(lastIdx));
}

// Find the @ that anchors the active mention query.
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

// Walk backward for line-bullet handling. Chips become their tokens
// in the assembled prefix string.
function getLineBeforeCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const off = range.startOffset;
  const text = (node.nodeValue || '').slice(0, off);
  const nlIdx = text.lastIndexOf('\n');
  if (nlIdx !== -1) {
    return { text: text.slice(nlIdx + 1), startNode: node, startOffset: nlIdx + 1, allInOneNode: true };
  }
  let lineText = text;
  let cur = node.previousSibling;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && cur.tagName === 'BR') break;
    if (cur.nodeType === Node.ELEMENT_NODE) {
      if (cur.dataset?.scopingMention) lineText = `@[${cur.dataset.scopingMention}]` + lineText;
      else if (cur.dataset?.scopingCompetitor) lineText = `@![${cur.dataset.scopingCompetitor}]` + lineText;
    } else if (cur.nodeType === Node.TEXT_NODE) {
      const t = cur.nodeValue || '';
      const nl = t.lastIndexOf('\n');
      if (nl !== -1) {
        return { text: t.slice(nl + 1) + lineText, startNode: node, startOffset: 0, allInOneNode: false };
      }
      lineText = t + lineText;
    }
    cur = cur.previousSibling;
  }
  return { text: lineText, startNode: node, startOffset: 0, allInOneNode: false };
}

// Walk backward from the caret looking for the most recent service
// chip on the same logical line. Used so a freshly-committed
// competitor can be paired with the service it sits next to.
function findRecentServiceBeforeCaret() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  // Move up to the editable line at our caret
  if (node.nodeType === Node.TEXT_NODE) node = node.previousSibling || node.parentNode?.previousSibling;
  let cur = node;
  let hops = 0;
  while (cur && hops < 50) {
    hops++;
    if (cur.nodeType === Node.ELEMENT_NODE) {
      if (cur.tagName === 'BR') return null;
      if (cur.dataset?.scopingMention) return cur.dataset.scopingMention;
    } else if (cur.nodeType === Node.TEXT_NODE) {
      if ((cur.nodeValue || '').includes('\n')) return null;
    }
    cur = cur.previousSibling;
  }
  return null;
}

// Replace the live "@query" run with a chip + trailing space.
function insertMention(rootEl, mention, anchor, kind = 'service') {
  const { node, atOffset } = anchor;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const caret = range.startOffset;
  const text = node.nodeValue || '';
  const before = text.slice(0, atOffset);
  const after = text.slice(caret);
  const parent = node.parentNode;
  if (!parent || !rootEl.contains(parent)) return;
  const beforeNode = document.createTextNode(before);
  const chip = buildChip(mention, kind);
  const space = document.createTextNode(` ${after}`);
  parent.replaceChild(space, node);
  parent.insertBefore(chip, space);
  parent.insertBefore(beforeNode, chip);
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

const ADD_COMPETITOR_KIND = '__add_competitor__';

export const ScopingNotesEditor = memo(function ScopingNotesEditor({
  value, onCommit, services, competitors, onMentionCompetitor, placeholder, style,
}) {
  const editorRef = useRef(null);
  const wrapperRef = useRef(null);
  const lastExternal = useRef(value ?? '');
  const [popover, setPopover] = useState(null); // { query, top, left, index }

  useEffect(() => {
    const v = value ?? '';
    if (v === lastExternal.current) return;
    lastExternal.current = v;
    if (editorRef.current && document.activeElement !== editorRef.current) {
      hydrate(editorRef.current, v);
    }
  }, [value]);

  useEffect(() => {
    if (editorRef.current) hydrate(editorRef.current, value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unified dropdown options. Services and competitors are filtered
  // independently (prefix-then-substring) and concatenated with a
  // group label. When the typed query is non-empty and doesn't match
  // any known competitor, a final "+ Add competitor: <typed>" entry
  // lets the user mint one on the spot.
  const dropdownOptions = useMemo(() => {
    if (!popover) return [];
    const q = popover.query.trim().toLowerCase();
    const out = [];
    const sList = services || [];
    const cList = competitors || [];
    const filterList = (list) => {
      if (!q) return list.slice(0, 8);
      const prefix = [];
      const sub = [];
      for (const s of list) {
        const lower = String(s).toLowerCase();
        if (lower.startsWith(q)) prefix.push(s);
        else if (lower.includes(q)) sub.push(s);
      }
      return [...prefix, ...sub].slice(0, 8);
    };
    const svcMatches = filterList(sList);
    const compMatches = filterList(cList);
    if (svcMatches.length) {
      out.push({ kind: '__header__', label: 'Services' });
      for (const name of svcMatches) out.push({ kind: 'service', name });
    }
    if (compMatches.length || (q && onMentionCompetitor)) {
      out.push({ kind: '__header__', label: 'Competitors' });
      for (const name of compMatches) out.push({ kind: 'competitor', name });
      // "Add new competitor" sentinel — only when the user typed a
      // non-empty query that doesn't already match an existing entry.
      if (q && onMentionCompetitor) {
        const exact = cList.some(c => String(c).toLowerCase() === q);
        if (!exact) out.push({ kind: ADD_COMPETITOR_KIND, name: popover.query.trim() });
      }
    }
    return out;
  }, [popover, services, competitors, onMentionCompetitor]);

  // Selectable rows = everything except the section headers. The
  // active index counter only advances over these.
  const selectableIdx = useMemo(
    () => dropdownOptions.map((o, i) => ({ o, i })).filter(x => x.o.kind !== '__header__'),
    [dropdownOptions]
  );

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

  const commitOption = useCallback((opt) => {
    const root = editorRef.current;
    if (!root) return;
    const anchor = findActiveMention();
    if (!anchor) return;
    if (opt.kind === 'service') {
      insertMention(root, opt.name, anchor, 'service');
    } else if (opt.kind === 'competitor' || opt.kind === ADD_COMPETITOR_KIND) {
      // Capture the most recent service chip BEFORE the @-anchor so
      // the parent can pair them on the Competitors box.
      // findActiveMention puts us inside the typed text; the anchor
      // node is the text node containing the "@". Walk back from
      // anchor.node's previousSibling.
      let recentService = null;
      try {
        let cur = anchor.node.previousSibling;
        let hops = 0;
        while (cur && hops < 50) {
          hops++;
          if (cur.nodeType === Node.ELEMENT_NODE) {
            if (cur.tagName === 'BR') break;
            if (cur.dataset?.scopingMention) { recentService = cur.dataset.scopingMention; break; }
          } else if (cur.nodeType === Node.TEXT_NODE) {
            if ((cur.nodeValue || '').includes('\n')) break;
          }
          cur = cur.previousSibling;
        }
      } catch { /* ignore */ }
      insertMention(root, opt.name, anchor, 'competitor');
      if (onMentionCompetitor) {
        try { onMentionCompetitor(opt.name, recentService); } catch (err) { console.error('onMentionCompetitor', err); }
      }
    }
    setPopover(null);
  }, [onMentionCompetitor]);

  const handleInput = useCallback(() => {
    refreshMentionState();
    // Markdown bullet shorthand
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const off = range.startOffset;
    const text = node.nodeValue || '';
    const last2 = text.slice(Math.max(0, off - 2), off);
    if (last2 !== '- ' && last2 !== '* ') return;
    const before = text.slice(0, off - 2);
    let atLineStart;
    if (before === '') {
      atLineStart = true;
      let cur = node.previousSibling;
      while (cur) {
        if (cur.nodeType === Node.ELEMENT_NODE && cur.tagName === 'BR') break;
        if (cur.nodeType === Node.TEXT_NODE) {
          const t = cur.nodeValue || '';
          if (t.endsWith('\n')) break;
          if (t.length > 0) { atLineStart = false; break; }
        } else if (isAnyChip(cur)) {
          atLineStart = false; break;
        }
        cur = cur.previousSibling;
      }
    } else {
      atLineStart = before.endsWith('\n');
    }
    if (!atLineStart) return;
    node.nodeValue = text.slice(0, off - 2) + '• ' + text.slice(off);
    const newRange = document.createRange();
    newRange.setStart(node, off);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }, [refreshMentionState]);

  const handleClick = useCallback((e) => {
    const target = e.target;
    if (isAnyChip(target)) {
      const range = document.createRange();
      range.selectNode(target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (popover && selectableIdx.length > 0) {
      // Track the active row by the selectableIdx position so headers
      // are skipped naturally.
      const activePos = selectableIdx.findIndex(x => x.i === popover.index);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (activePos + 1) % selectableIdx.length;
        setPopover(p => p ? { ...p, index: selectableIdx[next].i } : p);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (activePos - 1 + selectableIdx.length) % selectableIdx.length;
        setPopover(p => p ? { ...p, index: selectableIdx[prev].i } : p);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const opt = dropdownOptions[popover.index] || dropdownOptions[selectableIdx[0]?.i];
        if (opt && opt.kind !== '__header__') commitOption(opt);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopover();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const lineInfo = getLineBeforeCaret();
        if (lineInfo && lineInfo.text.startsWith('• ')) {
          e.preventDefault();
          if (lineInfo.text === '• ' && lineInfo.allInOneNode) {
            const node = lineInfo.startNode;
            const start = lineInfo.startOffset;
            const t = node.nodeValue || '';
            node.nodeValue = t.slice(0, start) + t.slice(start + 2);
            const newRange = document.createRange();
            newRange.setStart(node, start);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            return;
          }
          document.execCommand('insertText', false, '\n• ');
          return;
        }
      }
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!sel.isCollapsed) {
        const start = range.startContainer;
        const end = range.endContainer;
        const startEl = start.nodeType === Node.ELEMENT_NODE ? start : start.parentNode;
        const endEl = end.nodeType === Node.ELEMENT_NODE ? end : end.parentNode;
        if (startEl && startEl === endEl && isAnyChip(startEl)) {
          e.preventDefault();
          startEl.parentNode.removeChild(startEl);
          refreshMentionState();
          return;
        }
      }
      if (sel.isCollapsed) {
        const node = range.startContainer;
        const off = range.startOffset;
        if (e.key === 'Backspace') {
          if (node.nodeType === Node.TEXT_NODE && off === 0) {
            const prev = node.previousSibling;
            if (isAnyChip(prev)) {
              e.preventDefault();
              prev.parentNode.removeChild(prev);
              refreshMentionState();
              return;
            }
          }
          if (node.nodeType === Node.ELEMENT_NODE && off > 0) {
            const prev = node.childNodes[off - 1];
            if (isAnyChip(prev)) {
              e.preventDefault();
              prev.parentNode.removeChild(prev);
              refreshMentionState();
              return;
            }
          }
        } else {
          if (node.nodeType === Node.TEXT_NODE && off === (node.nodeValue || '').length) {
            const next = node.nextSibling;
            if (isAnyChip(next)) {
              e.preventDefault();
              next.parentNode.removeChild(next);
              refreshMentionState();
              return;
            }
          }
          if (node.nodeType === Node.ELEMENT_NODE && off < node.childNodes.length) {
            const next = node.childNodes[off];
            if (isAnyChip(next)) {
              e.preventDefault();
              next.parentNode.removeChild(next);
              refreshMentionState();
              return;
            }
          }
        }
      }
    }
  }, [popover, dropdownOptions, selectableIdx, commitOption, closePopover, refreshMentionState]);

  const handleBlur = useCallback(() => {
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
        onClick={handleClick}
        onBlur={handleBlur}
        onPaste={handlePaste}
        data-placeholder={placeholder || 'Type @ to mention a service or competitor…'}
        style={{
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
          ...style,
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
      {popover && dropdownOptions.length > 0 && (
        <div
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
            minWidth: 240,
            maxHeight: 280,
            overflowY: 'auto',
            fontSize: '0.78rem',
          }}
        >
          {dropdownOptions.map((opt, i) => {
            if (opt.kind === '__header__') {
              return (
                <div key={`h-${opt.label}-${i}`} style={{ padding: '0.25rem 0.6rem', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94A3B8', fontWeight: 700, background: '#F8FAFC' }}>
                  {opt.label}
                </div>
              );
            }
            const isAdd = opt.kind === ADD_COMPETITOR_KIND;
            const isComp = opt.kind === 'competitor' || isAdd;
            const active = i === popover.index;
            const bg = active
              ? (isComp ? '#FEE2E2' : '#DCFCE7')
              : 'transparent';
            const fg = active
              ? (isComp ? '#991B1B' : '#166534')
              : '#1E293B';
            return (
              <div
                key={`o-${i}-${opt.name}`}
                onClick={() => commitOption(opt)}
                onMouseEnter={() => setPopover(p => p ? { ...p, index: i } : p)}
                style={{
                  padding: '0.35rem 0.6rem',
                  cursor: 'pointer',
                  background: bg,
                  color: fg,
                  fontWeight: active ? 700 : 500,
                  fontStyle: isAdd ? 'italic' : 'normal',
                }}
              >
                {isAdd ? `+ Add competitor: "${opt.name}"` : opt.name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// Helper: extract every distinct competitor name from text in any
// prospect record's free-text notes (competitorsNotes plus the new
// general/scoping notes that may carry @![Name] tokens). De-duped
// case-insensitively while preserving the original spelling. Used by
// callers that build the autocomplete list passed in via competitors.
export function harvestCompetitors(prospects) {
  const seen = new Set();
  const out = [];
  const push = (n) => {
    const v = String(n || '').trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  const RE = /@!\[([^\]]+)\]/g;
  for (const p of (prospects || [])) {
    // Legacy structured competitors map (keys are names)
    if (p?.competitors && typeof p.competitors === 'object') {
      for (const k of Object.keys(p.competitors)) push(k);
    }
    // New token format embedded in any of these fields
    for (const field of ['competitorsNotes', 'notes']) {
      const text = String(p?.[field] || '');
      if (!text) continue;
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(text)) !== null) push(m[1]);
    }
    // Per-service notes
    if (p?.serviceNotes && typeof p.serviceNotes === 'object') {
      for (const t of Object.values(p.serviceNotes)) {
        const text = String(t || '');
        if (!text) continue;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(text)) !== null) push(m[1]);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
