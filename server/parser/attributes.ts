export type Attribute = {
  key: string;
  label: string;
  group: string;
  index: number;
  scale: number;
  inverted?: boolean;
};
const layout: [string, string, string][] = [
  ["crossing", "Crossing", "Technical"],
  ["dribbling", "Dribbling", "Technical"],
  ["finishing", "Finishing", "Technical"],
  ["heading", "Heading", "Technical"],
  ["longShots", "Long shots", "Technical"],
  ["marking", "Marking", "Technical"],
  ["offTheBall", "Off the ball", "Mental"],
  ["passing", "Passing", "Technical"],
  ["penaltyTaking", "Penalty taking", "Technical"],
  ["tackling", "Tackling", "Technical"],
  ["vision", "Vision", "Mental"],
  ["handling", "Handling", "Goalkeeping"],
  ["aerialReach", "Aerial reach", "Goalkeeping"],
  ["commandOfArea", "Command of area", "Goalkeeping"],
  ["communication", "Communication", "Goalkeeping"],
  ["kicking", "Kicking", "Goalkeeping"],
  ["throwing", "Throwing", "Goalkeeping"],
  ["anticipation", "Anticipation", "Mental"],
  ["decisions", "Decisions", "Mental"],
  ["oneOnOnes", "One on ones", "Goalkeeping"],
  ["positioning", "Positioning", "Mental"],
  ["reflexes", "Reflexes", "Goalkeeping"],
  ["firstTouch", "First touch", "Technical"],
  ["technique", "Technique", "Technical"],
  ["leftFoot", "Left foot", "Feet"],
  ["rightFoot", "Right foot", "Feet"],
  ["flair", "Flair", "Mental"],
  ["corners", "Corners", "Technical"],
  ["teamwork", "Teamwork", "Mental"],
  ["workRate", "Work rate", "Mental"],
  ["longThrows", "Long throws", "Technical"],
  ["eccentricity", "Eccentricity", "Goalkeeping"],
  ["rushingOut", "Rushing out tendency", "Goalkeeping"],
  ["punching", "Punching tendency", "Goalkeeping"],
  ["acceleration", "Acceleration", "Physical"],
  ["freeKickTaking", "Free kick taking", "Technical"],
  ["strength", "Strength", "Physical"],
  ["stamina", "Stamina", "Physical"],
  ["pace", "Pace", "Physical"],
  ["jumpingReach", "Jumping reach", "Physical"],
  ["leadership", "Leadership", "Mental"],
  ["dirtiness", "Dirtiness", "Hidden"],
  ["balance", "Balance", "Physical"],
  ["bravery", "Bravery", "Mental"],
  ["consistency", "Consistency", "Hidden"],
  ["aggression", "Aggression", "Mental"],
  ["agility", "Agility", "Physical"],
  ["importantMatches", "Important matches", "Hidden"],
  ["injuryProneness", "Injury proneness", "Hidden"],
  ["versatility", "Versatility", "Hidden"],
  ["naturalFitness", "Natural fitness", "Physical"],
  ["determination", "Determination", "Mental"],
  ["composure", "Composure", "Mental"],
  ["concentration", "Concentration", "Mental"],
];
const personality = [
  ["adaptability", "Adaptability"],
  ["ambition", "Ambition"],
  ["loyalty", "Loyalty"],
  ["pressure", "Pressure"],
  ["professionalism", "Professionalism"],
  ["sportsmanship", "Sportsmanship"],
  ["temperament", "Temperament"],
  ["controversy", "Controversy"],
];
export const ATTRIBUTES: Attribute[] = [
  ...layout.map(([key, label, group], index) => ({ key, label, group, index, scale: 5 })),
  ...personality.map(([key, label], index) => ({
    key,
    label,
    group: "Hidden",
    index: index + 54,
    scale: 1,
  })),
].map((a) => ({ ...a, inverted: ["dirtiness", "injuryProneness", "controversy"].includes(a.key) }));
export const POSITIONS = [
  "GK",
  "SW",
  "DL",
  "DC",
  "DR",
  "DM",
  "ML",
  "MC",
  "MR",
  "AML",
  "AMC",
  "AMR",
  "ST",
  "WBL",
  "WBR",
];
export function displayAttribute(raw: number) {
  return Math.max(1, Math.min(20, Math.round(raw / 5)));
}
