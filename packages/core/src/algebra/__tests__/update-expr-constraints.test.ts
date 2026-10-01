/**
 * BUG-009 回归：UpdateExpression（++/--）与复合赋值（+= / -=）同一约束代数。
 *
 * 回归背景：updateAddAbs/updateSubAbs 走 addNumeric/subNumeric 只保留数值面，
 * 丢 term/pred——`x>0` 上 `x++` 得裸 number，而 `x += 1` 走 arithmetic.add
 * 得 term=x+1、pred=x+1>1。「x>0 ⇒ x+1>1」必须对两条语法同一传播，
 * 否则 evaluator 与 check 对语义相同的代码看到不同代数（check 假阴性）。
 */
import { describe, it, expect } from "vitest";
import {
  add,
  sub,
  updateAddAbs,
  updateSubAbs,
  num,
  numLit,
  numVar,
  bigintLit,
  abs,
  absToString,
  implies,
  simplifyTerm,
  app,
  lit,
  v,
  runTranspiled,
  callTranspiledExportFull,
  withExecPhi,
  formatAbs,
} from "../index.ts";
import type { Abs } from "../abs.ts";
import { gt } from "../pred.ts";

const xgt0 = numVar("x", gt(v("x"), lit(0)));

function callFn(src: string, args: unknown[]): Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, "f", args as never[]).result as Abs;
}

describe("UpdateExpression propagates term/pred like += / -=", () => {
  it("x++ on x>0 yields term x+1 and pred x+1>1", () => {
    const inc = updateAddAbs(xgt0);
    expect(inc.term).toEqual(simplifyTerm(app("+", [v("x"), lit(1)])));
    expect(implies(inc.pred!, gt(inc.term!, lit(1)))).toBe(true);
  });

  it("x-- on x>0 yields term x-1 and pred x-1>-1", () => {
    const dec = updateSubAbs(xgt0);
    expect(dec.term).toEqual(simplifyTerm(app("-", [v("x"), lit(1)])));
    expect(implies(dec.pred!, gt(dec.term!, lit(-1)))).toBe(true);
  });

  it("x++ / x-- results identical to x += 1 / x -= 1 (shape × term × pred × conf)", () => {
    expect(updateAddAbs(xgt0)).toEqual(add(xgt0, numLit(1)));
    expect(updateSubAbs(xgt0)).toEqual(sub(xgt0, numLit(1)));
  });

  it("survey: update ± vs compound ± identical across numeric faces", () => {
    const faces: Abs[] = [
      numLit(5), // number 字面量
      numVar("x", gt(v("x"), lit(0))), // 带界符号数
      numVar("y"), // 无界符号数
      abs(num().shape, undefined, undefined, "path"), // 无 term 的 number 面
      bigintLit(1n), // bigint 字面量
      abs({ k: "prim", type: "bigint" }, v("b"), undefined, "path"), // 抽象 bigint（带 term）
      abs({ k: "prim", type: "bigint" }, undefined, undefined, "path"), // 抽象 bigint（无 term）
    ];
    for (const f of faces) {
      const one = f.shape.k === "prim" && f.shape.type === "bigint" ? bigintLit(1n) : numLit(1);
      expect(absToString(updateAddAbs(f))).toBe(absToString(add(f, one)));
      expect(absToString(updateSubAbs(f))).toBe(absToString(sub(f, one)));
    }
  });

  it("evaluator: x++ proves x+1>1 under x>0 exactly like x += 1", () => {
    const inc = `export function f(x) { if (x > 0) { x++; return x > 1; } return false; }`;
    const comp = `export function f(x) { if (x > 0) { x += 1; return x > 1; } return false; }`;
    const a = formatAbs(callFn(inc, [xgt0]));
    const b = formatAbs(callFn(comp, [xgt0]));
    expect(a).toBe(b);
    expect(a.startsWith("true")).toBe(true);
  });

  it("evaluator: Φ seed gt(x,0) propagates through x++ (return keeps term+pred)", () => {
    const src = `export function f(x) { x++; return x; }`;
    const s = formatAbs(
      withExecPhi(gt(v("x"), lit(0)), () => callFn(src, [xgt0])),
    );
    expect(s).toContain("x + 1");
    expect(s).toContain("> 1");
  });
});
