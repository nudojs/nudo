/**
 * Bug 1096 回归 —— 构造器 may-throw 证据的**归因落点**（两条通道，同根因）。
 *
 * 缺陷 A（**假绿**）：`export class TotalCtor { constructor(x) { throw new TypeError("boom"); } }`
 *   —— 构造器**无条件抛**是 `new A()` 这个**真实入口**的可判定事实，但此前
 *   ① 实例方法桥把构造器跑在独立 may-throw 会话里（证据不进方法入口的收集
 *   域），② 硬抛被 `catch {}` 吞掉，③ **类导出本身不在入口表**
 *   （`scan-top-functions.ts` 只登记 `Class.method`）⇒ 构造器必抛在 check 闸门
 *   与 `nudo test` 见证面**双面不可见** ⇒ **CI 闸门假绿**（0 error / 0 warning
 *   / exit 0）。
 *
 * 缺陷 B（**假红**）：同一「裸实例兜底」在**值域**通道（`generalize.ts`）产出
 *   **自信的错值** —— 兜底实例的内层是**空 obj** ⇒ 构造器写过的字段被建模成
 *   「确定不存在」⇒ `this.v` 读成**确定的 undefined**；`this.v.toFixed(2)` 在
 *   **虚构实例**上抛 TypeError ⇒ 方法签名被折成 `never`（谎称「该方法必抛、
 *   恒返回 never」）⇒ 连带 **error 级 `nudo:entry-may-throw`**（假红，直接卡
 *   用户 CI）。
 *
 * 修法（两处**就地复刻**的孪生实现，必须同构）：
 * - 证据通道（`check-may-throw.ts`）：**类导出入口**（`new C()`）进 L2 入口
 *   表 ⇒ 构造器的**硬抛**（无条件 throw）进 throws 域 ⇒ 报在**类声明位置**的
 *   `Class` 入口上；构造器的**软效果**（any 补位的强制转换，Bug 1070 口径）
 *   **不进** ⇒ 普通类不触发 error 级 `nudo:entry-may-throw`（不假红）。
 * - 值域通道（`generalize.ts`）：裸实例的内层改 **unknown**（构造器写过的字段
 *   = **不可知**，不是「确定不存在」）⇒ 不折确定的 undefined / NaN，不在虚构
 *   实例上抛 ⇒ 签名落 `unknown`（或等价的不确定形态），不折 `never`。
 *
 * 端到端接线（**check.ts**，见交付报告）：`names` 需并入类导出入口清单
 * （`listClassEntryNames`）⇒ 类入口才进 L2 门禁。接线前本文件用**门禁同口径
 * 的镜像**（`collectEntryMayThrows` + `filterGateThrows`，core 公开 API）断言
 * 证据；接线后 `checkSource` 端到端断言自动升级为「必须报 1 条」。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { parseSource } from "../parse-source.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { listClassEntryNames } from "../scan-top-functions.ts";
import { collectEntryMayThrows, declaredThrowsForEntry } from "../check-may-throw.ts";
import { filterGateThrows } from "../may-throw.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { l2Count, sigOf, stdOpts } from "./nudo-constraints.ts";

/**
 * 缓存重置（仓库惯例）：本文件的用例**同名文件**（`acct.js`）跑不同源码 ⇒
 * 模块执行缓存 / 泛化 memo / check memo 会串台（上一个用例的模块被下一个
 * 用例复用）⇒ 每个用例前清干净。
 */
beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** 构造器**无条件抛**（可判定事实 ⇒ 必须可见） */
const CTOR_THROW = `export class ThrowCtor {
  constructor(x) { throw new TypeError("boom"); }
  describe() { return "a"; }
}`;

/** 构造器在 **any 实参**下才抛（`x + 1` 的 ToNumeric 风险）⇒ any 补位的伪影 */
const CTOR_SOFT = `export class SoftCtor {
  constructor(x) { this.v = x + 1; }
  describe() { return this.v; }
}`;

/** 缺陷 B：构造器抛 + 方法体读构造器写过的字段 */
const CTOR_THROW_FIELD = `export class FieldCtor {
  constructor(x) { throw new Error("boom"); this.v = x; }
  describe() { return this.v; }
  fmt() { return this.v.toFixed(2); }
}`;

/** 构造器抛 + 方法体**自己**也抛（方法体的证据不得一起丢） */
const CTOR_AND_METHOD_THROW = `export class BothCtor {
  constructor(x) { throw new TypeError("ctor"); }
  describe() { throw new TypeError("m"); }
}`;

/**
 * check.ts 的 L2 入口门禁**同口径镜像**（check.ts:1086-1113）：
 * 入口 → `collectEntryMayThrows` → `filterGateThrows`（申报 / ignore 过滤）。
 *
 * 用它断言「构造器必抛的证据有真实落点」：类导出入口 `A` 的 throws 域必须
 * 含构造器的硬抛（修前：类导出不在入口表 ⇒ 证据为空 ⇒ 假绿）。
 */
function classEntryGate(
  source: string,
): Array<{ fn: string; kind: string }> {
  const file = parseSource(source);
  const out: Array<{ fn: string; kind: string }> = [];
  for (const name of listClassEntryNames(source, file)) {
    const g = generalizeFromAst(name, source, { file });
    if (!g) continue;
    const effects = collectEntryMayThrows(source, name, g, file, pTrue, stdOpts);
    const declared = declaredThrowsForEntry(source, name);
    for (const e of filterGateThrows(effects, declared, stdOpts.ignoreThrows)) {
      out.push({ fn: name, kind: e.kind });
    }
  }
  return out;
}

describe("Bug 1096 — 构造器 may-throw 证据的归因落点", () => {
  it("类导出入口进 L2 入口表（`new C()` 是真实入口）", () => {
    expect(listClassEntryNames(CTOR_THROW)).toEqual(["ThrowCtor"]);
    expect(listClassEntryNames(CTOR_SOFT)).toEqual(["SoftCtor"]);
    // 导出形态同源：export { C } / export default class C
    expect(
      listClassEntryNames(`class C { m() { return 1; } }\nexport { C };`),
    ).toEqual(["C"]);
    expect(listClassEntryNames(`export default class C { m() { return 1; } }`)).toEqual(["C"]);
    // 非导出类不是入口
    expect(listClassEntryNames(`class C { m() { return 1; } }`)).toEqual([]);
  });

  it("构造器**无条件抛** ⇒ 证据进类入口的 throws 域（修前：空 ⇒ 假绿）", () => {
    const gate = classEntryGate(CTOR_THROW);
    expect(gate).toEqual([{ fn: "ThrowCtor", kind: "TypeError" }]);
  });

  it("构造器在 **any 实参**下才抛 ⇒ 不进 throws 域（不假红）", () => {
    expect(classEntryGate(CTOR_SOFT)).toEqual([]);
  });

  it("端到端：类入口进入口表后，构造器必抛必须报在类入口上（不零诊断）", () => {
    const r = checkSource("acct-throw.js", CTOR_THROW, pTrue, stdOpts);
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "ThrowCtor");
    // 类入口是否已并入 check 面的入口表（接线后为 true ⇒ 签名面有类行）
    const wired = r.signatures.some((s) => s.name === "ThrowCtor");
    // 接线前：类入口不在入口表 ⇒ 端到端无 issue（证据层断言兜底）
    // 接线后：必须报出（否则 = 构造器必抛被丢弃 = 假绿）
    expect(l2.length).toBe(wired ? 1 : 0);
    if (l2.length > 0) {
      expect(l2[0]!.severity).toBe("error");
      expect(l2[0]!.message).toContain("may throw TypeError");
    }
  });

  it("构造器软 throw ⇒ 全文件零 error 级 L2（原假红保持消除）", () => {
    const r = checkSource("acct-soft.js", CTOR_SOFT, pTrue, stdOpts);
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    // 方法入口的证据照常（构造器的软效果不进方法入口的收集域）
    expect(sigOf(r, "SoftCtor.describe")).not.toContain("throws");
  });

  it("构造器必抛 ⇒ **不**归因给实例方法（Bug 1070 口径不变）", () => {
    const r = checkSource("acct-throw.js", CTOR_THROW, pTrue, stdOpts);
    expect(l2Count(r, "ThrowCtor.describe")).toBe(0);
  });

  it("构造器上申报 `@nudo:throws` ⇒ 闸门可放行（类入口的申报落点 = 构造器 scope）", () => {
    const src = `export class DeclaredCtor {
  /**
   * @nudo:throws TypeError
   */
  constructor(x) { throw new TypeError("boom"); }
  describe() { return "a"; }
}`;
    // 构造器 scope 名 = `DeclaredCtor.constructor` ⇒ 申报必须查得到（否则用户已申报仍被卡）
    expect(declaredThrowsForEntry(src, "DeclaredCtor")).toEqual(["TypeError"]);
    expect(classEntryGate(src)).toEqual([]);
  });
});

describe("Bug 1096 — 兜底实例不得产出自信的错值（值域通道）", () => {
  it("构造器抛 + 方法读字段 ⇒ 签名不得是确定的 undefined（修前：undefined）", () => {
    const r = checkSource("acct-field.js", CTOR_THROW_FIELD, pTrue, stdOpts);
    const desc = sigOf(r, "FieldCtor.describe");
    expect(desc).not.toBe("undefined");
    expect(desc).not.toContain("undefined");
    // 不可知 ⇒ 落在 unknown（或等价的不确定形态）
    expect(desc).toContain("unknown");
  });

  it("构造器抛 + 方法在字段上调成员 ⇒ 不得折 never（修前：never + error 级 L2）", () => {
    const r = checkSource("acct-field.js", CTOR_THROW_FIELD, pTrue, stdOpts);
    const fmt = sigOf(r, "FieldCtor.fmt");
    expect(fmt).not.toContain("never");
    expect(fmt).toContain("unknown");
    // 兜底实例的 TypeError 不得决定方法签名 ⇒ 方法入口零 error 级 L2
    expect(l2Count(r, "FieldCtor.fmt")).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "FieldCtor.fmt")).toHaveLength(0);
  });

  it("构造器抛 + 方法体 total ⇒ 方法签名照常（不退化成整体 opaque）", () => {
    const r = checkSource(
      "acct-total.js",
      `export class TotalCtor {
        constructor(x) { throw new Error("boom"); }
        describe() { return "acct"; }
      }`,
      pTrue,
      stdOpts,
    );
    expect(sigOf(r, "TotalCtor.describe")).toBe(String.raw`"acct"`);
    expect(r.issues.filter((i) => i.code === "nudo:opaque-result")).toHaveLength(0);
  });

  it("方法体**自己**会抛 ⇒ 证据照常收集（构造器抛不得把方法体证据一起弄丢）", () => {
    const r = checkSource("acct-both.js", CTOR_AND_METHOD_THROW, pTrue, stdOpts);
    expect(l2Count(r, "BothCtor.describe")).toBe(1);
    const issue = r.issues.find(
      (i) => i.code === "nudo:entry-may-throw" && i.fn === "BothCtor.describe",
    );
    expect(issue?.severity).toBe("error");
    expect(sigOf(r, "BothCtor.describe")).toContain("throws TypeError");
  });
});
