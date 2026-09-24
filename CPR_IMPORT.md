# CPR classes

In Settings, switch to CPR, upload PlayerBios.csv, open the CPR board, and save changes. New classes begin with offers locked. Opening the board creates a player thread for each free agent meeting these overall minimums:

| Position | Overall |
| --- | --- |
| S, TE | 30 |
| QB, DL, LB | 35 |
| RB, CB, OL | 37 |
| WR | 50 |
| K, P | 57 |

The entire FA roster is retained. Coaches can use **Create a player thread** on the CPR board for other CSV players. Name, position, overall and potential must match a unique CSV record. Repeating a request opens the existing player; it does not create another thread. The server validates the player against the roster too.

PlayerBios `Country` supplies home state. `#` is a jersey number and is ignored for identity. `College`, `Age`, `Exp` and `Experience` are not used to guess previous team or eligibility. Optional `Previous Team` and `Years Left` columns can supply those fields; otherwise they show Not provided. Staff with Settings access can edit those details from the player page.

The highest overall player in each position is a pitch recruit, with potential breaking ties; an exact overall/potential tie uses the first CSV row. This designation applies even below the automatic thread threshold. Pitch recruits have a free-write offer with no prompt or value grid and an 800-word limit, excluding valid standalone offer headers and a following Scholarship line. Other CPR players retain the existing CPR offer values. Pitch limits are checked by both browser and server.

The supplied PlayerBios sample contains 2,427 free agents and yields 54 automatic threads. It designates 11 pitch recruits; TE, RB and CB leaders are below the automatic thresholds. The sample was used for local tests, not published into live league state.
