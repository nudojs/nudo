/**
 * 模块体 strict 前缀（`exec/run.ts`）：原生 **strict mode code** = ESM 面
 * **或** Program 指令序言含 `"use strict"`。CJS 风格脚本首部的指令同样是
 * strict——块级函数声明失去 Annex B 提升，块外引用 ⇒ ReferenceError（原生
 * parity）；无指令的 sloppy 脚本保持 Annex B 提升。ESM 面行为不变。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../exec/run.ts";
import { $call } from "../exec/call.ts";
import type { Abs } from "../abs.ts";
import { litValue } from "@nudojs/core";

/** 块级函数 + 块外引用（sloppy 靠 Annex B；strict ⇒ ReferenceError） */
const EXPORTS_BLOCK_FN = `{ function g() { return 3; } }
module.exports.g = g;`;

const FN_BLOCK_SRC = `function outer() {
  { function g() { return 3; } }
  return g();
}
module.exports = { outer };`;

describe("module body strict prefix (ESM or use strict directive)", () => {
  it("CJS script with directive prologue throws ReferenceError at module eval", () => {
    expect(() => runTranspiled(`"use strict";\n${EXPORTS_BLOCK_FN}`)).toThrow(
      ReferenceError,
    );
  });

  it("same sloppy script (no directive) keeps Annex B hoisting", () => {
    const run = runTranspiled(EXPORTS_BLOCK_FN) as Record<string, unknown>;
    expect(run.g).toBeDefined();
    expect(litValue($call(run.g as Abs, []))).toEqual({ ok: true, value: 3 });
  });

  it("directive script: exported function body is strict (may throw ReferenceError)", () => {
    const run = runTranspiled(`"use strict";\n${FN_BLOCK_SRC}`) as Record<string, unknown>;
    expect(() => (run.outer as () => unknown)()).toThrow(ReferenceError);
    // 同一脚本去掉指令 ⇒ sloppy：Annex B 把 g 提升到函数作用域 ⇒ 返回 3
    const sloppy = runTranspiled(FN_BLOCK_SRC) as Record<string, unknown>;
    expect(litValue((sloppy.outer as () => Abs)())).toEqual({ ok: true, value: 3 });
  });

  it("ESM sources remain strict (no regression)", () => {
    const run = runTranspiled(`export function outer() {
  { function g() { return 3; } }
  return g();
}`) as Record<string, unknown>;
    expect(() => (run.outer as () => unknown)()).toThrow(ReferenceError);
  });
});
