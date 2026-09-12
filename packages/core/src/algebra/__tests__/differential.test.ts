import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeFn,
  numLit,
  litValue,
  formatShape,
} from "../index.ts";

/**
 * 差分回归：同一段 JS，代数抽象求值 vs Node 真实执行。
 * 规则：若代数给出 exact 字面量，必须等于真实结果。
 * 若代数给出 prim(number)，真实结果必须是 number。
 */

function runNode(code: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), "nudo-diff-"));
  const file = join(dir, "run.mjs");
  try {
    writeFileSync(file, code);
    const out = execFileSync(process.execPath, [file], { encoding: "utf8" });
    return JSON.parse(out.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function absAndNode(
  src: string,
  fnName: string,
  args: Array<number | string | boolean>,
  callExpr: string,
): { abs: ReturnType<typeof litValue>; shape: string; node: unknown } {
  const absArgs = args.map((a) => numLit(a as number));
  // string/bool 简化：测试里主要用 number
  const result = analyzeFn(src, fnName, absArgs);
  const node = runNode(`
${src}
console.log(JSON.stringify(${callExpr}));
`);
  return { abs: litValue(result), shape: formatShape(result), node };
}

describe("differential: algebra vs Node", () => {
  it("add(1,3) → 4 both sides", () => {
    const src = `function add(a,b){ return a+b; }`;
    const r = absAndNode(src, "add", [1, 3], "add(1,3)");
    expect(r.abs).toBe(4);
    expect(r.node).toBe(4);
  });

  it("scale(5)=x+1 → 6", () => {
    const src = `function scale(x){ return x+1; }`;
    const r = absAndNode(src, "scale", [5], "scale(5)");
    expect(r.abs).toBe(6);
    expect(r.node).toBe(6);
  });

  it("twice(2) nested add → 4", () => {
    const src = `
function add(a,b){ return a+b; }
function twice(x){ return add(add(x,1),1); }
`;
    const r = absAndNode(src, "twice", [2], "twice(2)");
    // algebra: ((2+1)+1)=4
    expect(r.abs).toBe(4);
    expect(r.node).toBe(4);
  });

  it("mul precedence 1+2*3 → 7", () => {
    const src = `function f(){ return 1+2*3; }`;
    const r = absAndNode(src, "f", [], "f()");
    expect(r.abs).toBe(7);
    expect(r.node).toBe(7);
  });

  it("negate(5) → -5", () => {
    const src = `function negate(x){ return x * -1; }`;
    const r = absAndNode(src, "negate", [5], "negate(5)");
    expect(r.abs).toBe(-5);
    expect(r.node).toBe(-5);
  });

  it("if branch true: addOneIfPositive(3) → 4", () => {
    const src = `
function addOneIfPositive(x){
  if (x > 0) return x + 1;
  return 0;
}
`;
    const r = absAndNode(src, "addOneIfPositive", [3], "addOneIfPositive(3)");
    expect(r.abs).toBe(4);
    expect(r.node).toBe(4);
  });

  it("if branch false: addOneIfPositive(-2) → 0", () => {
    const src = `
function addOneIfPositive(x){
  if (x > 0) return x + 1;
  return 0;
}
`;
    const r = absAndNode(src, "addOneIfPositive", [-2], "addOneIfPositive(-2)");
    expect(r.abs).toBe(0);
    expect(r.node).toBe(0);
  });

  it("spread config exact fields", () => {
    const src = `
function createConfig(options){
  return { host: "localhost", port: 8080, debug: false, ...options };
}
`;
    // 代数用对象实参 —— 这里直接测字面量路径
    const node = runNode(`
${src}
console.log(JSON.stringify(createConfig({ port: 3000 })));
`);
    expect(node).toEqual({ host: "localhost", port: 3000, debug: false });
  });
});
