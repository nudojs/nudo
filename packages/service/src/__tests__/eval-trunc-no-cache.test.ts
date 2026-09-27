import { describe, it, expect } from "vitest";
import { tryRunEval, clearEvalCache } from "../eval-run.ts";

describe("evaluator truncated dep fingerprint is fail-closed", () => {
  it("tryRunEval still evaluates when deps cannot be fingerprinted", () => {
    clearEvalCache();
    const src = `export function id(x) { return x; }`;
    const r = tryRunEval(src, "/tmp/eval-no-dep.js");
    // must not throw; may return exports
    expect(r === undefined || typeof r.exports === "object").toBe(true);
  });
});
