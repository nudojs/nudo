/**
 * A1 步骤 3 前置 ·「静态 yield 域推断通道」可行性 PoC（2026-11-06）。
 *
 * **本文件不接生产、不改任何既有断言**，只把「用无约束入口做符号求值能否
 * 替代构造期 eager 收集」钉成可复核实证。结论见
 * `docs/design/generator-laziness.md`「2026-11-06 符号 yield 域 PoC 轮」。
 *
 * 三个决定性发现：
 * ① **引擎本来就在做符号求值**：`nudo export` 的入口形参是 `any`，
 *    `genElements` 已经是「无约束入口跑体」的结果 ⇒ 通道不是新机制，
 *    只是要在「体延后」时把它从构造期解绑。
 * ② **独立编译实例天然隔离副作用**：同一 `runTranspiled` 实例内重跑体会
 *    串台（实验 E 的重复副作用），但每次重新编译各自有全新环境 ⇒ 3 次
 *    结果逐字相同。这规避了「消费点重跑」被否决的根因。
 * ③ **真·体延后 → `Generator<unknown>` → 独立符号求值回填 → 精度完全恢复**。
 *
 * 归一已于 2026-11-06 落地：nudo any ≈ TS unknown ⇒ 退化档投影为
 * `Generator<unknown>`（TS 投影面），接产前置关闭。
 */
import { describe, it, expect } from "vitest";
import { abs, anyAbs, type Abs } from "../../abs.ts";
import { formatAbs } from "../../format/format.ts";
import { leqAbs } from "../../leq.ts";
import { joinAbs } from "../../objects.ts";
import { snapshotAbs } from "../../hof.ts";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { $lit } from "../runtime/state.ts";
import { absToTSType } from "../../../../../service/src/emit/dts-generator.ts";

/** 无约束入口跑导出生成器，取随值携带的完整 yield 序列。 */
function symbolicYields(src: string, arity: number): Abs {
  const ex = runTranspiled(src, { mode: "analyze" });
  const args = Array.from({ length: arity }, () => anyAbs);
  return callTranspiledExportFull(ex, "g", args).result as Abs;
}

function concreteYields(ex: ReturnType<typeof runTranspiled>, args: Abs[]): Abs {
  return callTranspiledExportFull(ex, "g", args).result as Abs;
}

function elems(g: Abs): Abs[] {
  return g.facets?.genElements ?? [];
}

function joined(xs: Abs[]): Abs | undefined {
  return xs.length > 0 ? xs.reduce((a, b) => joinAbs(a, b)) : undefined;
}

const L = (v: unknown): Abs => $lit(v as never);

/** 覆盖矩阵：形态 / 源码 / 多个具体入口见证（symbolic 必须覆盖全部）。 */
const ROWS: Array<{ name: string; src: string; witnesses: Abs[][] }> = [
  { name: "常量序列", src: `export function* g() { yield 1; yield 2; }`, witnesses: [[]] },
  { name: "字面量混合", src: `export function* g() { yield 1; yield "s"; }`, witnesses: [[]] },
  { name: "参数直接 yield", src: `export function* g(x) { yield x; }`, witnesses: [[L(1)], [L("s")], [L(true)]] },
  { name: "参数运算", src: `export function* g(x) { yield x + 1; }`, witnesses: [[L(1)], [L(2)]] },
  { name: "条件分支", src: `export function* g(f) { if (f) yield 1; else yield "s"; }`, witnesses: [[L(true)], [L(false)]] },
  { name: "循环", src: `export function* g(n) { for (let i = 0; i < n; i++) yield i; }`, witnesses: [[L(2)], [L(3)]] },
  { name: "宿主调用", src: `export function* g(xs) { yield xs.length; }`, witnesses: [[L([1, 2])], [L([])]] },
  { name: "yield* 委托", src: `export function* g(xs) { yield* xs; }`, witnesses: [[L([1, 2])], [L([])]] },
  { name: "try/finally", src: `export function* g() { try { yield 1; } finally { yield 2; } }`, witnesses: [[]] },
  { name: "对象构造", src: `export function* g(x) { yield { v: x }; }`, witnesses: [[L(1)], [L("s")]] },
  { name: "模板字符串", src: "export function* g(x) { yield `v${x}`; }", witnesses: [[L(1)]] },
  { name: "闭包活绑定", src: `export function* g() { let n = 0; yield n; n++; yield n; }`, witnesses: [[]] },
  { name: "嵌套生成器", src: `export function* g() { function* h() { yield 1; } yield* h(); }`, witnesses: [[]] },
  { name: "return 终值", src: `export function* g() { yield 1; return 9; }`, witnesses: [[]] },
];

function classify(row: (typeof ROWS)[number]): "exact" | "over" | "degraded" | "unsound" {
  const ex = runTranspiled(row.src, { mode: "analyze" });
  const arity = row.witnesses[0]!.length;
  const sym = joined(elems(concreteYields(ex, Array.from({ length: arity }, () => anyAbs))));
  const cons = row.witnesses.map((w) => joined(elems(concreteYields(ex, w))));
  const k = sym?.shape.k;
  const degraded = !sym || k === "any" || k === "unknown";
  const sound = cons.every((c) => !c || (sym !== undefined && leqAbs(c, sym).ok));
  if (!sound) return "unsound";
  if (degraded) return "degraded";
  const exact = cons.every((c) => c && sym && leqAbs(sym, c).ok);
  return exact ? "exact" : "over";
}

describe("符号 yield 域 PoC — 无约束入口是 sound 上界", () => {
  for (const row of ROWS) {
    it(`${row.name}：symbolic 覆盖所有 concrete 见证`, () => {
      const ex = runTranspiled(row.src, { mode: "analyze" });
      const arity = row.witnesses[0]!.length;
      const sym = joined(elems(concreteYields(ex, Array.from({ length: arity }, () => anyAbs))));
      expect(sym, "无约束入口必须产出一个元素域").toBeDefined();
      for (const w of row.witnesses) {
        const con = joined(elems(concreteYields(ex, w)));
        if (!con) continue;
        expect(leqAbs(con, sym!).ok, `${formatAbs(con)} 必须 ≤ ${formatAbs(sym!)}`).toBe(true);
      }
    });
  }

  it("覆盖矩阵：14 形态 0 unsound，精确 ≥7、退化 ≤3", () => {
    const tiers = ROWS.map(classify);
    expect(tiers.filter((t) => t === "unsound")).toHaveLength(0);
    expect(tiers.filter((t) => t === "exact").length).toBeGreaterThanOrEqual(7);
    expect(tiers.filter((t) => t === "degraded").length).toBeLessThanOrEqual(3);
  });
});

describe("符号 yield 域 PoC — 独立编译实例隔离副作用", () => {
  const src = `export let n = 0; export function* g() { n++; yield n; }`;

  it("重新编译 3 次 ⇒ 每次都是全新的环境（结果逐字相同）", () => {
    const got = Array.from({ length: 3 }, () => {
      const ex = runTranspiled(src, { mode: "analyze" });
      return elems(concreteYields(ex, [])).map((a) => formatAbs(a)).join("|");
    });
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe("1  #exact");
  });

  it("负控：同一实例内重跑体仍会串台（坐实实验 E，故必须独立编译）", () => {
    const ex = runTranspiled(src, { mode: "analyze" });
    const first = elems(concreteYields(ex, [])).map((a) => formatAbs(a)).join("|");
    const second = elems(concreteYields(ex, [])).map((a) => formatAbs(a)).join("|");
    expect(first).toBe("1  #exact");
    expect(second).not.toBe(first);
  });
});

describe("符号 yield 域 PoC — 体延后后的回填闭环", () => {
  const src = `export function* g(x) { yield x + 1; yield 7; }`;

  it("真·体延后（无数字槽 + 承载位空）退化；独立符号求值回填后完全恢复", () => {
    const live = symbolicYields(src, 1);
    expect(absToTSType(live)).toContain("Generator<number | string");

    const deferred = snapshotAbs(live);
    const slots = (deferred.shape as { k: "obj"; slots: Record<string, unknown> }).slots;
    for (const k of Object.keys(slots)) if (/^[0-9]+$/.test(k)) delete slots[k];
    deferred.facets = { ...(deferred.facets ?? {}), genElements: undefined };
    expect(absToTSType(deferred), "体延后 ⇒ 降级").toContain("Generator<unknown");

    // 导出期：独立编译实例再做一次无约束入口求值，回填同一承载位。
    const refill = symbolicYields(src, 1);
    deferred.facets.genElements = [...elems(refill)];
    expect(absToTSType(deferred), "回填 ⇒ 零精度损失").toContain("Generator<number | string");
  });

  it("归一已落地：退化档投影为 Generator<unknown>", () => {
    const hostOnly = symbolicYields(`export function* g(xs) { yield xs.length; }`, 1);
    expect(formatAbs(joined(elems(hostOnly))!)).toContain("any");
    expect(absToTSType(hostOnly)).toContain("Generator<unknown");
  });
});

describe("符号 yield 域 PoC — 引擎本来就在做符号求值", () => {
  it("无约束入口产出的元素域与生产 dts 的产物同形", () => {
    for (const [src, arity, want] of [
      [`export function* g() { yield 1; yield 2; }`, 0, "Generator<number"],
      [`export function* g(x) { yield x + 1; }`, 1, "Generator<number | string"],
      [`export function* g(f) { if (f) yield 1; else yield "s"; }`, 1, "Generator<number | string"],
    ] as Array<[string, number, string]>) {
      expect(absToTSType(symbolicYields(src, arity))).toContain(want);
    }
  });

  it("无 facets 的旧 Abs 仍严格 fallback（PoC 不改变既有契约）", () => {
    const a = abs({ k: "obj", slots: { "0": { value: L(3), internal: true } } }, undefined, undefined, "exact");
    expect(a.facets).toBeUndefined();
    expect(absToTSType(a)).toContain("3");
  });
});
