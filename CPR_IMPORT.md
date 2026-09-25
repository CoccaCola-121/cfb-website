# CPR classes

In Settings, switch to CPR, upload PlayerBios.csv, open the CPR board, and save changes. New classes begin with offers locked. Opening the board creates a player thread for each free agent meeting these overall minimums:

| Position | Overall |
| --- | --- |
| S, TE | 30 |
| QB, DL, LB | 35 |
| RB, CB, OL | 37 |
| WR | 50 |
| K, P | 57 |

The entire FA roster is retained. Coaches use **Submit offer** from either the CPR board or My Offers. The submission looks for a unique CSV player in the offer header; optional name and position fields resolve missing information. Ratings and home state come from the roster. The thread and offer are saved together. Existing threads are reused, and duplicate offers are rejected. Invalid or ambiguous matches keep the offer text open for correction.

PlayerBios `Country` supplies home state. `#` is a jersey number and is ignored for identity. `College`, `Age`, `Exp` and `Experience` are not used to guess previous team or eligibility. CPR cards omit empty metadata. Coach-created threads remain on the same board with a subtle label; name and position are sufficient input, and CSV data fills the rest.

The highest overall player in each position is a pitch recruit, with potential breaking ties; an exact overall/potential tie uses the first CSV row. This designation applies even below the automatic thread threshold. Pitch recruits have a free-write offer with no prompt or value grid and an 800-word limit, excluding valid standalone offer headers and a following Scholarship line. Other CPR players retain the existing CPR offer values. Pitch limits are checked by both browser and server.

The supplied PlayerBios sample contains 2,427 free agents and yields 54 automatic threads. It designates 11 pitch recruits; TE, RB and CB leaders are below the automatic thresholds. The sample was used for local tests, not published into live league state.

## League export enrichment
After loading the CSV, use **Player history → Upload league export** in CPR Settings. A background browser worker reads `.json` or decompresses `.json.gz`; only the matched metadata is staged, and **Save changes** publishes it. The full export is not uploaded or stored. The CSV remains the player identity source; exact name, position, overall, and potential must match a unique player (the CSV determines CPR eligibility, even if the export still has a team ID). Import before opening the board or enrich an existing board. Future coach-created players inherit enriched roster metadata.

Previous team uses dated stats and transactions from the preceding season. When stats are absent, a free-agent tenure of at most one year permits the latest older team; longer free-agent gaps do not carry an old team forward. Re-import the export to correct metadata saved by an older importer. Grade follows the bot's age/redshirt-history mapping. Years left includes the upcoming season: FR 4, SO 3, JR 2, SR 1. Redshirt grades have the same remaining years as their non-redshirt counterparts. Unknown grades remain blank.

## Scholarship history
In CPR Settings, import the league export to retain stable Player IDs, then use Scholarship history → Read scholarship history. The linked Google Sheet must allow link viewing and contain SR/JR/SO/FR/HS tabs with Player ID, Scholly offered?, and On Scholly? headers. The HS A1 class year must match the imported export season. The source is read only when requested; nothing is read automatically or applied to an old test class.

A TRUE/Yes in Scholly offered?, On Scholly?, or WO Upgrade is positive scholarship evidence. CPR alone is not assumed to mean scholarship. Positive records persist by player ID even when a later snapshot removes a row or changes it to No. Missing IDs are reported, never guessed from ratings or names. Reading stages the history and source snapshot; Save changes publishes, Discard restores the previous state. New coach-created threads inherit the roster flag. Pitch badges take priority; otherwise prior scholarship status or an overall above the position cutoff produces the gray Scholarship recruit badge and Scholarship filter category.
