---
name: meeting-recap
description: Format standards for meeting recaps filed into Prospect Tracker — how to detect the meeting type, which sections each type gets, and the bullet, owner, and next-step conventions. Use when writing up a Granola meeting, a call transcript, or pasted meeting notes.
---

# Meeting recap standards

A recap is read twice: once when it is filed, and once months later by
someone reconstructing why a deal moved. Write for the second reader. They
do not have the context you have right now.

## The rule that outranks the rest

**Do not invent commitments.** No owner, date, number, or decision goes in the
recap unless someone actually said it. If a follow-up has no stated owner, it
has no owner — write it that way. A padded recap is worse than a thin one,
because a thin one is obviously thin and a padded one is quietly wrong.

The transcript is machine-generated. Expect mis-heard words, missing
punctuation, and speaker labels like "A"/"B" whose roles you infer from
context. Where you infer, prefer the vaguer true statement to the specific
guess: "their facilities lead" beats a name you are not sure of.

---

## Step 1: what kind of meeting was this?

The section set depends on it. Read the attendees and the first few minutes.

| Signal | Type |
|---|---|
| External attendees, no signed deal, talk of scope/pricing/timeline/competitors | **Sales** |
| External attendees on existing work — performance, delivery, renewal, escalation | **Client** |
| Everyone shares the owner's email domain | **Internal** |

Judgement calls:

- **Mixed internal + external** → treat as the external type. The customer's
  presence is what makes the meeting consequential.
- **A prospect meeting that is really an internal prep call** → internal. Who
  was in the room decides, not what was discussed.
- **Genuinely unclear** → use the sales section set and say in one line that
  the type was ambiguous. Do not silently pick.

State the type you chose when you show the recap. It is the one judgement the
user can correct in a word, and everything else follows from it.

---

## Step 2: the sections

Every type produces the same underlying fields, because that is what the
tracker's call record stores. What changes is what belongs in them.

### Summary — all types

3 to 6 sentences. What the meeting was about and **where it landed**.

- Lead with the decision or the outcome, not the agenda.
- Never open with "The team discussed…" or "This meeting covered…". Those
  sentences carry no information.
- Name real platforms, sites, metrics, and dates. "They pushed the pilot to
  Q1 over budget timing" is worth writing; "timeline was discussed" is not.

### Key items — 3 to 8 bullets

One line each. No paragraph blocks. Facts, requirements, and decisions that
were actually stated.

By type, the things worth capturing:

- **Sales** — scope, sites and volumes, budget and who controls it, decision
  process and timeline, incumbent vendors, stated objections.
- **Client** — performance against what was promised, delivery status,
  escalations, scope changes, renewal or expansion signals.
- **Internal** — decisions made, positions taken, blockers named, and what was
  explicitly deferred.

Drop anything that would read as filler in six months. "They seemed
interested" is filler. "They asked for a revised quote at 40 sites" is not.

### Follow-ups — grouped by owner

Verb-first. Owner as named or described on the call. Due date only if stated.

```
Dan
  - Send the revised quote at 40 sites (Friday)
  - Confirm whether the utility data covers 2024

Their facilities lead
  - Circulate the site list internally

TBD / Group
  - Decide whether the pilot includes the west campus
```

- **Verb-first**: "Send the revised quote", not "Revised quote to be sent".
- **`TBD / Group`** takes anything nobody owned. Do not assign it to whoever
  was loudest, and do not drop it — an unowned action item is a real finding
  and hiding it is how things get missed.
- **Due dates** are what was said. "Friday", "before the board meeting", "end
  of month" are all fine as stated. Never convert a vague timeframe into a
  specific date.

### Next step — one sentence

The single agreed next step for the relationship. Empty if none was agreed —
and "we'll circle back" is not an agreed next step, it is the absence of one.
Say so rather than dressing it up.

### Sentiment — one word

`positive` · `neutral` · `cautious` · `negative`. Read the deal's direction,
not the tone of the conversation. A friendly call where the budget got frozen
is `cautious`.

### Risks — 0 to 8 bullets

Anything that could stall or lose this, drawn from what was actually said.
Empty is a valid and common answer. Do not manufacture concerns to fill the
section — an invented risk sends someone chasing a problem that does not
exist.

For internal meetings, risks are delivery and commitment risks rather than
deal risks.

---

## Length

The whole recap should fit on one screen. If it runs longer, the problem is
usually that discussion has crept into key items — cut back to decisions,
commitments, and blockers.

Long meetings compress hard, and the compression loses nuance. When a
transcript was long enough that the middle was clipped, say so in the recap.
The reader needs to know they are looking at the edges of a two-hour call.

---

## What good looks like

| Check | Passing |
|---|---|
| Meeting type | Stated, and matches who was actually in the room |
| Summary | 3–6 sentences, leads with the outcome, no "the team discussed" |
| Specificity | Real platforms, sites, metrics, dates — not generalities |
| Key items | 3–8 one-line bullets, decisions not topics |
| Follow-ups | Verb-first, grouped by owner, unowned under `TBD / Group` |
| Owners and dates | Only where actually stated; nothing inferred |
| Next step | One sentence, or honestly empty |
| Risks | Drawn from the call, or empty |
| Degradation | Clipped transcript, unclear type, unmatched company — all said out loud |

If the transcript is too short, garbled, or clearly not a meeting worth
filing, say that plainly and return empty sections. That is a correct
outcome, not a failure to try hard enough.

---

## How this maps into the tracker

The recap fields go straight into the call record the tracker already stores,
so the names line up:

| Recap section | Record field |
|---|---|
| Meeting type | `meetingType` |
| Summary | `summary` |
| Key items | `keyItems[]` |
| Follow-ups | `followUps[{ text, owner, due }]` |
| Next step | `nextSteps` |
| Sentiment | `sentiment` |
| Risks | `risks[]` |

`owner` and `due` are **null** when unstated — not empty strings. That is what
the app's own summarise route writes, and it is what the page checks before
rendering them.

`meetingType` is one of `sales`, `client`, `internal`, or `''` when it could
not be determined. The app's summarise route (`api/call-summary.js`) uses the
same three types and the same per-type section guidance, so a recap filed here
and one produced by the page's Summarize button read as the same document.
**If you change the taxonomy or the sections above, change it there too** — the
two are kept in step by hand.

Granola's own notes stay in `granolaSummary`, separate from `summary`. Yours
is what gets pushed onto the deal; theirs is reference. Never overwrite one
with the other.
