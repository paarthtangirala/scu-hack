import { describe, expect, it } from "vitest";

import {
  buildLiveDetectionSignature,
  normalizeLiveRows,
  parseLiveModelText,
} from "./liveVisionParser";

describe("liveVisionParser", () => {
  it("parses fenced JSON model output", () => {
    const parsed = parseLiveModelText(`
      some preface
      \`\`\`json
      {"materials":[{"type":"cardboard","lbs":3.4,"count":2,"confidence":0.91}],"notes":"box pile"}
      \`\`\`
    `);

    expect(parsed).not.toBeNull();
    expect(parsed.materials).toHaveLength(1);
    expect(parsed.materials[0].type).toBe("cardboard");
    expect(parsed.materials[0].lbs).toBe(3.4);
    expect(parsed.notes).toBe("box pile");
  });

  it("normalizes aliases and merges same-type rows", () => {
    const rows = normalizeLiveRows([
      { type: "aluminum cans", lbs: 0.8, count: 4, confidence: 0.6 },
      { type: "aluminum_cans", lbs: 0.4, count: 2, confidence: 0.8 },
      { type: "glass bottle", lbs: 1.2, count: 1, confidence: 0.7 },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("aluminum_cans");
    expect(rows[0].count).toBe(6);
    expect(rows[0].lbs).toBe(1.2);
    expect(rows[0].confidence).toBe(0.8);
  });

  it("builds a stable detection signature", () => {
    const signature = buildLiveDetectionSignature([
      { type: "cardboard", lbs: 4.1, count: 2 },
      { type: "glass_bottles", lbs: 1.0, count: 1 },
    ]);

    expect(signature).toBe("cardboard:2:4.1|glass_bottles:1:1.0");
  });
});
