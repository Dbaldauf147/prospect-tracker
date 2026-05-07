import { useState, useEffect, useRef, memo } from 'react';

// Uncontrolled-ish text input / textarea that holds its own local state
// and only propagates up on blur. Drop-in replacement for a controlled
// <input>/<textarea> that binds to a parent state value — use it when
// the parent component has expensive re-renders and you don't need
// keystroke-level feedback upstream.
//
// Props:
//   value       — the current external value (string)
//   onCommit    — called with the new value on blur (and on Enter for <input>)
//   multiline   — render a <textarea> instead of an <input>
//   autoGrow    — when multiline, auto-resize the textarea to fit its content
//   bulletList  — multiline: focusing an empty cell inserts "• " and Enter
//                 inserts "\n• " at the cursor so the user gets a running
//                 bullet list without typing the glyph themselves.
//   smartBullets — multiline opt-in. Doesn't auto-bullet anything; instead
//                 lets the user start a list by typing "- " or "* " at the
//                 start of a line (auto-converted to "• "), continues the
//                 list on Enter, and exits on Enter when the current
//                 bullet is empty. Free-form text in between stays
//                 untouched. Different from bulletList — that one forces
//                 every line to be bulleted, which is too aggressive for
//                 a free-form Notes field.
//   type        — input type (default 'text'); ignored when multiline
//   ...rest     — forwarded to the underlying element (style, placeholder, etc.)
export const CommitOnBlurInput = memo(function CommitOnBlurInput({
  value, onCommit, multiline, autoGrow, bulletList, smartBullets, type, onKeyDown, onFocus, style, ...rest
}) {
  const [local, setLocal] = useState(value ?? '');
  const lastExternal = useRef(value ?? '');
  const taRef = useRef(null);

  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) {
      lastExternal.current = v;
      setLocal(v);
    }
  }, [value]);

  // Auto-grow textarea height to fit content. Runs on every local change
  // so it tracks the user typing in real time, and once after mount so
  // content preloaded from value is sized correctly.
  useEffect(() => {
    if (!multiline || !autoGrow) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [local, multiline, autoGrow]);

  const handleBlur = () => {
    if (local !== lastExternal.current) {
      lastExternal.current = local;
      if (onCommit) onCommit(local);
    }
  };
  const handleKey = (e) => {
    if (bulletList && multiline && e.key === 'Enter') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const insertion = '\n• ';
      const next = local.slice(0, start) + insertion + local.slice(end);
      setLocal(next);
      // Defer cursor placement until after React has written the new value.
      requestAnimationFrame(() => {
        if (el && el.isConnected) {
          const pos = start + insertion.length;
          el.selectionStart = el.selectionEnd = pos;
        }
      });
      return;
    }
    if (smartBullets && multiline && e.key === 'Enter' && !e.shiftKey) {
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start !== end) { /* selection — let the default replace it */ }
      else {
        const lineStart = local.lastIndexOf('\n', start - 1) + 1;
        const lineToCursor = local.slice(lineStart, start);
        if (lineToCursor.startsWith('• ')) {
          e.preventDefault();
          const lineEnd = local.indexOf('\n', start);
          const lineEndIdx = lineEnd === -1 ? local.length : lineEnd;
          const fullLine = local.slice(lineStart, lineEndIdx);
          // Empty bullet → exit list mode (drop the "• " on this line).
          if (fullLine === '• ') {
            const next = local.slice(0, lineStart) + local.slice(lineEndIdx);
            setLocal(next);
            requestAnimationFrame(() => {
              if (el && el.isConnected) {
                el.selectionStart = el.selectionEnd = lineStart;
              }
            });
            return;
          }
          // Non-empty bullet → continue the list.
          const insertion = '\n• ';
          const next = local.slice(0, start) + insertion + local.slice(end);
          setLocal(next);
          requestAnimationFrame(() => {
            if (el && el.isConnected) {
              el.selectionStart = el.selectionEnd = start + insertion.length;
            }
          });
          return;
        }
      }
    }
    if (!multiline && e.key === 'Enter') {
      e.currentTarget.blur();
    }
    if (onKeyDown) onKeyDown(e);
  };

  // Markdown-style "- " / "* " at the start of a line auto-converts to
  // "• " so the user doesn't have to hunt down the bullet glyph. Only
  // active when smartBullets is enabled.
  const handleChange = (e) => {
    let next = e.target.value;
    if (smartBullets && multiline) {
      const pos = e.target.selectionStart;
      const lineStart = next.lastIndexOf('\n', pos - 1) + 1;
      const segment = next.slice(lineStart, pos);
      if (segment === '- ' || segment === '* ') {
        next = next.slice(0, lineStart) + '• ' + next.slice(pos);
        const newPos = lineStart + 2;
        const el = e.target;
        requestAnimationFrame(() => {
          if (el && el.isConnected) {
            el.selectionStart = el.selectionEnd = newPos;
          }
        });
      }
    }
    setLocal(next);
  };

  const handleFocus = (e) => {
    if (bulletList && multiline && !local) {
      setLocal('• ');
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el && el.isConnected) {
          el.selectionStart = el.selectionEnd = 2;
        }
      });
    }
    if (onFocus) onFocus(e);
  };

  if (multiline) {
    const effectiveStyle = autoGrow
      ? { ...style, overflow: 'hidden', resize: 'none' }
      : style;
    return (
      <textarea
        ref={taRef}
        {...rest}
        style={effectiveStyle}
        value={local}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKey}
      />
    );
  }
  return (
    <input
      type={type || 'text'}
      {...rest}
      style={style}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKey}
    />
  );
});
