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
//   type        — input type (default 'text'); ignored when multiline
//   ...rest     — forwarded to the underlying element (style, placeholder, etc.)
export const CommitOnBlurInput = memo(function CommitOnBlurInput({
  value, onCommit, multiline, autoGrow, bulletList, type, onKeyDown, onFocus, style, ...rest
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
    if (!multiline && e.key === 'Enter') {
      e.currentTarget.blur();
    }
    if (onKeyDown) onKeyDown(e);
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
        onChange={e => setLocal(e.target.value)}
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
