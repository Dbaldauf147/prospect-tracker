import { useState, useEffect, useRef, memo } from 'react';
import { BULLET, bulletBreak, bulletExit, dashToBullet, onBulletLine } from '../../utils/bulletText';

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

  // Put `next` in the box and the caret at `pos` NOW, rather than on the
  // next frame.
  //
  // A controlled textarea's value is React's to write, and React writes it
  // on the next render - so a caret placed in a requestAnimationFrame is
  // placed after any key pressed in between has already landed at whatever
  // caret the browser was left with, which is the end of the text. Typing
  // at speed through a bullet break scrambled the line: the next word went
  // to the end and the rest of the sentence came back to the middle.
  //
  // Writing both here closes that window. React's following render sets
  // the same string, which it treats as a no-op and leaves the selection
  // alone.
  const writeNow = (el, next, pos) => {
    if (el && el.isConnected) {
      el.value = next;
      el.selectionStart = el.selectionEnd = pos;
    }
    setLocal(next);
  };

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
      const { next, caret } = bulletBreak(local, el.selectionStart, el.selectionEnd);
      writeNow(el, next, caret);
      return;
    }
    if (smartBullets && multiline && e.key === 'Enter' && !e.shiftKey) {
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start !== end) { /* selection — let the default replace it */ }
      else if (onBulletLine(local, start)) {
        e.preventDefault();
        // An empty bullet is how somebody says they are done listing.
        const exit = bulletExit(local, start);
        const { next, caret } = exit || bulletBreak(local, start, end);
        writeNow(el, next, caret);
        return;
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
    const typed = e.target.value;
    if (smartBullets && multiline) {
      const swap = dashToBullet(typed, e.target.selectionStart);
      if (swap) {
        writeNow(e.target, swap.next, swap.caret);
        return;
      }
    }
    setLocal(typed);
  };

  const handleFocus = (e) => {
    if (bulletList && multiline && !local) {
      // Same reasoning as the Enter above: the first letter typed after
      // focusing an empty box would otherwise land before the glyph.
      writeNow(e.currentTarget, BULLET, BULLET.length);
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
