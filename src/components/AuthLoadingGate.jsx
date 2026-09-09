// What the app shows before it knows who is signed in.
//
// This is a plain "Loading..." for the second or two that normally takes.
// The panel underneath is for when it isn't: the sign-in path waits on
// Firebase Auth to call back, and that call can be prevented outright by
// things that produce no error anywhere -- a network that swallows
// identitytoolkit.googleapis.com, a corporate proxy or VPN, an extension
// blocking Google domains, a wedged IndexedDB holding the persisted
// session.
//
// Before this, all of those looked the same from the outside: the word
// "Loading..." in the middle of an empty page, for as long as the tab
// stayed open, with nothing on screen for the person looking at it to
// report and no reason to think a reload would behave any differently.
// The spinner stays honest -- it is still loading -- but it stops being
// the only thing on the page.

const btn = {
  padding: '0.45rem 0.9rem', border: '1px solid #CBD5E1', borderRadius: 6,
  background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};

// Clearing the stored session is the fix for the case this panel most
// often means: a persisted login the SDK cannot refresh. It is done by
// hand rather than through signOut, because signOut goes through the same
// SDK that is not answering.
async function clearSessionAndReload() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (err) {
    console.warn('Could not clear web storage', err);
  }
  try {
    // Firebase keeps the session in IndexedDB (firebaseLocalStorageDb) and
    // the Firestore cache alongside it. Deleting a database that another
    // tab still holds open blocks rather than failing, so don't wait past
    // a moment for it -- the reload is the point.
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(dbs.map(({ name }) => name && new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
      setTimeout(resolve, 1500);
    })));
  } catch (err) {
    console.warn('Could not clear IndexedDB', err);
  }
  window.location.reload();
}

export function AuthLoadingGate({ stalled }) {
  if (!stalled) return <div className="loading">Loading...</div>;

  return (
    <div style={{ maxWidth: 720, margin: '3rem auto', padding: '1.5rem', color: '#0F172A' }}>
      <h1 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem' }}>Still waiting on sign-in</h1>
      <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5 }}>
        The app itself loaded fine — it is waiting for Firebase to say who is
        signed in, and that has not come back. It is almost always the network
        rather than your account: a VPN or corporate proxy, or an extension
        blocking Google domains. Your data is untouched, and nothing has been
        written.
      </p>
      <ul style={{ color: '#475569', fontSize: 13, lineHeight: 1.6, paddingLeft: '1.1rem' }}>
        <li>Reload — a slow first connection sometimes just needs the second try.</li>
        <li>Try the page off the VPN, or in a private window with extensions off.</li>
        <li>
          If it only happens on this browser, clear the saved session below: a
          stored login the SDK cannot refresh produces exactly this.
        </li>
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" style={btn} onClick={() => window.location.reload()}>Reload</button>
        <button type="button" style={btn} onClick={clearSessionAndReload}>
          Clear saved session and reload
        </button>
      </div>
      <p style={{ color: '#94A3B8', fontSize: 12, marginTop: '0.9rem' }}>
        Still loading in the background — if it does come back, the app opens by itself.
      </p>
    </div>
  );
}
