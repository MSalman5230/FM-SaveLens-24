import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSave } from "../server/parser/index.ts";
import { columns, reference } from "./salford-reference.ts";
const file = join(process.env.FMSCOUT_FIXTURE_DIR || "tests/fixtures/private", "Salford - Masood.fm");
const editedFile = join(process.env.FMSCOUT_FIXTURE_DIR || "tests/fixtures/private", "Universal Watcher - Update.fm");
test('Edited databases preserve single names and resolve every detected player block',{skip:!existsSync(editedFile)},()=>{
 const save=parseSave(editedFile);
 for(const name of ['Davinchi','Denner','Belinho','Tiago'])assert.ok(save.players.some(p=>p.name===name),`Missing single-name player ${name}`);
 assert.equal(save.players.find(p=>p.name==='Davinchi')?.fullName,'David Cordón Mancha');
 assert.equal(save.diagnostics.ambiguous,0);assert.equal(save.diagnostics.unbound,0);assert.equal(save.players.length,save.diagnostics.abilityBlocks);
});
test(
  "Salford screenshot: names, ages, clubs, CA/PA, nationalities and 252 reference attribute values",
  { skip: !existsSync(file) },
  () => {
    const save = parseSave(file);
    const failures: string[] = [];
    for (const [name, age, ca, pa, club, nation, others, values] of reference) {
      const p = save.players.find((p) => p.name === name && p.pa === pa);
      if (!p) {
        failures.push(`${name}: not found`);
        continue;
      }
      for (const [key, value] of Object.entries({ age, ca, pa, club, nationId: nation }))
        if (p[key as keyof typeof p] !== value)
          failures.push(`${name} ${key}: ${p[key as keyof typeof p]} != ${value}`);
      for (const n of others)
        if (!p.otherNationIds.includes(n)) failures.push(`${name}: missing nationality ${n}`);
      columns.forEach((key, i) => {
        if (p.attributes[key] !== values[i])
          failures.push(`${name} ${key}: ${p.attributes[key]} != ${values[i]}`);
      });
    }
    assert.deepEqual(failures, []);
    assert.equal(new Set(save.players.map((p) => p.id)).size, save.players.length);
    assert.equal(save.diagnostics.ambiguous, 0);
    assert.equal(save.diagnostics.unbound, 0);
    assert.ok(save.players.length > 60000);
    assert.ok(
      save.players.some((p) => p.uid >= 2000000000),
      "Generated players are present",
    );
    const byName = new Map<string, number[]>();
    for (const p of save.players) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);
    assert.ok(
      [...byName.values()].some((ids) => ids.length > 1),
      "Duplicate names remain distinct entities",
    );
    assert.ok(
      save.players.some((p) => /[^\x00-\x7f]/.test(p.name)),
      "Accented names are preserved",
    );
    const aliases: Record<string, string> = {
      AerialAbility: "aerialReach",
      TendencyToPunch: "punching",
      Workrate: "workRate",
      Jumping: "jumpingReach",
      InjuryProness: "injuryProneness",
      Freekicks: "freeKickTaking",
      Longthrows: "longThrows",
      Professional: "professionalism",
    };
    const positions: Record<string, number> = {
      Goalkeeper: 0,
      Striker: 12,
      AttackingMidCentral: 10,
      AttackingMidLeft: 9,
      AttackingMidRight: 11,
      DefenderCentral: 3,
      DefenderLeft: 2,
      DefenderRight: 4,
      DefensiveMidfielder: 5,
      MidfielderCentral: 7,
      MidfielderLeft: 6,
      MidfielderRight: 8,
      WingBackLeft: 13,
      WingBackRight: 14,
    };
    for (const file of readdirSync("players-crosscheck").filter((f) => f.endsWith(".json"))) {
      const ref = JSON.parse(readFileSync("players-crosscheck/" + file, "utf8"));
      const player = save.players.find((p) => p.uid === ref.Id);
      assert.ok(player, `${file}: public ID exists`);
      assert.equal(player.ca, ref.CA);
      assert.equal(player.pa, ref.PA);
      assert.equal(player.birthDate, ref.Born.slice(0, 10));
      let count = 0;
      for (const group of [
        "GoalKeeperAttributes",
        "MentalAttributes",
        "PhysicalAttributes",
        "HiddenAttributes",
        "TechnicalAttributes",
        "PersonalityAttributes",
      ])
        for (const [name, value] of Object.entries(ref[group])) {
          if (name === "Id") continue;
          const key = aliases[name] ?? name[0].toLowerCase() + name.slice(1);
          count++;
          assert.equal(player.attributes[key], value, `${file}: ${group}.${name}`);
        }
      assert.equal(count, 62);
      for (const [key, index] of Object.entries(positions))
        assert.equal(player.positionRatings[index], ref.Positions[key], `${file}: ${key}`);
    }
  },
);
