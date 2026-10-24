/**
 * Bug 434 —— 形参契约写成 `lit(null)` / `lit(undefined)` ⇒ 引擎把**自己的字面量**
 * 判成违例，诊断文本**自相矛盾**（`actual: null` / `expected: x = null` 却报 ⊭）
 * ⇒ L1 门禁**假红**。
 *
 * 现状：**假阳性** —— 症状已被族 06（Bug 965，commit `e2880fd6`）修掉：
 * `scan/literal-preds.ts` 的 `predEqNullish` / `nullishKindOf` + `scan/literal-shapes.ts`
 * 的 **nullish eq 分支**（排在「确定 undefined」臂**之前**）⇒
 * **唯一允许值放行、其余值判违例**。本钉把这条行为钉死（**不改实现**）。
 *
 * ── 形态分清（本钉只钉「裸字面量形态」）──────────────────────────────
 *
 * | 形态 | 契约长什么样 | 执法通道 | 归属 |
 * |---|---|---|---|
 * | **裸字面量** | 契约**自身**就是 `lit(null)` / `lit(undefined)` | 单条 **eq 原子** | **本钉（434）** |
 * | union / nullable | 契约**含** nullish **成员**（`members[]`） | **or 析取**分支 | **Bug 429**（族 11 · S1 在修） |
 *
 * ⇒ 两条形态走**不同通道**、症状相反（434 假红 vs 429 双向反了）⇒ 本钉
 * **只**断言裸字面量形态的执法结果；union / nullable 形态的执法结果**故意不钉**
 * （在途修复会改它，钉了就是耦合中间形态），只断言两种形态的**契约结构**可分
 * （第二个 describe）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { litC, nullable, number, union } from "@nudojs/core";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { lit } from "@nudojs/core";
export const onlyNull = lit(null);
export const onlyUndef = lit(undefined);
`;

const IMP = `/// @nudo:import { onlyNull, onlyUndef } from "./std434.nudo.js"\n`;

const FILE = "/t/std434.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std434", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated）条数 */
function violated(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: "onlyNull" | "onlyUndef", arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return 1; }
export function use() { return f(${arg}); }`;
}

describe("Bug 434 —— 裸 lit(null) / lit(undefined) 契约：唯一允许值放行、其余值判违例", () => {
  it("lit(null) 契约收到 null ⇒ 放行（零诊断；改前是假红）", () => {
    const r = check(call("onlyNull", "null"));
    expect(violated(r)).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("lit(undefined) 契约收到 undefined ⇒ 放行（零诊断；改前是假红）", () => {
    const r = check(call("onlyUndef", "undefined"));
    expect(violated(r)).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("lit(null) 契约收到 0 ⇒ 判违例，expected 指向 x = null", () => {
    const r = check(call("onlyNull", "0"));
    expect(violated(r)).toBe(1);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x = null");
    expect(issue?.actual).toContain("0");
  });

  it("lit(null) 契约收到 'a' ⇒ 判违例", () => {
    const r = check(call("onlyNull", '"a"'));
    expect(violated(r)).toBe(1);
  });

  it("lit(undefined) 契约收到 0 ⇒ 判违例，expected 指向 x = undefined", () => {
    const r = check(call("onlyUndef", "0"));
    expect(violated(r)).toBe(1);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x = undefined");
  });

  it("null 与 undefined 是**两个域**：lit(null) 契约收到 undefined ⇒ 判违例", () => {
    const r = check(call("onlyNull", "undefined"));
    expect(violated(r)).toBe(1);
  });

  it("null 与 undefined 是**两个域**：lit(undefined) 契约收到 null ⇒ 判违例", () => {
    const r = check(call("onlyUndef", "null"));
    expect(violated(r)).toBe(1);
  });

  it("负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return 1; }
export function use() { return f(0); }`);
    expect(violated(r)).toBe(0);
  });
});

describe("形态分清 —— 裸字面量形态（434）vs union / nullable 形态（429）", () => {
  it("裸 lit(null)：契约**自身**是一条 eq 原子（无成员）", () => {
    const c = litC(null);
    expect(c.members ?? []).toHaveLength(0);
    expect(c.preds).toHaveLength(1);
    expect(c.preds[0]?.op).toBe("eq");
  });

  it("裸 lit(undefined)：契约**自身**是一条 eq 原子（无成员）", () => {
    const c = litC(undefined);
    expect(c.members ?? []).toHaveLength(0);
    expect(c.preds).toHaveLength(1);
    expect(c.preds[0]?.op).toBe("eq");
  });

  it("nullable(number())：nullish 是**成员**（members[]），不是契约自身", () => {
    const c = nullable(number());
    expect(c.preds).toHaveLength(0);
    expect(c.members ?? []).toHaveLength(3);
  });

  it("union(lit(null), number())：nullish 是**成员**（members[]），不是契约自身", () => {
    const c = union(litC(null), number());
    expect(c.preds).toHaveLength(0);
    expect(c.members ?? []).toHaveLength(2);
  });
});
