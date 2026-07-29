// SHIM for the Lovable export.
//
// The real helper attaches the signed-in user's Firebase ID token and
// hits this app's serverless `/api/*` routes (e.g. emailing the New Opps
// digest, saving email schedules). None of those endpoints exist in the
// export, so we short-circuit to a Response-like object that reports the
// feature as unavailable. Every caller already does `if (!res.ok) throw`,
// so the affected modal surfaces a clean error instead of crashing — and
// none of these run on page load, so the page mounts fine.

export async function apiFetch() {
  return {
    ok: false,
    status: 501,
    async json() { return { error: 'This action calls a backend API that is not part of the standalone export.' }; },
    async text() { return 'Not available in the standalone export.'; },
  };
}
