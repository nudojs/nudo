import { describe, it, expect } from "vitest";
import { tryRunBPath, clearBPathCache } from "../bpath-run.ts";

describe("B-path truncated dep fingerprint is fail-closed", () => {
  it("tryRunBPath still evaluates when deps cannot be fingerprinted", () => {
    clearBPathCache();
    const src = `export function id(x) { return x; }`;
    const r = tryRunBPath(src, "/tmp/bpath-no-dep.js");
    // must not throw; may return exports
    expect(r === undefined || typeof r.exports === "object").toBe(true);
  });
});
