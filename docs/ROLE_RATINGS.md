# FM24 role ratings

The protected **Role Highlighted Rating** preset contains 45 roles and 85 role-and-duty profiles. Catalog version: fm24-roles-1; model: key2-preferable1-v1.

Create custom weights and additional named roles in **Settings → Rating systems**. See [custom rating systems](RATING_SYSTEMS.md) for the editor, generalized formula, persistence, and API. The research, highlights, and 2:1 formula below describe the built-in preset.

## Research and interpretation

- [Squad Analyzer FM2024: Important_attributes_per_role](https://docs.google.com/spreadsheets/d/1cq4W3ippnF-5XQUIlONsd4yGip8IvGrUICYmWempTe0/edit#gid=1821538342) (read 2026-09-05)
- [Sports Interactive FM24 manual: Roles and Duties](https://community.sports-interactive.com/sigames-manual/football-manager-2024/tactics-r4960/)
- [Community analyzer documentation (2/1/0 weights)](https://github.com/ami-167/Squad_analyzer_FM_2024/blob/8f10a4b658ab0ebdc863cdaf58fd5296b1cd0ce3/README%20v1.0.md)

The community matrix explicitly records green (key), blue (preferable), and unhighlighted attributes. These are community-transcribed FM24 highlights, not an official machine-readable dataset. The FM24 manual confirms that roles and duties require different attributes. The archived matrix is in `research/fm24-role-attributes.txt`; column names map to the existing SaveLens attribute catalog. Runtime use is entirely offline.

The fixed 2:1 weights are the SaveLens model, also used by the community analyzer; no official numeric weights were verified. This measures attribute fit, not match-performance prediction or in-game coach stars. It does not use CA/PA, hidden attributes, feet, or position familiarity. A higher score in a simpler role does not guarantee better match results than a lower score in a demanding role.

FM24-specific coverage includes Inverted Full-Back (Defend) and Libero (Defend/Support). Automatic duties switch among concrete Defend/Support/Attack duties with mentality, so have no separate profile. Shared roles are not duplicated by side or position.

Other candidate datasets were excluded: CulturedLeftFoot/FM24Players now contains FM26 possession-phase roles; mickyyy68/fm24-scout adds custom physical-attribute weights; ElectroHugin/FM-Player-Analyzer has incomplete coverage and includes Handling in a Wide Centre-Back profile.

## Calculation

`score = 5 × (2 × sum(key) + sum(preferable)) / (2 × count(key) + count(preferable))`

Use displayed 1–20 attributes and retain precision until display (one decimal). All 1 gives 5/100, all 15 gives 75/100, all 20 gives 100/100. A weighted average of 15.7/20 gives 78.5/100. Missing, nonnumeric, or out-of-range weighted attributes make the entire role rating unavailable; unhighlighted missing attributes have no effect. Position familiarity is displayed separately.

## API

- `GET /api/roles` returns this catalog and model versions.
- Player details include `roleRatings`: `{roleId, score, missingAttributes}` for all 85 profiles. Missing attributes include invalid values; unavailable scores are `null`.
- Player search accepts `role=af-attack`, `roleMin=70.5`, and `sort=roleRating`. A selected role adds `roleRating` to each result. Thresholds (finite 0–100) and role sorting require a valid role. Null scores sort last in either direction. Scores are filtered and sorted before pagination, with CA descending and ID ascending as tie-breakers.
- To display multiple columns, pass `roles=af-attack,ap-support,tf-support`. Each result includes `roleScores`, a map from requested role IDs to scores or `null`. All 85 profiles may be requested together; duplicate IDs are deduplicated and unknown IDs are rejected. Extra display scores are calculated only for the returned page.
- `sort=role:tf-support` sorts the entire matching set by that role independently of the `role`/`roleMin` filter. Null scores remain last, with the same stable tie-breakers. Display columns never add implicit position or rating filters.
- Ratings are derived from existing snapshots; no reimport or schema migration is needed.

## All role profiles

### Goalkeepers

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| Goalkeeper (Defend) | Concentration, Positioning, Agility, Aerial reach, Command of area, Communication, Handling, Kicking, Reflexes | Anticipation, Decisions, One on ones, Throwing |
| Sweeper Keeper (Defend) | Anticipation, Concentration, Positioning, Agility, Command of area, Kicking, One on ones, Reflexes | First touch, Passing, Composure, Decisions, Vision, Acceleration, Aerial reach, Communication, Handling, Rushing out tendency, Throwing |
| Sweeper Keeper (Support) | Anticipation, Composure, Concentration, Positioning, Agility, Command of area, Kicking, One on ones, Reflexes, Rushing out tendency | First touch, Passing, Decisions, Vision, Acceleration, Aerial reach, Communication, Handling, Throwing |
| Sweeper Keeper (Attack) | Anticipation, Composure, Concentration, Positioning, Agility, Command of area, Kicking, One on ones, Reflexes, Rushing out tendency | First touch, Passing, Decisions, Vision, Acceleration, Aerial reach, Communication, Eccentricity, Handling, Throwing |

### Central defenders

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| Central Defender (Defend) | Heading, Marking, Tackling, Positioning, Jumping reach, Strength | Aggression, Anticipation, Bravery, Composure, Concentration, Decisions, Pace |
| Central Defender (Stopper) | Heading, Tackling, Aggression, Bravery, Decisions, Positioning, Jumping reach, Strength | Marking, Anticipation, Composure, Concentration |
| Central Defender (Cover) | Marking, Tackling, Anticipation, Concentration, Decisions, Positioning, Pace | Heading, Bravery, Composure, Jumping reach, Strength |
| No-Nonsense Centre-Back (Defend) | Heading, Marking, Tackling, Positioning, Jumping reach, Strength | Aggression, Anticipation, Bravery, Concentration, Pace |
| No-Nonsense Centre-Back (Stopper) | Heading, Tackling, Aggression, Bravery, Positioning, Jumping reach, Strength | Marking, Anticipation, Concentration |
| No-Nonsense Centre-Back (Cover) | Marking, Tackling, Anticipation, Concentration, Positioning, Pace | Heading, Bravery, Jumping reach, Strength |
| Ball-Playing Defender (Defend) | Heading, Marking, Passing, Tackling, Composure, Positioning, Jumping reach, Strength | First touch, Technique, Aggression, Anticipation, Bravery, Concentration, Decisions, Vision, Pace |
| Ball-Playing Defender (Stopper) | Heading, Passing, Tackling, Aggression, Bravery, Composure, Decisions, Positioning, Jumping reach, Strength | First touch, Marking, Technique, Anticipation, Concentration, Vision |
| Ball-Playing Defender (Cover) | Marking, Passing, Tackling, Anticipation, Composure, Concentration, Decisions, Positioning, Pace | First touch, Heading, Technique, Bravery, Vision, Jumping reach, Strength |
| Libero (Defend) | First touch, Heading, Marking, Passing, Tackling, Technique, Composure, Decisions, Positioning, Teamwork, Jumping reach, Strength | Anticipation, Bravery, Concentration, Pace, Stamina |
| Libero (Support) | First touch, Heading, Marking, Passing, Tackling, Technique, Composure, Decisions, Positioning, Teamwork, Jumping reach, Strength | Dribbling, Anticipation, Bravery, Concentration, Vision, Pace, Stamina |
| Wide Centre-Back (Defend) | Heading, Marking, Tackling, Positioning, Jumping reach, Strength | Dribbling, First touch, Passing, Technique, Aggression, Anticipation, Bravery, Composure, Concentration, Decisions, Work rate, Agility, Pace |
| Wide Centre-Back (Support) | Dribbling, Heading, Marking, Tackling, Positioning, Jumping reach, Pace, Strength | Crossing, First touch, Passing, Technique, Aggression, Anticipation, Bravery, Composure, Concentration, Decisions, Off the ball, Work rate, Agility, Stamina |
| Wide Centre-Back (Attack) | Crossing, Dribbling, Heading, Marking, Tackling, Off the ball, Jumping reach, Pace, Stamina, Strength | First touch, Passing, Technique, Aggression, Anticipation, Bravery, Composure, Concentration, Decisions, Positioning, Work rate, Agility |

### Full-backs and wing-backs

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| No-Nonsense Full-Back (Defend) | Marking, Tackling, Anticipation, Positioning, Strength | Heading, Aggression, Bravery, Concentration, Teamwork |
| Full-Back (Defend) | Marking, Tackling, Anticipation, Concentration, Positioning | Crossing, Passing, Decisions, Teamwork, Work rate, Pace, Stamina |
| Full-Back (Support) | Marking, Tackling, Anticipation, Concentration, Positioning, Teamwork | Crossing, Dribbling, Passing, Technique, Decisions, Work rate, Pace, Stamina |
| Full-Back (Attack) | Crossing, Marking, Tackling, Anticipation, Positioning, Teamwork | Dribbling, First touch, Passing, Technique, Concentration, Decisions, Off the ball, Work rate, Agility, Pace, Stamina |
| Inverted Full-Back (Defend) | Heading, Marking, Tackling, Positioning, Strength | Dribbling, First touch, Passing, Technique, Aggression, Anticipation, Bravery, Composure, Concentration, Decisions, Work rate, Agility, Jumping reach, Pace |
| Wing-Back (Defend) | Marking, Tackling, Anticipation, Positioning, Teamwork, Work rate, Acceleration, Stamina | Crossing, Dribbling, First touch, Passing, Technique, Concentration, Decisions, Off the ball, Agility, Balance, Pace |
| Wing-Back (Support) | Crossing, Dribbling, Marking, Tackling, Off the ball, Teamwork, Work rate, Acceleration, Stamina | First touch, Passing, Technique, Anticipation, Concentration, Decisions, Positioning, Agility, Balance, Pace |
| Wing-Back (Attack) | Crossing, Dribbling, Tackling, Technique, Off the ball, Teamwork, Work rate, Acceleration, Pace, Stamina | First touch, Marking, Passing, Anticipation, Concentration, Decisions, Flair, Positioning, Agility, Balance |
| Complete Wing-Back (Support) | Crossing, Dribbling, Technique, Off the ball, Teamwork, Work rate, Acceleration, Stamina | First touch, Marking, Passing, Tackling, Anticipation, Decisions, Flair, Positioning, Agility, Balance, Pace |
| Complete Wing-Back (Attack) | Crossing, Dribbling, Technique, Flair, Off the ball, Teamwork, Work rate, Acceleration, Stamina | First touch, Marking, Passing, Tackling, Anticipation, Decisions, Positioning, Agility, Balance, Pace |
| Inverted Wing-Back (Defend) | Passing, Tackling, Anticipation, Decisions, Positioning, Teamwork | First touch, Marking, Technique, Composure, Concentration, Off the ball, Work rate, Acceleration, Agility, Stamina |
| Inverted Wing-Back (Support) | First touch, Passing, Tackling, Composure, Decisions, Teamwork | Marking, Technique, Anticipation, Concentration, Off the ball, Positioning, Vision, Work rate, Acceleration, Agility, Stamina |
| Inverted Wing-Back (Attack) | First touch, Passing, Tackling, Technique, Composure, Decisions, Off the ball, Teamwork, Vision, Acceleration | Crossing, Dribbling, Long shots, Marking, Anticipation, Concentration, Flair, Positioning, Work rate, Agility, Pace, Stamina |

### Central and defensive midfielders

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| Advanced Playmaker (Support) | First touch, Passing, Technique, Composure, Decisions, Off the ball, Teamwork, Vision | Dribbling, Anticipation, Flair, Agility |
| Advanced Playmaker (Attack) | First touch, Passing, Technique, Composure, Decisions, Off the ball, Teamwork, Vision | Dribbling, Anticipation, Flair, Acceleration, Agility |
| Anchor (Defend) | Marking, Tackling, Anticipation, Concentration, Decisions, Positioning | Composure, Teamwork, Strength |
| Ball-Winning Midfielder (Defend) | Tackling, Aggression, Anticipation, Teamwork, Work rate, Stamina | Marking, Bravery, Concentration, Positioning, Agility, Pace, Strength |
| Ball-Winning Midfielder (Support) | Tackling, Aggression, Anticipation, Teamwork, Work rate, Stamina | Marking, Passing, Bravery, Concentration, Agility, Pace, Strength |
| Box-to-Box Midfielder (Support) | Passing, Tackling, Off the ball, Teamwork, Work rate, Stamina | Dribbling, Finishing, First touch, Long shots, Technique, Aggression, Anticipation, Composure, Decisions, Positioning, Acceleration, Balance, Pace, Strength |
| Carrilero (Support) | First touch, Passing, Tackling, Decisions, Positioning, Teamwork, Stamina | Technique, Anticipation, Composure, Concentration, Off the ball, Vision, Work rate |
| Central Midfielder (Defend) | Tackling, Concentration, Decisions, Positioning, Teamwork | First touch, Marking, Passing, Technique, Aggression, Anticipation, Composure, Work rate, Stamina |
| Central Midfielder (Support) | First touch, Passing, Tackling, Decisions, Teamwork | Technique, Anticipation, Composure, Concentration, Off the ball, Vision, Work rate, Stamina |
| Central Midfielder (Attack) | First touch, Passing, Decisions, Off the ball | Long shots, Tackling, Technique, Anticipation, Composure, Teamwork, Vision, Work rate, Acceleration, Stamina |
| Deep-Lying Playmaker (Defend) | First touch, Passing, Technique, Composure, Decisions, Teamwork, Vision | Tackling, Anticipation, Positioning, Balance |
| Deep-Lying Playmaker (Support) | First touch, Passing, Technique, Composure, Decisions, Teamwork, Vision | Anticipation, Off the ball, Positioning, Balance |
| Defensive Midfielder (Defend) | Tackling, Anticipation, Concentration, Positioning, Teamwork | Marking, Passing, Aggression, Composure, Decisions, Work rate, Stamina, Strength |
| Defensive Midfielder (Support) | Tackling, Anticipation, Concentration, Positioning, Teamwork | First touch, Marking, Passing, Aggression, Composure, Decisions, Work rate, Stamina, Strength |
| Half Back (Defend) | Marking, Tackling, Anticipation, Composure, Concentration, Decisions, Positioning, Teamwork | First touch, Passing, Aggression, Bravery, Work rate, Jumping reach, Stamina, Strength |
| Mezzala (Support) | Passing, Technique, Decisions, Off the ball, Work rate, Acceleration | Dribbling, First touch, Long shots, Tackling, Anticipation, Composure, Vision, Balance, Stamina |
| Mezzala (Attack) | Dribbling, Passing, Technique, Decisions, Off the ball, Vision, Work rate, Acceleration | Finishing, First touch, Long shots, Anticipation, Composure, Flair, Balance, Stamina |
| Regista (Support) | First touch, Passing, Technique, Composure, Decisions, Flair, Off the ball, Teamwork, Vision | Dribbling, Long shots, Anticipation, Balance |
| Roaming Playmaker (Support) | First touch, Passing, Technique, Anticipation, Composure, Decisions, Off the ball, Teamwork, Vision, Work rate, Acceleration, Stamina | Dribbling, Long shots, Concentration, Positioning, Agility, Balance, Pace |
| Segundo Volante (Support) | Marking, Passing, Tackling, Off the ball, Positioning, Work rate, Pace, Stamina | Finishing, First touch, Long shots, Anticipation, Composure, Concentration, Decisions, Acceleration, Balance, Strength |
| Segundo Volante (Attack) | Finishing, Long shots, Passing, Tackling, Anticipation, Off the ball, Positioning, Work rate, Pace, Stamina | First touch, Marking, Composure, Concentration, Decisions, Acceleration, Balance, Strength |

### Wide roles

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| Defensive Winger (Defend) | Technique, Anticipation, Off the ball, Positioning, Teamwork, Work rate, Stamina | Crossing, Dribbling, First touch, Marking, Tackling, Aggression, Concentration, Decisions, Acceleration |
| Defensive Winger (Support) | Crossing, Technique, Off the ball, Teamwork, Work rate, Stamina | Dribbling, First touch, Marking, Passing, Tackling, Aggression, Anticipation, Composure, Concentration, Decisions, Positioning, Acceleration |
| Inside Forward (Support) | Dribbling, Finishing, First touch, Technique, Off the ball, Acceleration, Agility | Long shots, Passing, Anticipation, Composure, Flair, Vision, Work rate, Balance, Pace, Stamina |
| Inside Forward (Attack) | Dribbling, Finishing, First touch, Technique, Anticipation, Off the ball, Acceleration, Agility | Long shots, Passing, Composure, Flair, Work rate, Balance, Pace, Stamina |
| Inverted Winger (Support) | Crossing, Dribbling, Passing, Technique, Acceleration, Agility | First touch, Long shots, Composure, Decisions, Off the ball, Vision, Work rate, Balance, Pace, Stamina |
| Inverted Winger (Attack) | Crossing, Dribbling, Passing, Technique, Acceleration, Agility | First touch, Long shots, Anticipation, Composure, Decisions, Flair, Off the ball, Vision, Work rate, Balance, Pace, Stamina |
| Raumdeuter (Attack) | Finishing, Anticipation, Composure, Concentration, Decisions, Off the ball, Balance | First touch, Technique, Work rate, Acceleration, Stamina |
| Wide Midfielder (Defend) | Passing, Tackling, Concentration, Decisions, Positioning, Teamwork, Work rate | Crossing, First touch, Marking, Technique, Anticipation, Composure, Stamina |
| Wide Midfielder (Support) | Passing, Tackling, Decisions, Teamwork, Work rate, Stamina | Crossing, First touch, Technique, Anticipation, Composure, Concentration, Off the ball, Positioning, Vision |
| Wide Midfielder (Attack) | Crossing, First touch, Passing, Decisions, Teamwork, Work rate, Stamina | Tackling, Technique, Anticipation, Composure, Off the ball, Vision |
| Wide Playmaker (Support) | First touch, Passing, Technique, Composure, Decisions, Teamwork, Vision | Dribbling, Off the ball, Agility |
| Wide Playmaker (Attack) | Dribbling, First touch, Passing, Technique, Composure, Decisions, Off the ball, Teamwork, Vision | Anticipation, Flair, Acceleration, Agility |
| Wide Target Forward (Support) | Heading, Bravery, Teamwork, Jumping reach, Strength | Crossing, First touch, Anticipation, Off the ball, Work rate, Balance, Stamina |
| Wide Target Forward (Attack) | Heading, Bravery, Off the ball, Jumping reach, Strength | Crossing, Finishing, First touch, Anticipation, Teamwork, Work rate, Balance, Stamina |
| Winger (Support) | Crossing, Dribbling, Technique, Acceleration, Agility | First touch, Passing, Off the ball, Work rate, Balance, Pace, Stamina |
| Winger (Attack) | Crossing, Dribbling, Technique, Acceleration, Agility | First touch, Passing, Anticipation, Flair, Off the ball, Work rate, Balance, Pace, Stamina |

### Attacking midfielders and forwards

| Role and duty | Key attributes (×2) | Preferable attributes (×1) |
|---|---|---|
| Attacking Midfielder (Support) | First touch, Long shots, Passing, Technique, Anticipation, Decisions, Flair, Off the ball | Dribbling, Composure, Vision, Agility |
| Attacking Midfielder (Attack) | Dribbling, First touch, Long shots, Passing, Technique, Anticipation, Decisions, Flair, Off the ball | Finishing, Composure, Vision, Agility |
| Enganche (Support) | First touch, Passing, Technique, Composure, Decisions, Vision | Dribbling, Anticipation, Flair, Off the ball, Agility |
| Shadow Striker (Attack) | Dribbling, Finishing, First touch, Anticipation, Composure, Off the ball, Acceleration | Passing, Technique, Concentration, Decisions, Work rate, Agility, Balance, Pace, Stamina |
| Advanced Forward (Attack) | Dribbling, Finishing, First touch, Technique, Composure, Off the ball, Acceleration | Passing, Anticipation, Decisions, Work rate, Agility, Balance, Pace, Stamina |
| Complete Forward (Support) | Dribbling, First touch, Heading, Long shots, Passing, Technique, Anticipation, Composure, Decisions, Off the ball, Vision, Acceleration, Agility, Strength | Finishing, Teamwork, Work rate, Balance, Jumping reach, Pace, Stamina |
| Complete Forward (Attack) | Dribbling, Finishing, First touch, Heading, Technique, Anticipation, Composure, Off the ball, Acceleration, Agility, Strength | Long shots, Passing, Decisions, Teamwork, Vision, Work rate, Balance, Jumping reach, Pace, Stamina |
| Deep-Lying Forward (Support) | First touch, Passing, Technique, Composure, Decisions, Off the ball, Teamwork | Finishing, Anticipation, Flair, Vision, Balance, Strength |
| Deep-Lying Forward (Attack) | First touch, Passing, Technique, Composure, Decisions, Off the ball, Teamwork | Dribbling, Finishing, Anticipation, Flair, Vision, Balance, Strength |
| False Nine (Support) | Dribbling, First touch, Passing, Technique, Composure, Decisions, Off the ball, Vision, Acceleration, Agility | Finishing, Anticipation, Flair, Teamwork, Balance |
| Poacher (Attack) | Finishing, Anticipation, Composure, Off the ball | First touch, Heading, Technique, Decisions, Acceleration |
| Pressing Forward (Defend) | Aggression, Anticipation, Bravery, Decisions, Teamwork, Work rate, Acceleration, Pace, Stamina | First touch, Composure, Concentration, Agility, Balance, Strength |
| Pressing Forward (Support) | Aggression, Anticipation, Bravery, Decisions, Teamwork, Work rate, Acceleration, Pace, Stamina | First touch, Passing, Composure, Concentration, Off the ball, Agility, Balance, Strength |
| Pressing Forward (Attack) | Aggression, Anticipation, Bravery, Off the ball, Teamwork, Work rate, Acceleration, Pace, Stamina | Finishing, First touch, Composure, Concentration, Decisions, Agility, Balance, Strength |
| Target Forward (Support) | Heading, Bravery, Teamwork, Balance, Jumping reach, Strength | Finishing, First touch, Aggression, Anticipation, Composure, Decisions, Off the ball |
| Target Forward (Attack) | Finishing, Heading, Bravery, Composure, Off the ball, Balance, Jumping reach, Strength | First touch, Aggression, Anticipation, Decisions, Teamwork |
| Trequartista (Attack) | Dribbling, First touch, Passing, Technique, Composure, Decisions, Flair, Off the ball, Vision, Acceleration | Finishing, Anticipation, Agility, Balance |

## Updating

Edit the archived factual matrix only after checking its source; update the catalog/model version when definitions/weights change. Run `node scripts/role-catalog.mjs` to regenerate the bundled catalog and this document; `node scripts/role-catalog.mjs --check` detects drift without writing.
