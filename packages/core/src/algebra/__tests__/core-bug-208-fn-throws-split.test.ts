/**
 * Bug 208 —— 侧车 `fn()` 的 `throws` 槽**不按分隔符拆分**字符串字面量。
 *
 * `fn(..., { throws: "TypeError, RangeError" })` 把整串当成**一个** kind 名
 * （`throwConstraintToKinds` 的 `walk` 直接 `note(side.value)`）⇒ 申报集合里
 * 没有 `TypeError` ⇒ **声明静默失效零诊断** ⇒ L2 门禁把「已申报」的代码判成
 * 「未申报」⇒ `nudo:entry-may-throw` **假红**。
 *
 * 而**完全等价**的 `@nudo:throws TypeError, RangeError`（指令面按
 * `/[,\s|]+/` 切分）与 `fn(..., { throws: union("TypeError","RangeError") })`
 * 都是绿的 ⇒ 同一语义两种写法结论不同。
 *
 * 修法：`throwConstraintToKinds` 对字符串字面量 kind 名按**同一分隔符集**
 * 拆分（与 `scanThrowsDecl` 同口径）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource, fn, number, pTrue, throwConstraintToKinds, union } from "../index.ts";
import { scanThrowsDecl } from "../directive-scan.ts";

/** 侧车 fn() 的 throws 槽 → 申报的 kind 名 */
const kindsOf = (throws: string | ReturnType<typeof union>) =>
  throwConstraintToKinds(fn({ x: number() }, number(), { throws }).fn!.throws);

describe("Bug 208 · 侧车 fn() 的 throws 槽必须按分隔符拆分", () => {
  it("逗号串 ⇒ 两个 kind 名（改前整串当**一个**名）", () => {
    expect(kindsOf("TypeError, RangeError")).toEqual(["TypeError", "RangeError"]);
  });

  it("竖线 / 空白分隔同样拆分（与指令面同口径）", () => {
    expect(kindsOf("TypeError | RangeError")).toEqual(["TypeError", "RangeError"]);
    expect(kindsOf("TypeError RangeError")).toEqual(["TypeError", "RangeError"]);
  });

  it("单个 kind / `*` / union 形态不受影响", () => {
    expect(kindsOf("TypeError")).toEqual(["TypeError"]);
    expect(kindsOf("*")).toBe("*");
    expect(kindsOf(union("TypeError", "RangeError"))).toEqual([
      "TypeError",
      "RangeError",
    ]);
  });

  it("与指令面 `@nudo:throws` 的切分口径一致（同一 spec 同一 kind 集）", () => {
    const spec = "TypeError, RangeError";
    const fromDirective = scanThrowsDecl([`@nudo:throws ${spec}`]);
    expect(fromDirective).toBe("TypeError,RangeError");
    expect(kindsOf(spec)).toEqual(fromDirective!.split(","));
  });

  it("端到端：侧车 `throws: \"TypeError, RangeError\"` 放行已申报的 TypeError（改前 L2 假红）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug208-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "bug208", version: "1.0.0", nudo: {} }),
      );
      const srcPath = join(dir, "use.js");
      const src = `export function use(x) {
  if (x < 0) throw new TypeError("bad");
  return x;
}
`;
      writeFileSync(srcPath, src);
      const side = `import { fn, number } from "@nudojs/core";
export const use = fn({ x: number() }, number(), { throws: "TypeError, RangeError" });
`;
      writeFileSync(join(dir, "use.nudo.js"), side);
      const r = checkSource(srcPath, src, pTrue, {
        fromFile: srcPath,
        loadModule: (spec) => (spec.endsWith("use.nudo.js") ? side : undefined),
        autoBind: true,
        projectDir: dir,
      });
      // 改前：`may throw TypeError`（nudo:entry-may-throw，error）
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(mayThrow.map((i) => i.message)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
