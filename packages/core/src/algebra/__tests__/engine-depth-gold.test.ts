import { describe, it, expect, afterEach } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  checkSource,
  pTrue,
  $lit,
  $arr,
  formatAbs,
  litValue,
} from "../index.ts";
import { implies, setImplicationOracle, gt } from "../pred.ts";
import { lit, v, app } from "../term.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

const x = v("x");
const y = v("y");

/**
 * 引擎深度金标：Map 字面量 key · 复合赋值循环累加 · 非线性 Pred 边界。
 * 回归锚：旧 infer 套件曾把 Map.get 并成全值域、`total += n` 循环加错。
 */

function call(src: string, fnName: string, ...args: Parameters<typeof $arr>[0]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

function callNums(src: string, fnName: string, nums: number[]) {
  return call(src, fnName, $arr(nums.map((n) => $lit(n))));
}

describe("Map literal key tracking (program)", () => {
  it("ctor pairs + get('a') is the Alice record only", () => {
    const r = call(
      `
export function f() {
  const m = new Map([["a", { id: "a", name: "Alice" }], ["b", { id: "b", name: "Bob" }]]);
  return m.get("a");
}
`,
      "f",
    );
    const s = formatAbs(r.result);
    expect(s).toContain("Alice");
    expect(s).not.toContain("Bob");
    expect(s).not.toContain("undefined");
  });

  it("set/get with call-site literal key is precise", () => {
    const r = call(
      `
export function lookup(key) {
  const m = new Map();
  m.set("alice", { id: "alice", name: "Alice" });
  m.set("bob", { id: "bob", name: "Bob" });
  return m.get(key);
}
`,
      "lookup",
      $lit("alice"),
    );
    const s = formatAbs(r.result);
    expect(s).toContain("Alice");
    expect(s).not.toContain("Bob");
  });

  it("missing literal key is undefined, not a known value", () => {
    const r = call(
      `
export function probe() {
  const m = new Map();
  m.set("alice", 1);
  return m.get("zzz");
}
`,
      "probe",
    );
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
    expect(s).not.toContain("1");
  });
});

describe("compound assignment loop accumulation (program)", () => {
  it("for-of total += n on [1..5] folds to 15", () => {
    const r = callNums(
      `
export function sum(xs) {
  let total = 0;
  for (const n of xs) total += n;
  return total;
}
`,
      "sum",
      [1, 2, 3, 4, 5],
    );
    expect(litValue(r.result)).toBe(15);
    expect(formatAbs(r.result)).toBe("15  #exact");
  });

  it("for-of total = total + n on [1..5] folds to 15", () => {
    const r = callNums(
      `
export function sum(xs) {
  let total = 0;
  for (const n of xs) total = total + n;
  return total;
}
`,
      "sum",
      [1, 2, 3, 4, 5],
    );
    expect(litValue(r.result)).toBe(15);
  });

  it("inline array literal for-of folds to 15", () => {
    const r = call(
      `
export function sum() {
  let total = 0;
  for (const n of [1, 2, 3, 4, 5]) total += n;
  return total;
}
`,
      "sum",
    );
    expect(litValue(r.result)).toBe(15);
  });

  it("reduce on concrete tuple folds to 15", () => {
    const r = callNums(
      `
export function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
`,
      "sum",
      [1, 2, 3, 4, 5],
    );
    expect(litValue(r.result)).toBe(15);
  });

  it("string compound concat stays exact on literals", () => {
    const r = call(
      `
export function join() {
  let s = "";
  s += "a"; s += "b"; s += "c";
  return s;
}
`,
      "join",
    );
    expect(litValue(r.result)).toBe("abc");
  });
});

describe("compound assignment check-path gold", () => {
  it("sum([1..5]) satisfies return positive via +=", () => {
    const r = checkSource(
      "gold-compound-sum.js",
      withStdImport(`
/**
 * @nudo:refine return positive
 */
function sum(xs) {
  let total = 0;
  for (const n of xs) total += n;
  return total;
}
sum([1, 2, 3, 4, 5]);
`),
      pTrue,
      stdOpts,
    );
    expect(r.ok, r.issues.map((i) => i.message).join("; ")).toBe(true);
  });

  it("sum([-1,-2]) violates return positive via +=", () => {
    const r = checkSource(
      "gold-compound-sum-neg.js",
      withStdImport(`
/**
 * @nudo:refine return positive
 */
function sum(xs) {
  let total = 0;
  for (const n of xs) total += n;
  return total;
}
sum([-1, -2]);
`),
      pTrue,
      stdOpts,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });
});

describe("nonlinear Pred stays fail-closed without oracle", () => {
  afterEach(() => setImplicationOracle(undefined));

  it("x>0 ⊬ x*y>0 (nonlinear, built-in incomplete)", () => {
    const phi = gt(x, lit(0));
    const goal = gt(app("*", [x, y]), lit(0));
    expect(implies(phi, goal)).toBe(false);
  });

  it("optional SMT oracle can discharge nonlinear goal", () => {
    const phi = gt(x, lit(0));
    const goal = gt(app("*", [x, y]), lit(0));
    setImplicationOracle(() => true);
    expect(implies(phi, goal)).toBe(true);
    setImplicationOracle(undefined);
    expect(implies(phi, goal)).toBe(false);
  });
});

describe("JS array/object literals via $lit (programmatic args)", () => {
  it("$lit([1,2,3]) is a tuple, not unknown", () => {
    const a = $lit([1, 2, 3]);
    expect(a.shape.k).toBe("tuple");
    expect(formatAbs(a)).toContain("1");
  });

  it("$lit({ name: 'Ada' }) is an object slot", () => {
    const o = $lit({ name: "Ada", age: 36 });
    expect(o.shape.k).toBe("obj");
    const s = formatAbs(o);
    expect(s).toContain("Ada");
    expect(s).toContain("36");
  });

  it("call with $lit array arg folds for-of", () => {
    const r = call(
      `
export function sum(xs) {
  let total = 0;
  for (const n of xs) total += n;
  return total;
}
`,
      "sum",
      $lit([1, 2, 3, 4, 5]),
    );
    expect(litValue(r.result)).toBe(15);
  });
});
