/**
 * BUG-198 —— `nudo:entry-may-throw` 的 `fix:` 行把 `nudo contract --draft` 指为
 * 补救手段，但草稿**只投影参数 / 返回证据**、不含 `throws` 槽 ⇒ 照建议落盘后
 * 诊断原样还在（建议不可执行）；源码里显式 `@nudo:throws` 也在草稿里消失
 * （草稿与源码矛盾）。
 *
 * 判据：草稿带抛错证据 —— 已申报的**原样**带上，未申报的取**门禁同一事实**
 * （`nudo:entry-may-throw` 的错误种类）⇒ `fn(params, returns?, { throws: "…" })`；
 * 把这条 DSL 当侧车就能让入口抛错诊断转绿（对照组）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { checkSource, pTrue } from "@nudojs/core";
import { draftInterface } from "../interface-draft.ts";
import { tmpProject, writeTmpFiles } from "../../__tests__/tmp-project.ts";

const MAY_THROW = `export function add(a, b) {
  return a + b;
}
`;

const DECLARED = `/**
 * @nudo:throws TypeError
 */
export function add(a, b) {
  return a + b;
}
`;

const TOTAL = `export function twice(n) {
  if (typeof n !== "number") return 0;
  return n * 2;
}
`;

/** 把草稿 DSL 当侧车文本跑门禁，返回残留的 entry-may-throw 条数 */
function mayThrowAfterSidecar(file: string, source: string, dsl: string): number {
  const r = checkSource(file, source, pTrue, {
    fromFile: file,
    loadModule: (spec: string) =>
      spec.includes("nudo") ? `export const add = ${dsl};\n` : undefined,
  });
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw").length;
}

describe("BUG-198 —— contract --draft 必须带抛错证据", () => {
  it("未申报但门禁判「可能抛」⇒ 草稿头给出可照抄的 throws 补救（DSL 不擅自加义务）", async () => {
    const dir = tmpProject("nudo-bug-198-");
    writeTmpFiles(dir, { "lib.js": MAY_THROW });
    const res = await draftInterface(join(dir, "lib.js"));
    // DSL 形态不变（不把「可能抛」变成草稿义务）
    expect(res.entries[0]?.dsl).toBe("fn({})");
    // 但草稿头必须写明补救（此前完全没有）
    expect(res.draftSource).toContain('nudo:entry-may-throw add → add { throws: "TypeError" }');
    expect(res.entries[0]?.throws).toEqual({ kinds: ["TypeError"], declared: false });
  });

  it("按提示补 throws 槽后入口抛错诊断真的消失（建议可执行）", async () => {
    const dir = tmpProject("nudo-bug-198-rt-");
    writeTmpFiles(dir, { "lib.js": MAY_THROW });
    const file = join(dir, "lib.js");
    const res = await draftInterface(file);
    const dsl = res.entries[0]!.dsl!;
    const kinds = res.entries[0]!.throws!.kinds;
    const slot = `, any(), { throws: ${kinds.map((k) => `"${k}"`).join(", ")} }`;
    // 提示里给出的就是这条：`fn({} , any(), { throws: "TypeError" })`
    expect(mayThrowAfterSidecar(file, MAY_THROW, `${dsl.slice(0, -1)}${slot})`)).toBe(0);
  });

  it("源码显式 `@nudo:throws` 原样进草稿（不再凭空消失）", async () => {
    const dir = tmpProject("nudo-bug-198-decl-");
    writeTmpFiles(dir, { "lib.js": DECLARED });
    const res = await draftInterface(join(dir, "lib.js"));
    expect(res.entries[0]?.dsl).toContain('{ throws: "TypeError" }');
    expect(res.entries[0]?.throws).toEqual({ kinds: ["TypeError"], declared: true });
  });

  it("多个错误种类 ⇒ `union(lit(…), lit(…))`（throws 槽要求具名错误）", async () => {
    const dir = tmpProject("nudo-bug-198-multi-");
    const src = `/**
 * @nudo:throws TypeError
 * @nudo:throws RangeError
 */
export function f(x) {
  return x;
}
`;
    writeTmpFiles(dir, { "lib.js": src });
    const res = await draftInterface(join(dir, "lib.js"));
    const dsl = res.entries[0]!.dsl!;
    expect(dsl).toContain('union(lit("TypeError"), lit("RangeError"))');
  });

  // ── 负控制：总函数不得凭空长 throws 槽 ─────────────────────────
  it("负控制：不抛错的函数草稿里没有 throws 槽", async () => {
    const dir = tmpProject("nudo-bug-198-total-");
    writeTmpFiles(dir, { "lib.js": TOTAL });
    const res = await draftInterface(join(dir, "lib.js"));
    const dsl = res.entries[0]?.dsl;
    expect(dsl).toBeDefined();
    expect(dsl).not.toContain("throws");
    expect(res.entries[0]?.throws).toBeUndefined();
  });
});
