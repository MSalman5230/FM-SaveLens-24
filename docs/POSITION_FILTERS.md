# Position filters

The sidebar supports multiple positions, checked options, removable chips, and **Clear positions**. Type a position abbreviation to find it and use the arrow keys and Enter to select it. **AND — All selected** is the default; with two or more selections, you can switch to **OR — Any selected**. No selections means no position restriction. Each selected position uses the same fixed minimum familiarity of **15** (accomplished or natural).

Adding or removing a position or changing the matching mode returns to page 1. Position chips remain in the horizontal filter bar; matching controls and Clear positions stay visible with the other filter details. Removing the last position, Clear positions, and Reset restore AND. The matching mode alone does not count as an active filter. Position changes preserve other filters, sorting, columns, and the selected rating system. All filter details remain open.

## Player query parameters

Both the Rust API and TypeScript reference query accept these parameters on player searches:

| Parameter | Meaning |
| --- | --- |
| `position` | Comma-separated numeric position IDs. Omitted or empty means unrestricted. A single ID remains supported. |
| `positionMatch` | `and` (default) or `or`. Any other value, including an explicitly empty value, is rejected. |

IDs come from the existing `/api/attributes` position catalog (array indices):

| ID | Position | ID | Position | ID | Position |
| --- | --- | --- | --- | --- | --- |
| 0 | GK | 5 | DM | 10 | AMC |
| 1 | SW | 6 | ML | 11 | AMR |
| 2 | DL | 7 | MC | 12 | ST |
| 3 | DC | 8 | MR | 13 | WBL |
| 4 | DR | 9 | AML | 14 | WBR |

Examples (append to the player-search endpoint):

- `?position=2,4&positionMatch=and`: DL **and** DR must each be 15+.
- `?position=2,4&positionMatch=or`: DL **or** DR must be 15+.
- `?position=2,4,14`: DL, DR, and WBR must all be 15+.
- `?position=12`: legacy single-position request for ST at 15+.
- `?position=0`: GK at 15+.
- `?position=2,4&positionMatch=or&club=1&attr_pace=16&limit=50&page=2`: either position at 15+, club 1, Pace 16+, then page 2 of the filtered results.

IDs must be decimal integers in the catalog. Surrounding whitespace is trimmed and duplicate IDs are deduplicated. Unknown IDs, fractions, names, and empty list entries such as `2,,4` or `2,` return a query error (HTTP 400). An invalid matching mode is rejected even without a position selection.

The saved position mask already records ratings ≥15. Queries combine the selected bits into a mask and apply `(position_mask & selected_mask) = selected_mask` for AND or `(position_mask & selected_mask) != 0` for OR. The condition combines with other filters using AND, before counting, sorting, and pagination. Position familiarity stays separate from role-attribute ratings. No snapshot migration or reimport is needed.
