/**
 * 族 15 / 分片 S14 —— Bug 988 回归钉。
 *
 * Bug 988：同一被推导函数的**派生契约随 root 调用点个数漂移**（组合式精确 vs
 * 展开式 **1 ULP 外推**）⇒ 派生产物**不可复现**，且两种形态的**接受集合在边界
 * 值上相反**（`x = 1`：组合式 `x > 1` 违约，展开式 `x > 0.9999999999999999`
 * 通过）。
 *
 * 夹具：`add2(x) => x + 2`（实现逐字相同），root 分别写
 *   one：`add2(x + 1) + 1`（1 个调用点）
 *   two：`add2(x + 1) + add2(x + 1)`（2 个调用点）
 * ⇒ 改前：one = 组合式 `fn({ x }, x.shift(2))`；two = 展开式
 *   `fn({ x: number().gt(0.9999999999999999) }, number().gt(2.9999999999999996))`
 * ⇒ 改后：两者**完全一致**（组合式、精确、接受集合相同）。
 *
 * 负控制：两个调用点**实参不同**（各链不一致）⇒ 退回展开式 / 不可投影，
 * 不得产出非法侧车（同名不同值的 const）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execNudoModule, formatConstraint, type NudoConstraint } from "@nudojs/core";
import { defaultLoadModule } from "../../load-module.ts";
import { deriveFromRoot, emitDerivedFromRoot } from "../interface-derivation.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-s14-988-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const ADD_JS = `export function add2(x) { return x + 2; }\n`;

/** root 调用 add2 的方式不同 ⇒ 派生契约必须一致 */
function writeAddFixture(rootBody: string, sub = "add"): string {
  const d = join(dir, sub);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "std.nudo.js"), STD);
  writeFileSync(join(d, "add.js"), ADD_JS);
  writeFileSync(
    join(d, "lib.js"),
    `import { add2 } from "./add.js";
export function add4(x) { return ${rootBody}; }
`,
  );
  writeFileSync(
    join(d, "lib.nudo.js"),
    `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
`,
  );
  return d;
}

/** 侧车落盘 + 读回契约文本（`export const add2 = …` 那一行） */
function emitAndContractLine(sub: string): string {
  const d = join(dir, sub);
  const e = emitDerivedFromRoot(join(d, "lib.js"), { mode: "update", fnNames: ["add2"] });
  expect(e.sidecars.length).toBe(1);
  const sc = readFileSync(join(d, "add.nudo.js"), "utf-8");
  const line = sc.split("\n").find((l) => l.startsWith("export const add2"));
  return line ?? "";
}

/** 侧车里 add2 的**生效**契约（参数域 / 返回域）——按实际求值结果读，不看文本 */
function effectiveContract(sub: string): { param: string; ret: string } {
  const d = join(dir, sub);
  const sc = readFileSync(join(d, "add.nudo.js"), "utf-8");
  const exports = execNudoModule(sc, { loadModule: defaultLoadModule, fromFile: join(d, "add.nudo.js") });
  const v = exports["add2"] as { fn?: { params?: Record<string, NudoConstraint>; returns?: NudoConstraint } };
  const fn = v.fn!;
  return {
    param: formatConstraint(fn.params!["x"]!),
    ret: formatConstraint(fn.returns!),
  };
}

describe("Bug 988 —— 同一被推导函数的派生契约不得随 root 调用点个数漂移", () => {
  it("调用点 1 次 vs 2 次：派生行（参数位 + 返回位）完全一致", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");

    const one = deriveFromRoot(join(dir, "one", "lib.js"), { fnNames: ["add2"] }).derived[0]!;
    const two = deriveFromRoot(join(dir, "two", "lib.js"), { fnNames: ["add2"] }).derived[0]!;

    expect(one.compositional).toBe(true);
    expect(two.compositional).toBe(true);
    // 参数位
    expect(two.params.map((p) => p.dsl)).toEqual(one.params.map((p) => p.dsl));
    expect(two.params.map((p) => p.prelude)).toEqual(one.params.map((p) => p.prelude));
    // 返回位
    expect(two.returns!.dsl).toBe(one.returns!.dsl);
    expect(formatConstraint(two.returns!.constraint)).toBe(formatConstraint(one.returns!.constraint));
  });

  it("落盘侧车的契约行一致（组合式精确，不是 1 ULP 展开式）", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");

    const lineOne = emitAndContractLine("one");
    const lineTwo = emitAndContractLine("two");
    expect(lineOne).toBe("export const add2 = fn({ x }, x.shift(2));");
    expect(lineTwo).toBe(lineOne);
    // 展开式回退的 1 ULP 字面量不得出现
    expect(lineTwo).not.toContain("0.9999999999999999");
    expect(lineTwo).not.toContain("2.9999999999999996");
  });

  it("两种形态的**接受集合相同**（生效契约：x > 1，返回 > 3）", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");
    emitAndContractLine("one");
    emitAndContractLine("two");

    const one = effectiveContract("one");
    const two = effectiveContract("two");
    // 精确边界（不是 nextDown 保守端点）
    expect(one.param).toBe("number().gt(1)");
    expect(one.ret).toBe("number().gt(3)");
    expect(two).toEqual(one);
  });

  it("负控制：两个调用点实参不同 ⇒ 不可投影（不得产出非法侧车）", () => {
    const d = writeAddFixture("add2(x + 1) + add2(x + 5)", "diff");
    const r = deriveFromRoot(join(d, "lib.js"), { fnNames: ["add2"] });
    const row = r.derived[0]!;
    // 各调用点链不一致 ⇒ 组合式不可用（同名不同值的 const ⇒ 侧车非法 ESM）
    expect(row.compositional).toBe(false);
    const e = emitDerivedFromRoot(join(d, "lib.js"), { mode: "update", fnNames: ["add2"] });
    expect(e.sidecars[0]!.written).toBe(false);
    // 盘上不得出现重复的 const 声明
    let sidecar = "";
    try {
      sidecar = readFileSync(join(d, "add.nudo.js"), "utf-8");
    } catch {
      sidecar = "";
    }
    const consts = sidecar.split("\n").filter((l) => l.startsWith("const "));
    expect(new Set(consts).size).toBe(consts.length);
  });

  it("负控制：单调用点的既有组合式形态不变", () => {
    const d = writeAddFixture("add2(x + 1) + 1", "single");
    const r = deriveFromRoot(join(d, "lib.js"), { fnNames: ["add2"] });
    const row = r.derived[0]!;
    expect(row.compositional).toBe(true);
    expect(row.params[0]!.prelude).toEqual(["const x = positive.shift(1);"]);
    expect(row.returns!.dsl).toBe("x.shift(2)");
  });
});
