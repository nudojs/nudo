/**
 * BUG-172：跨模块同名用户类 ⇒ 类注册表**裸名键**静默 clobber。
 *
 * 夹具（与 tmp/bug-report/sections/BUG-172.md 的 repro 同构）：
 * - a.js 定义 `class Config { this.a = 1 }` + `kind() { return "A" }`
 * - b.js 定义 `class Config { this.b = 2 }` + `kind() { return "B" }`
 * - d2.js 同时 import 两个模块，各自 `new Config()` 后读成员
 *
 * 修前（注册表裸名 last-wins）：
 * - `mkA()` 的构造体解析到 **B 的 spec** ⇒ `this.b = 2` 落地、`this.a` 从未
 *   初始化 ⇒ `mkA().a` 判 `undefined`（真成员被判不存在）、`mkA().b` 判 `2`
 *   （不存在的成员被判有值）；
 * - 方法查表同样按裸名 ⇒ `mkA().kind()` 判 `"B"`（读成 B 模块的方法体）。
 *
 * 修后：类规格**随值携带**（class-registry.ts 的 attachClassSpec /
 * classSpecOfAbs；副本经 carryClassSpec 过户），构造分派与成员链首环用
 * 值自己的规格 ⇒ 两个模块的 `Config` 是不同的类。
 */
import { describe, it, expect } from "vitest";

import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { litValue } from "../../abs.ts";

const MOD_A = `
export class Config {
  constructor() { this.a = 1; }
  kind() { return "A"; }
}
export function mkA() { return new Config(); }
`;

const MOD_B = `
export class Config {
  constructor() { this.b = 2; }
  kind() { return "B"; }
}
export function mkB() { return new Config(); }
`;

const MOD_D = `
import { mkA } from "./a.js";
import { mkB } from "./b.js";
export function readA() { const x = mkA(); return x.a; }
export function readB() { const x = mkB(); return x.b; }
export function absentA() { const x = mkA(); return x.b; }
export function absentB() { const x = mkB(); return x.a; }
export function kindA() { return mkA().kind(); }
export function kindB() { return mkB().kind(); }
`;

/** 两个模块各注册一份 `Config`，第三模块同时 import 二者后读成员。 */
function runGraph(): Record<string, unknown> {
  const a = runTranspiled(MOD_A, { mode: "analyze" });
  const b = runTranspiled(MOD_B, { mode: "analyze" });
  return runTranspiled(MOD_D, {
    mode: "analyze",
    modules: { "./a.js": a, "./b.js": b },
  });
}

/** 调导出函数并取字面量值（非字面量 ⇒ 抛：测试要的是**精确**判定）。 */
function lit(exports: Record<string, unknown>, fn: string): unknown {
  const r = callTranspiledExportFull(exports, fn, []);
  const v = litValue(r.result);
  if (!v.ok) {
    throw new Error(`expected literal result for ${fn}, got conf=${r.result.conf}`);
  }
  return v.value;
}

describe("BUG-172：跨模块同名类按值身份解析（不是裸名 last-wins）", () => {
  it("A 模块实例的构造体与自有字段不被 B 模块的同名类顶掉", () => {
    const d = runGraph();
    expect(lit(d, "readA")).toBe(1);
  });

  it("B 模块实例保持自己的字段（对照：不是把两边都改坏）", () => {
    const d = runGraph();
    expect(lit(d, "readB")).toBe(2);
  });

  it("A 模块实例上不存在的成员判 undefined（不读到 B 的槽）", () => {
    const d = runGraph();
    expect(lit(d, "absentA")).toBe(undefined);
  });

  it("B 模块实例上不存在的成员判 undefined（不读到 A 的槽）", () => {
    const d = runGraph();
    expect(lit(d, "absentB")).toBe(undefined);
  });

  it("实例方法链首环用值自己的规格：mkA().kind() 恒为 A 的方法体", () => {
    const d = runGraph();
    expect(lit(d, "kindA")).toBe("A");
    expect(lit(d, "kindB")).toBe("B");
  });
});
