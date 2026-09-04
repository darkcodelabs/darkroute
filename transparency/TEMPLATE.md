---
date_received: YYYY-MM-DD
date_published: YYYY-MM-DD
sender: Organisation or person asserting the right
represented_by: Firm name, or "self"
type: cease-and-desist | dmca | trademark | subpoena | preservation | court-order | removal-request | other
theory: the legal basis asserted, with the statute where one is cited
targets: URLs, OSM object IDs, repository paths or app screens named in the demand
deadline_asserted: YYYY-MM-DD, or "none"
confidentiality_requested: yes | no | court-ordered
response: ./YYYY-MM-DD-<slug>-response.md, or "none sent"
outcome: ./YYYY-MM-DD-<slug>-outcome.md, or "no change"
complied: yes | partial | no | pending
lumen_url: https://lumendatabase.org/notices/..., or "pending", or "not eligible - reason"
counsel: who advised, or "none"
---

<!--
Copy this file to transparency/YYYY/MM/YYYY-MM-DD-<sender-slug>.md.

YYYY-MM-DD is the date of RECEIPT, not of publication.
<sender-slug> is the sending ORGANISATION, lowercased, hyphenated.
Same sender, same day, twice: append -2, -3.

Do NOT add an `example: true` key. That key marks a formatting specimen and
must never appear on a real notice. The worked example lives in
transparency/README.md and is deliberately not a file in this directory.

Every front-matter key above is required. A key with no known value is written
`unknown` and is never deleted: an omitted key reads as an oversight, `unknown`
reads as a fact.
-->

# <Sender> - <type>, <date_received>

**This notice is published because it was received on the date above. That is
all its presence here means.** It is not evidence that the claim has merit, and
it is not evidence that it does not. See
[`docs/public/TRANSPARENCY.md`](https://github.com/darkcodelabs/darkroute/blob/main/docs/public/TRANSPARENCY.md).

<!-- This absolute link deliberately works both here and after the template is
     copied to transparency/YYYY/MM/. Do not replace it with a relative path
     that resolves from only one of those two depths. -->

Redactions in the text below use `[private]` for personal contact details of
natural persons and for third-party personal data the sender included,
`[invalid]` for targets that were not present or not ours to act on, and
`[sealed]` where a court has sealed material. Nothing else is removed - not the
sender, not the firm, not the attorney's professional identity, not the client,
not the theory, not the deadline.

---

## The demand, verbatim

<!--
Paste the notice here with no edits other than the redactions above.

Preserve the sender's headings, numbering, formatting and errors.
Do not summarise. Do not paraphrase. Do not correct typos or grammar.
If it arrived as a PDF or on paper, transcribe it faithfully and note that the
original is available on request.

A blockquote is the house style for the quoted text, so that the sender's words
and this project's annotations can never be confused.
-->

---

## Notes on processing

<!--
FACTUAL annotations only, in the style of github/dmca's annotations:

 - how and where it arrived
 - which targets were marked [invalid], and why
 - whether a confidentiality request was made, and that it was not honoured
   unless a court ordered it
 - whether counsel was involved, and who
 - anything routed upstream (OSMF, a hosting provider) rather than acted on here
 - the date it was mirrored to Lumen

NO ARGUMENT HERE. Rebuttal, refusal and reasoning go in the -response file, so
that this file stays a record of what was received rather than a reply to it.
-->
