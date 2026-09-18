import { describe, it, expect } from "vitest";
import { getAnalysisSession, setAnalysisSession } from "../analysis-session.ts";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("B5 AnalysisSession", () => {
  it("default session shares analyze memo and supports clear/evict", () => {
    const session = getAnalysisSession();
    const dir = mkdtempSync(join(tmpdir(), "nudo-sess-"));
    const file = join(dir, "id.js");
    const src = `export function id(x) { return x; }\n`;
    writeFileSync(file, src);
    const a = session.analyze(file, src);
    const b = session.analyze(file, src);
    expect(b.functions.map((f) => f.name)).toEqual(a.functions.map((f) => f.name));
    session.evictForDependents([file]);
    const c = session.analyze(file, src);
    expect(c.functions.length).toBeGreaterThan(0);
    session.clear();
  });

  it("setAnalysisSession restores previous", () => {
    const prev = getAnalysisSession();
    const custom = {
      evictForDependents: () => {},
      clear: () => {},
      reset: () => {},
      analyze: () => ({ functions: [], diagnostics: [] } as never),
    };
    const old = setAnalysisSession(custom);
    expect(old).toBe(prev);
    expect(getAnalysisSession()).toBe(custom);
    setAnalysisSession(prev);
  });
});
