// The Schneider Electric brand palette and type, in web form.
//
// These are the same values the branded Excel exports have been using since
// they were written (OpportunityForm, AgendaView, ProspectModal all declare
// the identical set as ExcelJS ARGB strings — 'FF3DCD58' and friends). That
// worked while a band was only ever drawn in a spreadsheet; the moment a
// second medium needed the brand — a banner at the top of an email — the
// alternative was a fourth copy of the same hexes with nothing keeping them
// honest. So the values live here once, in the '#RRGGBB' form the web and
// email need. The exports still carry their own ARGB copies: converting them
// is a change to four working exports for no gain, and the numbers below are
// the record either way.
//
// Band pairings, as the exports use them:
//   * a title band is SE_GREEN with white text
//   * a section header is SE_GREEN_DARK with white text
//   * the wordmark is "SE" in SE_GREEN beside the rest in SE_SLATE
export const SE_GREEN = '#3DCD58';       // "Life Is On" green
export const SE_GREEN_DARK = '#009530';  // Section / header band
export const SE_GRAPHITE = '#1E293B';    // Body text dark
export const SE_SLATE = '#475569';       // Wordmark grey
export const SE_MUTED = '#64748B';       // Secondary text
export const SE_SURFACE = '#F6F9F4';     // Tinted surface
export const SE_BORDER = '#D4DDE1';

// Nunito Sans is the brand face, and almost nobody reading an email has it
// installed — so it leads the stack and Arial (which the signature block
// already uses, and which every mail client has) catches everything else.
// Quoted because of the space in the name; single quotes so the whole stack
// can sit inside a double-quoted HTML style attribute.
export const SE_EMAIL_FONT = "'Nunito Sans',Nunito,Arial,Helvetica,sans-serif";
