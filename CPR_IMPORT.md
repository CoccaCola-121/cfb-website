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
