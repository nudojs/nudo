import { describe, it, expect } from "vitest";
import { isNudoTargetPath } from "../target-path.ts";

describe("isNudoTargetPath", () => {
  it("accepts inference source extensions", () => {
    expect(isNudoTargetPath("/a/b.js")).toBe(true);
    expect(isNudoTargetPath("/a/b.mjs")).toBe(true);
    expect(isNudoTargetPath("/a/b.ts")).toBe(true);
    expect(isNudoTargetPath("/a/b.JS")).toBe(true);
  });

  it("rejects declaration / JSX and sidecar contract modules", () => {
    expect(isNudoTargetPath("/a/b.d.ts")).toBe(false);
    expect(isNudoTargetPath("/a/b.tsx")).toBe(false);
    expect(isNudoTargetPath("/a/b.jsx")).toBe(false);
    expect(isNudoTargetPath("/a/b.cjs")).toBe(false);
    // 侧车契约模块不是源码推断目标（目录级 check/infer/doctor 不得收进）
    expect(isNudoTargetPath("/a/b.nudo.js")).toBe(false);
    expect(isNudoTargetPath("/a/b.nudo.ts")).toBe(false);
  });
});
