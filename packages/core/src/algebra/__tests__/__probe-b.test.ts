import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  abs,
  numLit,
  anyVar,
  relationFn,
  shapeOnlyFn,
  bool,
  num,
  str,
  v,
  formatShape,
  formatAbs,
  litValue,
  termToString,
  setBCallCollector,
  beginDerivationSession,
  abortDerivationSession,
  constraintToEntryAbs,
  endDerivationSession,
  getDerivation,
  projectDerivationDsl,
  number as numConstraint,
  setBCallCollector as setBC,
  absFunction,
  getFnImpl,
  type Abs,
} from "../index.ts";

const absBool = abs({ k: "prim", type: "boolean" }, undefined, undefined, "path");
const absNum = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, litArgs.map((a) => $lit(a as never)));
}
function callAbs(src: string, fnName: string, args: Abs[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("probe: hof.test.ts", () => {
  it("doubleAll", () => {
    const src = `
      export function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    const r = callAbs(src, "doubleAll", [arr]).result;
    console.log("doubleAll:", JSON.stringify(formatAbs(r)), r.shape.k, r.shape.k === "arr" ? litValue((r.shape as { element: Abs }).element) : "?");
  });

  it("incAll symbolic elem", () => {
    const elem = {
      shape: { k: "prim" as const, type: "number" as const },
      term: { op: "var" as const, id: "e" },
      pred: { op: "gt" as const, a: { op: "var" as const, id: "e" }, b: { op: "lit" as const, value: 0 } },
      conf: "path" as const,
    };
    const arr = abs({ k: "arr", element: elem }, undefined, undefined, "path");
    const src = `
      export function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    const r = callAbs(src, "incAll", [arr]).result;
    const el = (r.shape as { element: Abs }).element;
    console.log("incAll:", r.shape.k, termToString(el.term!), el.pred?.op, JSON.stringify(formatAbs(r)));
  });

  it("sum reduce", () => {
    const src = `
      export function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    const r = callAbs(src, "sum", [arr]).result;
    console.log("sum:", JSON.stringify(formatAbs(r)), r.shape.k);
  });

  it("keep filter", () => {
    const src = `
      export function keep(xs) {
        return xs.filter((x) => x > 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(5) }, undefined, undefined, "exact");
    const r = callAbs(src, "keep", [arr]).result;
    console.log("keep:", r.shape.k);
  });
});

describe("probe: hof-relation", () => {
  const a1 = anyVar("A1");
  const b1 = abs({ k: "any" }, v("B1"), undefined, "path");
  const arrA1 = abs({ k: "arr", element: a1 }, undefined, undefined, "path");

  it("mapAll relation D", () => {
    const src = `export function mapAll(xs, transform) { return xs.map(transform); }`;
    const cb = relationFn([a1], b1);
    const r = callAbs(src, "mapAll", [arrA1, cb]).result;
    console.log("mapAll D:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });

  it("mapAll shapeOnly E", () => {
    const src = `export function mapAll(xs, transform) { return xs.map(transform); }`;
    const cb = shapeOnlyFn([a1], b1);
    const r = callAbs(src, "mapAll", [arrA1, cb]).result;
    console.log("mapAll E:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });

  it("mapAll body wins", () => {
    const src = `export function mapAll(xs, transform) { return xs.map(transform); }`;
    const arr = abs({ k: "arr", element: numLit(3) }, undefined, undefined, "exact");
    const cb = absFunction(["x"], {
      body: {
        type: "BinaryExpression",
        operator: "*",
        left: { type: "Identifier", name: "x" },
        right: { type: "NumericLiteral", value: 2 },
      } as never,
    });
    const s = cb.shape;
    if (s.k === "fn") {
      s.paramTypes = [num()];
      s.returnType = str();
    }
    const impl = getFnImpl(cb)!;
    impl.relation = { paramTypes: [num()], returnType: str() };
    const r = callAbs(src, "mapAll", [arr, cb]).result;
    console.log("mapAll body wins:", r.shape.k, litValue((r.shape as { element: Abs }).element));
  });

  it("map tuple inline arrow", () => {
    const src = `export function doubleAll(xs) { return xs.map((x) => x * 2); }`;
    const tup = abs({ k: "tuple", elements: [numLit(1), numLit(2)] }, undefined, undefined, "exact");
    const r = callAbs(src, "doubleAll", [tup]).result;
    const els = (r.shape as { elements: Abs[] }).elements ?? [];
    console.log("tuple map:", r.shape.k, els.map((e) => litValue(e)));
  });

  it("map bare fn", () => {
    const src = `export function mapAll(xs, transform) { return xs.map(transform); }`;
    const bare: Abs = { shape: { k: "fn", params: ["x"] }, conf: "path" };
    const r = callAbs(src, "mapAll", [arrA1, bare]).result;
    console.log("map bare:", r.shape.k, (r.shape as { element: Abs }).element?.shape.k);
  });

  it("map sum callback", () => {
    const src = `export function mapAll(xs, transform) { return xs.map(transform); }`;
    const f1 = relationFn([a1], abs({ k: "prim", type: "number" }, v("B1"), undefined, "path"));
    const f2 = relationFn([a1], abs({ k: "prim", type: "string" }, v("C1"), undefined, "path"));
    const sum = abs({ k: "sum", members: [f1, f2] }, undefined, undefined, "path");
    const r = callAbs(src, "mapAll", [arrA1, sum]).result;
    console.log("map sum cb:", r.shape.k, (r.shape as { element: Abs }).element?.shape.k);
  });

  it("applyFn direct call", () => {
    const src = `export function applyFn(p, x) { return p(x); }`;
    const cb = relationFn([a1], b1);
    const r = callAbs(src, "applyFn", [cb, numLit(1)]).result;
    console.log("applyFn D:", JSON.stringify(r.term));
    const cb2 = shapeOnlyFn([a1], b1);
    const r2 = callAbs(src, "applyFn", [cb2, numLit(1)]).result;
    console.log("applyFn E:", JSON.stringify(r2.term));
  });

  it("processItems", () => {
    const src = `export function processItems(items, transform, filter) { return items.filter(filter).map(transform); }`;
    const transform = relationFn([a1], b1);
    const filter = relationFn([a1], bool());
    const r = callAbs(src, "processItems", [arrA1, transform, filter]).result;
    console.log("processItems:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });

  it("keep filter relation", () => {
    const src = `export function keep(xs, pred) { return xs.filter(pred); }`;
    const pred = relationFn([a1], bool());
    const r = callAbs(src, "keep", [arrA1, pred]).result;
    console.log("filter rel:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });

  it("fold reduce relation", () => {
    const src = `export function fold(xs, reducer, init) { return xs.reduce(reducer, init); }`;
    const reducer = relationFn([num(), a1], abs({ k: "prim", type: "number" }, v("B1"), undefined, "path"));
    const r = callAbs(src, "fold", [arrA1, reducer, numLit(0)]).result;
    console.log("fold:", JSON.stringify(formatAbs(r)), r.shape.k);
  });

  it("flatMap arr gamma", () => {
    const src = `export function fanout(xs, f) { return xs.flatMap(f); }`;
    const gamma = abs({ k: "prim", type: "string" }, v("G1"), undefined, "path");
    const f = relationFn([a1], abs({ k: "arr", element: gamma }, undefined, undefined, "path"));
    const r = callAbs(src, "fanout", [arrA1, f]).result;
    console.log("flatMap:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });

  it("flatMap non-arr", () => {
    const src = `export function fanout(xs, f) { return xs.flatMap(f); }`;
    const f = relationFn([a1], num());
    const r = callAbs(src, "fanout", [arrA1, f]).result;
    console.log("flatMap nonarr:", r.shape.k);
  });

  it("forEach", () => {
    const src = `export function walk(xs, f) { xs.forEach(f); }`;
    const f = relationFn([a1], b1);
    const r = callAbs(src, "walk", [arrA1, f]).result;
    console.log("forEach:", JSON.stringify(r.term), r.shape.k);
  });

  it("some", () => {
    const src = `export function anyPos(xs, pred) { return xs.some(pred); }`;
    const pred = relationFn([a1], bool());
    const r = callAbs(src, "anyPos", [arrA1, pred]).result;
    console.log("some:", JSON.stringify(r.shape));
  });

  it("flatMap tuple", () => {
    const src = `export function fanout(xs, f) { return xs.flatMap(f); }`;
    const tup = abs(
      {
        k: "tuple",
        elements: [
          abs({ k: "prim", type: "number" }, v("n1"), undefined, "path"),
          abs({ k: "prim", type: "string" }, v("s1"), undefined, "path"),
        ],
      },
      undefined,
      undefined,
      "path",
    );
    const f = relationFn(
      [a1],
      abs({ k: "arr", element: abs({ k: "prim", type: "number" }, v("G1"), undefined, "path") }, undefined, undefined, "path"),
    );
    const r = callAbs(src, "fanout", [tup, f]).result;
    console.log("flatMap tuple:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.term));
  });
});

describe("probe: misc", () => {
  it("boom throw", () => {
    const src = `export function boom(x) { throw "bad"; }`;
    const r = callAbs(src, "boom", [numLit(1)]);
    console.log("boom:", r.result.shape.k, r.result.conf);
  });

  it("loop recursion", () => {
    const src = `export function loop(n) { return loop(n); }`;
    const r = callAbs(src, "loop", [numLit(0)]);
    console.log("loop:", r.result.shape.k, r.result.conf);
  });

  it("caller nested processItems", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      export function caller(items) {
        return processItems(items, (x) => x * 2, (x) => x > 0);
      }
    `;
    const r = callAbs(src, "caller", [abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact")]).result;
    console.log("caller:", r.shape.k, JSON.stringify((r.shape as { element: Abs }).element?.shape));
  });

  it("derivation shift", () => {
    beginDerivationSession();
    const positive = numConstraint().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    const src = `
export function add2(x) { return x + 2; }
export function add4(x) { return add2(x + 1) + 1; }
`;
    const calls: Array<{ fnName: string; args: Abs[] }> = [];
    setBCallCollector((r) => calls.push(r));
    callAbs(src, "add4", [entry]);
    setBCallCollector(null);
    console.log("derivation calls:", calls.length, calls.map((c) => c.fnName));
    if (calls[0]) {
      const node = getDerivation(calls[0].args[0]!);
      console.log("derivation node:", node?.kind, node?.offset);
      const proj = node ? projectDerivationDsl(node, "x") : undefined;
      console.log("derivation proj:", proj?.prelude, proj?.expr);
    }
    abortDerivationSession();
  });

  it("derivation chain", () => {
    beginDerivationSession();
    const positive = numConstraint().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    const src = `
export function add2(x) { return x + 2; }
export function add4(x) { return add2(x + 1) + 1; }
`;
    const calls: Abs[] = [];
    setBCallCollector((r) => calls.push(...r.args));
    callAbs(src, "add4", [entry]);
    setBCallCollector(null);
    const arg = calls[0]!;
    const ret = callAbs(`export function add2(x) { return x + 2; }`, "add2", [arg]).result;
    const retNode = getDerivation(ret);
    console.log("chain node:", retNode?.kind, retNode?.offset);
    const proj = retNode ? projectDerivationDsl(retNode, "x") : undefined;
    console.log("chain proj:", proj?.prelude);
    abortDerivationSession();
  });

  it("derivation session order", () => {
    beginDerivationSession();
    const positive = numConstraint().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    callAbs(`export function f(x) { return x + 3; }`, "f", [entry]);
    const nodes = endDerivationSession();
    console.log("session:", nodes.length, nodes[0]?.kind, nodes.map((n) => `${n.kind}:${(n as { offset?: number }).offset}`).join(","));
  });

  it("if/else sum", () => {
    const r = callAbs(`export function f(flag) { let x = 0; if (flag) { x = 1; } else { x = 2; } return x; }`, "f", [absBool]).result;
    console.log("ifelse:", r.shape.k, JSON.stringify(formatShape(r)));
    const r2 = callAbs(`export function f(flag) { let x = 0; if (flag) { x = 1; } return x; }`, "f", [absBool]).result;
    console.log("ifnoelse:", r2.shape.k, JSON.stringify(formatShape(r2)));
  });

  it("compound += ", () => {
    const r = callAbs(`export function f(a) { let x = 1; x += a; return x; }`, "f", [$lit(5)]).result;
    console.log("plusassign lit:", JSON.stringify(formatAbs(r)));
    const r2 = callAbs(`export function f(a) { let x = 1; x += a; return x; }`, "f", [absNum]).result;
    console.log("plusassign abs:", JSON.stringify(formatAbs(r2)), JSON.stringify(formatShape(r2)));
  });

  it("??= null", () => {
    const r = callAbs(`export function f(a) { let x = null; x ??= a; return x; }`, "f", [$lit(7)]).result;
    console.log("nullish lit:", litValue(r));
    const r2 = callAbs(`export function f(a) { return a ?? "fb"; }`, "f", [absNum]).result;
    console.log("nullish abs:", JSON.stringify(formatAbs(r2)), JSON.stringify(formatShape(r2)));
  });

  it("do-while", () => {
    const r = callAbs(`export function f() { let s = 0; do { s = s + 1; } while (false); return s; }`, "f", []).result;
    console.log("dowhile:", JSON.stringify(formatAbs(r)));
  });

  it("logical assign no-arg (undefined param)", () => {
    // 原测试 analyzeFn(src, "f", []) — 缺参在 ast-eval 下绑 unknown
    const r = callAbs(`export function f(a) { let x = a; x ||= 0; return x; }`, "f", []).result;
    console.log("orassign noarg:", JSON.stringify(formatAbs(r)));
    const r2 = callAbs(`export function f(a) { let x = a; x ||= 0; return x; }`, "f", [absNum]).result;
    console.log("orassign absnum:", JSON.stringify(formatAbs(r2)));
    const r3 = callAbs(`export function f(a) { let x = { n: a }; x ??= null; return x; }`, "f", [absNum]).result;
    console.log("obj nullish:", JSON.stringify(formatAbs(r3)));
    const r4 = callAbs(`export function f(a) { let x = null; x ??= a; return x; }`, "f", [absNum]).result;
    console.log("null then ??=:", JSON.stringify(formatAbs(r4)));
  });

  it("bitwise parity", () => {
    console.log("shr:", litValue(callAbs(`export function f() { let x = 7; x >>= 1; return x; }`, "f", []).result));
    console.log("pow:", litValue(callAbs(`export function f() { let x = 2; x **= 10; return x; }`, "f", []).result));
    console.log("ushr:", litValue(callAbs(`export function f() { let x = -7; x >>>= 1; return x; }`, "f", []).result));
    console.log("and member:", litValue(callAbs(`export function f() { const o = {n: 5}; o.n &= 3; return o.n; }`, "f", []).result));
    console.log("shl expr:", litValue(callAbs(`export function f() { let x = 7; return (x <<= 2); }`, "f", []).result));
  });

  it("gradeFor early return", () => {
    const source = `
/**
 * @nudo:case "A" (92) => "A"
 * @nudo:case "F" (50) => "F"
 */
export function gradeFor(score) {
  if (score >= 85) return "A";
  return "F";
}
`;
    const r = callAbs(source, "gradeFor", [numLit(92)]).result;
    console.log("gradeFor:", JSON.stringify(formatAbs(r)));
    const multi = `
export function grade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  return "F";
}
`;
    const r2 = callAbs(multi, "grade", [numLit(85)]).result;
    console.log("grade:", JSON.stringify(formatAbs(r2)));
  });
});
