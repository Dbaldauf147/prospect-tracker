---
name: verify
description: Verify Prospect Tracker UI changes by rendering the real React component in a browser.
---

# Verifying this app (Vite + React 19 + Firebase)

The app is a Firebase-auth SPA — you can't log in headless to reach a
real page. To observe a component change, mount the **real** component
with representative props and screenshot it under Chromium.

## Recipe

1. **Stub Firebase** (module init throws without a valid API key):
   ```
   cp src/firebase.js src/firebase.js.bak
   # write src/firebase.js exporting inert: auth {onAuthStateChanged:()=>()=>{},currentUser:null}, db {}, googleProvider {}
   ```
2. Create `verify-*.html` + `verify-*.jsx` at repo root that `createRoot(...).render(<TheComponent ...props/>)`.
3. Run dev server in the BACKGROUND via the harness (a backgrounded
   subshell `(vite &)` gets SIGTERMّd — exit 144): `npx vite --port 5199 --strictPort`.
4. Screenshot with the globally-installed Playwright:
   `import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const {chromium}=pkg;`
   (CJS default import — named `chromium` export fails.)
5. **Cleanup**: `mv src/firebase.js.bak src/firebase.js`; remove `verify-*` files and `.env.local`.

## Gotchas
- CSS-module class selectors are hashed: match with `[class*="myClass"]`,
  but beware substring overlap (`fooRow` also matches `fooRowPct`) — anchor
  with a tag, e.g. `tr[class*="fooRow"]`.
- `pkill -f vite` can signal the calling shell's process group (exit 144);
  it still kills vite — just re-check state in a fresh command.
