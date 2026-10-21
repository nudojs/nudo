/**
 * Bug 496：`nudo test --json` 的 `intension.display` 在跨模块调用上退化成
 * `() => unknown`，与同一份 JSON 里的 `result` / `resultAbs` / `intension.abs`
 * 自相矛盾，且与 `nudo check` 的签名相反。
 *
 * 根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面**
 * （generalizeFromAst → formatPoly），`abs` 走**求值面**；跨模块时被调方是
 * import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值
 * 面有确切的 7。`unknown` 在本产品是保留词（= 推断失败）⇒ 两个面相反。
 *
 * 修法：符号面退化成 bare unknown 时**不写** display，改由求值面结果合成
 * （与 abs 同源）——`unknown` 只在真的推断失败时出现。
 *
 * 钉：跨模块 display 与求值面一致；同模块（符号面有效）display 不变；
 * 负控制：真推断失败时 display 仍如实说 unknown。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const LIB = `export function inner() { return 7; }
`;
const USE = `import { inner } from "./lib.js";

export function run() { return inner(); }
`;
const SAME = `function inner2() { return 7; }
export function run2() { return inner2(); }
`;

describe("Bug 496：intension.display 与求值面同源（跨模块不再退化成 unknown）", () => {
  it("跨模块：display 由求值面合成，与 resultAbs / nudo check 签名一致", () =>
    withTmpProject("nudo-b496-", (dir) => {
      writeTmpFile(dir, "lib.js", LIB);
      const use = writeTmpFile(dir, "use.js", USE);

      const result = analyzeFile(use, readFileSync(use, "utf-8"));
      const fn = result.functions.find((f) => f.name === "run");
      expect(fn).toBeDefined();
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry).toBeDefined();
      // 求值面：确切的 7
      expect(entry!.intension?.abs).toContain("7");
      expect(entry!.intension?.absMultiline).toContain("7");
      // 人读摘要：不得宣称推断失败
      expect(entry!.intension?.display).not.toContain("unknown");
      expect(entry!.intension?.display).toContain("7");
      // 与 nudo check 的签名同口径（run() => 7）
      expect(entry!.intension?.display).toBe("run: () => 7");
    }));

  it("负控制：同模块（符号面有效）display 保持符号面形态", () =>
    withTmpProject("nudo-b496b-", (dir) => {
      const same = writeTmpFile(dir, "same.js", SAME);
      const result = analyzeFile(same, readFileSync(same, "utf-8"));
      const fn = result.functions.find((f) => f.name === "inner2");
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry!.intension?.display).toBe("inner2: () => 7");
    }));

  it("负控制：真推断失败时 display 仍如实说 unknown（与 payload 一致）", () =>
    withTmpProject("nudo-b496c-", (dir) => {
      const src = `export function f() { return globalThis.__nudo_missing__.x; }
`;
      const file = writeTmpFile(dir, "fail.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "f");
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry).toBeDefined();
      expect(entry!.intension?.abs).toContain("unknown");
      expect(entry!.intension?.display).toContain("unknown");
    }));

  it("不变量：任何 case 的 display 不得与同一条 payload 的 abs 矛盾", () =>
    withTmpProject("nudo-b496d-", (dir) => {
      writeTmpFile(dir, "lib.js", LIB);
      const use = writeTmpFile(dir, "use.js", USE);
      const result = analyzeFile(use, readFileSync(use, "utf-8"));
      for (const fn of result.functions) {
        for (const c of fn.cases) {
          const abs = c.intension?.abs ?? "";
          const display = c.intension?.display ?? "";
          if (abs.includes("unknown") || abs === "") continue;
          expect(display, `${fn.name}/${c.name}`).not.toContain("unknown");
        }
      }
    }));
});
