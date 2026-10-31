/**
 * BUG-073：用户代码的宿主原生异常（ReferenceError）被归 `nudo:internal`
 * 「引擎内部缺陷」⇒ 误导排障。修复：`evalFallbackOf` 把非 NudoThrow 的
 * 原生异常归 `module-throw`（程序自身抛），门禁按确定性装载期抛出诊断。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { tryRunTranspiledDetailed } from "../exec/run.ts";

const SRC = `
export function fmt(v) {
  return __nudoMissingNative(v);
}
fmt(1);
`;

describe("BUG-073 native user-code exception is a program throw", () => {
  it("fallback reason is module-throw, not internal", () => {
    const attempt = tryRunTranspiledDetailed(SRC, { mode: "analyze" });
    expect(attempt.run).toBeUndefined();
    expect(attempt.fallback?.reason).toBe("module-throw");
    expect(attempt.fallback?.reason).not.toBe("internal");
  });

  it("check reports nudo:module-throw ReferenceError (no nudo:internal)", () => {
    const r = checkSource("/t/bug-073-r1.js", SRC, pTrue);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("nudo:module-throw");
    expect(codes).not.toContain("nudo:internal");
    const issue = r.issues.find((i) => i.code === "nudo:module-throw")!;
    expect(issue.message).toContain("ReferenceError");
    expect(issue.expected?.length ?? 0).toBeGreaterThan(0);
  });
});
