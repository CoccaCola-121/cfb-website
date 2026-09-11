# Transfer season

In Settings, select Transfers, upload the original text PDF, review the extracted
players, click **Load reviewed transfer class**, then **Open Transfers board**.
The stage selector's existing confirmation still applies when replacing another
season. Uploading the example during development does not activate it in production.

The board opens directly from Prospect Board. Players retain their exact document
order, including UAB and any EE-rules entries at the end. No alphabetical resort,
star tiers, or recruiting-value grid is applied. Source school, grade, years left,
broken promise, and prompt are retained in the roster and released players.
Missing grades display as not listed and can be corrected in the import review.

PDF headers follow the supplied example:

    Player Name POS Previous School 45/70 RS JR 2 years left- Broken promise
    The player's prompt follows here.

Wrapped promises, `yrs`, missing grade, and grade before OVR/POT are supported.
A recognized school can also precede the position. Review is editable because PDF
formatting can vary. Scanned/image-only PDFs require a text export first.

CSV is an alternative with these columns (keep multiline prompts quoted):

    Name,Position,Overall,Potential,Transferring From,Grade,Years Left,Broken Promise,Prompt

Transfer pitches allow 800 whitespace-separated words. A standalone heading such
as `Michigan State offers John Smith` or `Offer #12` is excluded. Prose on that
same line, promises, and visit text count. The editor shows a counter and preserves
an overlong draft for correction; direct offer creation and the save endpoint also
check the limit. Existing unchanged historical pitches do not block other saves.

Checks: `node --test tests/*.test.*`. The supplied 2061 PDF was also extracted with
the vendored PDF.js reader: 61 players, including the two unlisted grades and the
final Missouri EE-rules entry. No example player data is bundled into the live app.
