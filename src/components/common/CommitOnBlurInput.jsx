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
//   type        — input type (default 'text'); ignored when multiline
//   ...rest     — forwarded to the underlying element (style, placeholder, etc.)
export const CommitOnBlurInput = memo(function CommitOnBlurInput({
  value, onCommit, multiline, type, onKeyDown, ...rest
}) {
  const [local, setLocal] = useState(value ?? '');
  const lastExternal = useRef(value ?? '');
  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) {
      lastExternal.current = v;
      setLocal(v);
    }
  }, [value]);
  const handleBlur = () => {
    if (local !== lastExternal.current) {
      lastExternal.current = local;
      if (onCommit) onCommit(local);
    }
  };
  const handleKey = (e) => {
    // Enter commits single-line inputs immediately (the browser won't blur
    // on Enter by itself). Shift+Enter inserts a newline in textareas.
    if (!multiline && e.key === 'Enter') {
      e.currentTarget.blur();
    }
    if (onKeyDown) onKeyDown(e);
  };
  if (multiline) {
    return (
      <textarea
        {...rest}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKey}
      />
    );
  }
  return (
    <input
      type={type || 'text'}
      {...rest}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKey}
    />
  );
});
