# FM-Arena Hybrid Rating

Choose **Settings → Rating systems → FM-Arena Hybrid Rating → Use system** to activate the protected preset. It covers the same 45 roles and 85 role-and-duty profiles as Role Highlighted Rating. Installing the preset leaves the active selection and existing definitions intact. **New system** creates an independent editable copy.

System ID: `fm-arena-hybrid-rating`; revision: `1`; model: `fm-arena-hybrid-v1`. Runtime scoring is offline and uses existing snapshots without reimporting them.

## Evidence and interpretation

The bundled factual dataset, `native/fm_arena_evidence.json`, transcribes the first post of [FM-Arena's FM24 attribute testing](https://fm-arena.com/thread/14009-attribute-testing-football-manager-24/) (published 2025-01-05, edited 2025-01-12, accessed 2026-09-06). It preserves tested ranges, points, goals for, goals against, zero results, and explicitly untested set-piece attributes. An absent attribute has no reported result in this dataset; it is not classified as experimentally ineffective.

Outfield experiments changed the chosen attribute across all outfield players together. Goalkeeper results are separate. The author reports approximately 9,000 matches per attribute with remaining noise around ±1.5 season points; this is not a supplied formal confidence interval. See the [methodology discussion](https://fm-arena.com/thread/14009-attribute-testing-football-manager-24/page-3/).

This is an **evidence-informed performance index**, not a validated individual match forecast, expected league-points total, or reproduction of coach stars. The 70/30 blend and role boosts are SaveLens modeling choices. Team-level experiments do not establish role-specific effects; zero measured effect does not establish universal irrelevance. Small rating differences should not be interpreted as proven performance differences.

## Formula

For an attribute `a` and role/duty `r`:

```text
impact(a) = reported points improvement / (tested upper value - tested lower value)
boost(r, a) = 1.5 if key; 1.25 if preferable; 1 otherwise
experimental(r, a) = impact(a) × boost(r, a)
testingWeight(r, a) = experimental(r, a) / sum(experimental(r, all attributes))

highlight(r, a) = 2 if key; 1 if preferable; 0 otherwise
roleWeight(r, a) = highlight(r, a) / sum(highlight(r, all attributes))

finalWeight(r, a) = 100 × (0.70 × testingWeight(r, a) + 0.30 × roleWeight(r, a))
rating(r) = 5 × sum(attributeValue(a) × finalWeight(r, a)) / sum(finalWeight(r, a))
```

Weights total approximately 100; floating-point precision is retained. Each component is normalized separately, so different role highlight counts do not change the 70/30 allocation. The backend uses the same explicit combined weights for SQL queries and player details.

Points improvement is the sole experimental weighting measure. Goals for and against are retained as evidence but not added to points again. Jumping Reach uses its **8–17** range (`16 / 9`); other included tests use **8–20**. The resulting linear weights apply across displayed values 1–20, including values outside the experimental range. There is no invented cap at 17 or low-attribute threshold.

The testing component includes the outfield Physical, Mental, Technical, and Consistency results. The four GK profiles instead use the separate goalkeeper table, including its physical and mental entries. For example, outfield pace and Consistency effects do not enter GK profiles. Highlighted attributes still receive their role contribution even when no experimental effect was reported.

Set-piece taking, feet, other hidden attributes, morale, condition, and team cohesion are excluded. Position familiarity remains separately displayed. These exclusions define a general-purpose attribute index, not a match-readiness score or set-piece specialist selector.

## Worked example: Central Defender (Defend)

Long Shots has a reported improvement of 6 points across 12 attribute steps, so its experimental importance is `0.5`. It is not highlighted for CD (Defend), receives a ×1 boost, and has no role-component contribution. The adjusted experimental denominator for that profile is `349.25 / 12`.

```text
Long Shots final weight = 100 × 0.70 × (0.5 / (349.25 / 12))
                       = 1.2025769506%

Rating gain from Long Shots 10 → 20
                       = 5 × 10 × 0.012025769506
                       = 0.6012884753 rating points on the 100-point scale
```

Thus an unhighlighted but experimentally positive attribute contributes a small amount. In contrast, Marking has zero reported experimental effect but keeps the CD key-attribute contribution from the 30% role component.

## Display, API, and compatibility

Scores are displayed to one decimal, with effective percentages and per-attribute points in the player breakdown. The breakdown also shows `70% × testingScore + 30% × roleScore`. Displayed weights/component values are rounded for readability only; calculations, copies, filtering, and sorting retain full precision.

All 1 gives 5/100, all 15 gives 75/100, and all 20 gives 100/100, within floating-point precision. Missing, nonnumeric, or out-of-range positively weighted attributes make the score unavailable. Excluded attributes do not affect availability. There is no silent reweighting of partial data.

The existing rating-system endpoints expose the preset and protect it from modification/deletion. Its active catalog includes `modelVersion: "fm-arena-hybrid-v1"` and the FM-Arena source, omitting `keyWeight` and `preferableWeight`. Available hybrid detail ratings additionally include:

```json
{"components": {"testingScore": 75, "roleScore": 75}}
```

Unavailable hybrid ratings omit `components`. Original and custom ratings also omit it. Custom copies keep the explicit final weights, remain independent, and use `attribute-weights-v1`; subsequent edits are not represented as a 70/30 blend.

Persistence stays at schema version 1 and stores only custom definitions plus the active system ID. An existing custom system with the new preset's name remains loadable and editable; built-in/custom labels distinguish it in Settings. New naming changes cannot take a reserved preset name. Deleting an active custom system falls back to FM-Arena Hybrid Rating.

Changes to the evidence, blend, or boosts require a new model version and system revision, with regression checks for SQL/detail agreement and the worked example.
