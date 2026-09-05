# FM24 reader evidence

FM SaveLens 24 uses an independently implemented Rust reader in `native/parser/`, ported from the retained TypeScript development reference in `server/parser/`. The field descriptions below document their shared, verified format boundary. It uses structural validation and entity ownership checks, rather than transferring FM26 offsets unchanged. It is not a general decoder of every undocumented FM archive revision.

## Archive

The 26-byte header has the `02 01 66 6d 66 2e` signature. Compression byte 25 is 0 (plain) or 3 (Zstandard). The little-endian pointer at header +9 locates the nested compressed manifest with the FM24 adjustment implemented in `archive.ts`. Manifest entries provide named members with offsets, stored sizes, and uncompressed sizes. Bounds and decompressed lengths are checked.

Only `game_info.dat` and `game_db.dat` are materialized; unrelated match-history members are not loaded. The database is currently scanned in memory. The format gate checks the internal save version `24.3.0+0` before reading player records. The game date is read from FM24 database offsets 36 and 38; date-of-birth values use one-based day-of-year numbering.

## Names and ownership

Three separately counted string pools have contiguous IDs: first names, surnames, and common names. Empty strings and the explicit `0xffffffff` missing-name reference are valid; the latter is used by single-name players such as Davinchi. The person records reference these pools and may include an inline full name. The displayed name uses the verified first/surname fields; a third name reference can refer to a second surname and is not blindly treated as a common-name index. This is why the screenshot's shortened **Enol** appears as **Enol Sarmiento**.

Person identities form an ascending entity-ID sequence. Public UID and source UID are usually equal, but edited databases contain real exceptions. Those exceptions additionally require the dated person header and verified flag patterns. Player attributes occur in a separate serialized block. The preceding entity ID plus one must equal the independently resolved player's entity ID, and exactly one candidate block must belong to that record interval. The reader excludes unresolved ownership and reports it instead of assigning a nearby player's ratings.

This second-ID distinction matters: requiring equal UIDs everywhere silently omits players added by edited databases and can also hide the following player's attribute block. The full collection checks exercise these cases.

## Ratings

The verified ability fields are unsigned 16-bit values at attribute-block offsets -38 (CA) and -36 (PA). PA need not exceed CA in edited saves. Fifteen position bytes precede the block. Fifty-four playing/hidden/foot attributes use raw 1–100 values; displayed ratings are `max(1, min(20, round(raw / 5)))`. Eight personality ratings come from the person record and are already on the 1–20 scale.

`server/parser/attributes.ts` is the explicit 62-field mapping. All 62 fields matched both independent FMRTE exports, including aggression, flair, consistency, important matches, injury proneness, versatility, both feet, all goalkeeper attributes, and all eight personality ratings. Raw values and source byte offsets are retained in player details for audit/debugging.

The primary nation uses FM's internal ordinal, where zero is Algeria. Secondary citizenship is accepted only from tagged relationship entries. Club names are decoded from club records and linked through team ordinals, with separate handling for youth/reserve team conventions. Null links remain unavailable.

## Boundaries

- Other internal save versions, unsupported compression, invalid bounds, missing tables, and corrupt or truncated records produce explicit errors.
- Ratings are not estimated from CA or PA. Unsupported fields such as contract values, transfer costs, injuries, or preferred moves are not exposed.
- Reference validation proves the requested ratings for the supplied players. Collection validation additionally checks record ownership, identity uniqueness, record counts, date bounds, and source hashes across real saves; it is not an independent manual comparison of every player in every career.
- The cache fingerprint includes absolute source path, size, modification timestamp, and parser version. Stat checks surround parsing and cache creation. It is not a continuous filesystem watcher; returning focus to the app or refreshing the save list rechecks the source.

## Research attribution

Public [Gilet format research](https://github.com/fifteen15-labs/gilet/blob/main/docs/SAVE_FORMAT.md) provided initial archive/name-table clues. Its FM26 offsets were treated as hypotheses and re-established against FM24 files. The country-name dictionary contains factual FM nation-ID labels informed by that project's country data. Parser implementation, FM24 mappings, ownership checks, tests, local API, and application code were written for this project. No Genie Scout or FMRTE binaries or parser libraries are used.
