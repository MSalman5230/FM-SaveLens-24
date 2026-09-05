// Reproduce the offline catalog and readable research notes from the source matrix.
// Run with --check in tests; without it, regenerate both artifacts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const source = read('research/fm24-role-attributes.txt');
const [header, ...rows] = source.trim().split('\n').filter(line => !line.startsWith('#'));
const keys = header.split(' ');
const attributes = JSON.parse(read('native/parser/attributes.json')).attributes;
const labels = Object.fromEntries(attributes.map(a => [a.key, a.label]));
assert.equal(keys.length, 47);
assert.equal(new Set(keys).size, 47);
keys.forEach(key => assert.ok(labels[key], key));
const groups = [
  ['Goalkeepers', 'G:Goalkeeper', 'SK:Sweeper Keeper'],
  ['Central defenders', 'CD:Central Defender', 'BPD:Ball-Playing Defender', 'NCB:No-Nonsense Centre-Back', 'WCB:Wide Centre-Back', 'L:Libero'],
  ['Full-backs and wing-backs', 'FB:Full-Back', 'WB:Wing-Back', 'NFB:No-Nonsense Full-Back', 'CWB:Complete Wing-Back', 'IWB:Inverted Wing-Back', 'IFB:Inverted Full-Back'],
  ['Central and defensive midfielders', 'DM:Defensive Midfielder', 'A:Anchor', 'HB:Half Back', 'DLP:Deep-Lying Playmaker', 'RGA:Regista', 'RPM:Roaming Playmaker', 'VOL:Segundo Volante', 'BWM:Ball-Winning Midfielder', 'CM:Central Midfielder', 'BBM:Box-to-Box Midfielder', 'CAR:Carrilero', 'MEZ:Mezzala', 'AP:Advanced Playmaker'],
  ['Wide roles', 'WM:Wide Midfielder', 'W:Winger', 'DW:Defensive Winger', 'WP:Wide Playmaker', 'IW:Inverted Winger', 'IF:Inside Forward', 'WT:Wide Target Forward', 'RMD:Raumdeuter'],
  ['Attacking midfielders and forwards', 'AM:Attacking Midfielder', 'EG:Enganche', 'SS:Shadow Striker', 'T:Trequartista', 'AF:Advanced Forward', 'DLF:Deep-Lying Forward', 'CF:Complete Forward', 'TF:Target Forward', 'PF:Pressing Forward', 'P:Poacher', 'F9:False Nine'],
];
const names = Object.fromEntries(groups.flatMap(([group, ...roles]) => roles.map(entry => {
  const [code, name] = entry.split(':');
  return [code, { name, group }];
})));
const aliases = { G: 'gk', L: 'lib', A: 'anchor', RGA: 'reg', VOL: 'sv', WT: 'wtf', EG: 'eng' };
const duties = { De: 'defend', Su: 'support', At: 'attack', St: 'stopper', Co: 'cover' };
const sources = [
  { id: 'matrix', title: 'Squad Analyzer FM2024: Important_attributes_per_role', url: 'https://docs.google.com/spreadsheets/d/1cq4W3ippnF-5XQUIlONsd4yGip8IvGrUICYmWempTe0/edit#gid=1821538342', accessed: '2026-09-05' },
  { id: 'manual', title: 'Sports Interactive FM24 manual: Roles and Duties', url: 'https://community.sports-interactive.com/sigames-manual/football-manager-2024/tactics-r4960/' },
  { id: 'model', title: 'Community analyzer documentation (2/1/0 weights)', url: 'https://github.com/ami-167/Squad_analyzer_FM_2024/blob/8f10a4b658ab0ebdc863cdaf58fd5296b1cd0ce3/README%20v1.0.md' },
];
const roles = rows.map(row => {
  const [sourceRole, tiers] = row.split('|');
  const [code, dutyCode] = sourceRole.split(' - ');
  assert.equal(tiers.length, keys.length, sourceRole);
  assert.match(tiers, /^[gbn]+$/);
  assert.ok(names[code] && duties[dutyCode], sourceRole);
  const role = aliases[code] ?? code.toLowerCase();
  const keyAttributes = keys.filter((_, i) => tiers[i] === 'g');
  assert.ok(keyAttributes.length, sourceRole);
  return { id: `${role}-${duties[dutyCode]}`, role, ...names[code], duty: duties[dutyCode], keyAttributes, preferableAttributes: keys.filter((_, i) => tiers[i] === 'b'), source: 'matrix', sourceRole };
});
assert.equal(roles.length, 85);
assert.equal(new Set(roles.map(r => r.id)).size, 85);
assert.equal(new Set(roles.map(r => r.role)).size, 45);
const catalog = { version: 'fm24-roles-1', modelVersion: 'key2-preferable1-v1', gameVersion: 'FM24', keyWeight: 2, preferableWeight: 1, scale: 100, sourceMatrixSha256: createHash('sha256').update(rows.join('\n')).digest('hex'), sources, roles };
const titleCase = text => text[0].toUpperCase() + text.slice(1);
let doc = `# FM24 role ratings\n\n45 roles, 85 fixed role-and-duty profiles. Catalog version: ${catalog.version}; model: ${catalog.modelVersion}.\n\n## Research and interpretation\n\n`;
doc += sources.map(s => `- [${s.title}](${s.url})${s.accessed ? ` (read ${s.accessed})` : ''}`).join('\n');
doc += '\n\nThe community matrix explicitly records green (key), blue (preferable), and unhighlighted attributes. These are community-transcribed FM24 highlights, not an official machine-readable dataset. The FM24 manual confirms that roles and duties require different attributes. The archived matrix is in `research/fm24-role-attributes.txt`; column names map to the existing SaveLens attribute catalog. Runtime use is entirely offline.\n\nThe fixed 2:1 weights are the SaveLens model, also used by the community analyzer; no official numeric weights were verified. This measures attribute fit, not match-performance prediction or in-game coach stars. It does not use CA/PA, hidden attributes, feet, or position familiarity. A higher score in a simpler role does not guarantee better match results than a lower score in a demanding role.\n\nFM24-specific coverage includes Inverted Full-Back (Defend) and Libero (Defend/Support). Automatic duties switch among concrete Defend/Support/Attack duties with mentality, so have no separate profile. Shared roles are not duplicated by side or position.\n\nOther candidate datasets were excluded: CulturedLeftFoot/FM24Players now contains FM26 possession-phase roles; mickyyy68/fm24-scout adds custom physical-attribute weights; ElectroHugin/FM-Player-Analyzer has incomplete coverage and includes Handling in a Wide Centre-Back profile.\n\n## Calculation\n\n`score = 5 × (2 × sum(key) + sum(preferable)) / (2 × count(key) + count(preferable))`\n\nUse displayed 1–20 attributes and retain precision until display (one decimal). All 1 gives 5/100, all 15 gives 75/100, all 20 gives 100/100. A weighted average of 15.7/20 gives 78.5/100. Missing, nonnumeric, or out-of-range weighted attributes make the entire role rating unavailable; unhighlighted missing attributes have no effect. Position familiarity is displayed separately.\n\n## API\n\n- `GET /api/roles` returns this catalog and model versions.\n- Player details include `roleRatings`: `{roleId, score, missingAttributes}` for all 85 profiles. Missing attributes include invalid values; unavailable scores are `null`.\n- Player search accepts `role=af-attack`, `roleMin=70.5`, and `sort=roleRating`. A selected role adds `roleRating` to each result. Thresholds (finite 0–100) and role sorting require a valid role. Null scores sort last in either direction. Scores are filtered and sorted before pagination, with CA descending and ID ascending as tie-breakers.\n- To display multiple columns, pass `roles=af-attack,ap-support,tf-support`. Each result includes `roleScores`, a map from requested role IDs to scores or `null`. All 85 profiles may be requested together; duplicate IDs are deduplicated and unknown IDs are rejected. Extra display scores are calculated only for the returned page.\n- `sort=role:tf-support` sorts the entire matching set by that role independently of the `role`/`roleMin` filter. Null scores remain last, with the same stable tie-breakers. Display columns never add implicit position or rating filters.\n- Ratings are derived from existing snapshots; no reimport or schema migration is needed.\n\n## All role profiles\n';
for (const [group] of groups) {
  doc += `\n### ${group}\n\n| Role and duty | Key attributes (×2) | Preferable attributes (×1) |\n|---|---|---|\n`;
  for (const role of roles.filter(r => r.group === group)) doc += `| ${role.name} (${titleCase(role.duty)}) | ${role.keyAttributes.map(k => labels[k]).join(', ')} | ${role.preferableAttributes.map(k => labels[k]).join(', ')} |\n`;
}
doc += '\n## Updating\n\nEdit the archived factual matrix only after checking its source; update the catalog/model version when definitions/weights change. Run `node scripts/role-catalog.mjs` to regenerate the bundled catalog and this document; `node scripts/role-catalog.mjs --check` detects drift without writing.\n';
for (const [path, value] of [['native/roles.json', JSON.stringify(catalog, null, 2) + '\n'], ['docs/ROLE_RATINGS.md', doc]]) {
  if (process.argv.includes('--check')) assert.equal(read(path), value, `${path} is out of date`);
  else writeFileSync(new URL(path, root), value);
}
console.log('Verified 45 roles and 85 role-and-duty profiles.');
