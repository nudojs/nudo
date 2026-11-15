/**
 * 模块套件：跨轮 soundness 回归（数组/Map/Set mutator、抽象臂隔离、at/delete）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape, formatAbs, $lit, leqAbs } from "@nudojs/core";
import { callLit as call, call as callAbs } from "./eval-helpers.ts";

// ---------------------------------------------------------------------------
// P0.1 array mutator fork isolation
// ---------------------------------------------------------------------------
describe("[p0] P0.1 array mutator fork isolation", () => {
/**
 * P0.1 数组 mutator 在抽象 if 臂间不得泄漏；
 * P0.3 a.at(0) 是首元素；
 * P0.2 Map/Set delete/clear 建模（经 evaluator builtin）。
 */




describe("P0.1 array mutator fork isolation", () => {
  it("abstract if true-arm pop does not leak exact mutated container to post-if", () => {
    const src = `
export function f(flag) {
  const a = [1, 2, 3];
  if (flag) {
    a.pop();
  }
  return a;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "f", [absFlag]);
    const shape = formatShape(r.result);
    expect(shape).not.toBe("[1, 2]");
    expect(shape).not.toBe("[1,2]");
    expect(shape).toMatch(/\[|arr|tuple|1/);
  });

  it("false-arm sees pre-fork container when true arm mutates (order-safe)", () => {
    const src = `
export function f(flag) {
  const a = [10, 20, 30];
  if (flag) {
    a.pop();
  }
  return a[2];
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "f", [absFlag]);
    const s = formatShape(r.result);
    // false 臂 a[2] 仍是 30；true 臂 pop 后 a[2] 是 undefined。
    expect(s).toContain("30");
    expect(s).toContain("undefined");
  });

  it("member-path mutator in true arm also joins (o.arr.pop)", () => {
    const src = `
export function f(flag) {
  const o = { arr: [1, 2, 30] };
  if (flag) {
    o.arr.pop();
  }
  return o.arr[2];
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "f", [absFlag]);
    const s = formatShape(r.result);
    // 至少不是「只看见 true 臂」的 exact undefined；应保留 false 臂元素或 number 元素域
    expect(s).toContain("undefined");
    // 30 或 widen 后的 number 元素均合法；不得只剩无关字面量
    expect(s === "undefined" ).toBe(false);
  });

  it("both-return early-lift if joins return values (2|3 or number)", () => {
    const src = `
export function f(flag) {
  const a = [1, 2, 3];
  if (flag) {
    a.pop();
    return a.length;
  }
  return a.length;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "f", [absFlag]);
    const s = formatShape(r.result);
    // true: 2; false: 3 → join 可能是 2|3 或 widen 成 number；不得只剩 true 臂 exact 2
    expect(s === "2").toBe(false);
    expect(s).toMatch(/2|3|number/);
  });
});

describe("P0.3 Array#at index semantics", () => {
  // at(-1)/at(1)/OOB/抽象下标回归已由 eval-array-methods-w7 控制组
  // 同源码覆盖；此处仅保留 w7 未以同源码覆盖的显式字面量下标 at(0)。
  it("a.at(0) is first element", () => {
    const r = call(
      `
export function f() {
  const a = ["first", "last"];
  return a.at(0);
}
`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "first" });
  });
});

describe("P0.2 Map/Set delete/clear modeling", () => {
  it("map.delete then get is undefined, not exact old value", () => {
    const r = call(
      `
export function f() {
  const m = new Map();
  m.set("k", "ok");
  m.delete("k");
  return m.get("k");
}
`,
      "f",
    );
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
    expect(s).not.toBe('"ok"');
    expect(s).not.toBe("ok");
  });

  it("map.delete then has is exact false", () => {
    const r = call(
      `
export function f() {
  const m = new Map();
  m.set("k", 1);
  m.delete("k");
  return m.has("k");
}
`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("map.clear then get is undefined", () => {
    const r = call(
      `
export function f() {
  const m = new Map();
  m.set("a", 1);
  m.clear();
  return m.get("a");
}
`,
      "f",
    );
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
  });

  it("map.delete in one abstract arm makes get join old|undefined (no FN)", () => {
    const src = `
export function lookup(flag) {
  const m = new Map();
  m.set("k", "ok");
  if (flag) {
    m.delete("k");
  }
  return m.get("k");
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "lookup", [absFlag]);
    const s = formatAbs(r.result);
    // 若侧车约定 string：必须含 undefined，不能只折 exact "ok"（假阴性）
    expect(s).toContain("undefined");
  });

  it("set.delete then has is exact false", () => {
    const r = call(
      `
export function f() {
  const s = new Set();
  s.add(1);
  s.delete(1);
  return s.has(1);
}
`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("set.clear empties membership", () => {
    const r = call(
      `
export function f() {
  const s = new Set();
  s.add(7);
  s.clear();
  return s.has(7);
}
`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("set.delete in abstract arm: has is not exact true", () => {
    const src = `
export function probe(flag) {
  const s = new Set();
  s.add(1);
  if (flag) {
    s.delete(1);
  }
  return s.has(1);
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absFlag = {
      shape: { k: "prim", type: "boolean" },
      conf: "path",
    } as never;
    const r = callTranspiledExportFull(exports, "probe", [absFlag]);
    expect(r.result.conf).not.toBe("exact");
    if (r.result.conf === "exact") {
      expect(litValue(r.result)).not.toEqual({ ok: true, value: true });
    }
  });
});

describe("P0.1 statement pop still keeps container", () => {
  it("concrete pop drops last element from returned container", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  a.pop();
  return a;
}
`,
      "f",
    );
    const shape = formatShape(r.result);
    expect(shape).not.toBe("3");
    expect(shape).toMatch(/\[|arr|tuple/);
  });
});
});

// ---------------------------------------------------------------------------
// P0-1 no-default switch is not terminating
// ---------------------------------------------------------------------------
describe("[p0] P0-1 no-default switch is not terminating", () => {
/**
 * 第八轮 review P0 回归：
 * - 无 default switch 不得当终止语句
 * - $switch 隐式 fall-through
 * - fork 臂 throw 不中止兄弟臂
 * - 逻辑赋值 ||= / &&= / ??=
 * - generator 抽象分支不得 exact 出货
 */




const absBool = { shape: { k: "prim", type: "boolean" }, conf: "path" } as never;
const absNum = { shape: { k: "prim", type: "number" }, conf: "path" } as never;

describe("P0-1 no-default switch is not terminating", () => {
  const src = `export function f(n) { switch (n) { case 1: return "one"; } return "after"; }`;
  it("concrete no-match continues after switch", () => {
    expect(litValue(call(src, "f", 2).result)).toEqual({ ok: true, value: "after" });
  });
  it("abstract keeps after path", () => {
    const r = callAbs(src, "f", [absNum]);
    const s = formatAbs(r.result);
    expect(s).not.toBe('"one"');
    expect(s).toContain("after");
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0-2 $switch implicit fall-through arm", () => {
  const src = `export function f(n) { switch (n) { case 1: return 1; case 2: return 2; } }`;
  it("concrete no-match is undefined not dropped", () => {
    const r = call(src, "f", 3);
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });
  it("abstract includes fall-through, not exact 1|2 only", () => {
    const r = callAbs(src, "f", [absNum]);
    // 完整枚举：除 1|2 外还须含 no-match 出口（undef/unknown）
    const s = formatAbs(r.result);
    expect(s).toContain("1");
    expect(s).toContain("2");
    expect(s === "1 | 2  #exact").toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0-4 fork throw does not abort sibling arm", () => {
  it("if-throw keeps normal path in result and throw in throws", () => {
    const src = `export function f(flag) { if (flag) { throw "e"; } return "ok"; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatAbs(r.result)).toContain("ok");
    expect(formatAbs(r.throws)).toContain("e");
  });
});

describe("P0-5 logical assignment short-circuit", () => {
  it("x &&= a.pop() when x is null does not pop", () => {
    const src = `export function f() { let x = null; const a=[1,2,3]; x &&= a.pop(); return a.length; }`;
    expect(litValue(call(src, "f").result)).toEqual({ ok: true, value: 3 });
  });
  it("x ||= a.pop() under abstract flag is not exact 2", () => {
    const src = `export function f(flag) { let x = flag; const a=[1,2,3]; x ||= a.pop(); return a.length; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("P0-6 generator abstract yield is not exact wrong tuple", () => {
  it("abstract branch-sensitive generator conf is not exact [1,3]", () => {
    const src = `export function* g(n) { yield 1; if (n) return 2; yield 3; }`;
    const r = callAbs(src, "g", [absBool]);
    expect(r.result.conf).not.toBe("exact");
  });
  it("concrete true still yields [1]", () => {
    const src = `export function* g(n) { yield 1; if (n) return 2; yield 3; }
export function spread(n) { return [...g(n)]; }`;
    const r = call(src, "spread", true);
    // 生成器对象是迭代器协议 obj——值域经 spread 消费断言
    expect(formatAbs(r.result)).toContain("[1]");
    expect(r.result.conf).toBe("exact");
  });
});

describe("whileSeq abstract condition joins possible exits", () => {
  it("abstract while does not keep only last body state as exact", () => {
    const src = `
export function f(n) {
  let i = 0;
  while (n > 10) { i = i + 1; }
  return i;
}
`;
    const absNumGt = { shape: { k: "prim", type: "number" }, conf: "path" } as never;
    const r = callAbs(src, "f", [absNumGt]);
    // 可能 0 次迭代出口与 body 后状态 join；不得只剩 exact 单成员 last state。
    // T5 修复后：抽象条件循环携带值 growth-widen 为无上界 prim 域
    //（旧 `0..8` sum 是 的假 exact 上界形状）。
    expect(formatShape(r.result)).not.toBe("8");
    expect(formatShape(r.result)).toBe("number");
  });
});
});

// ---------------------------------------------------------------------------
// P0 ordinary binding fork isolation (evaluator)
// ---------------------------------------------------------------------------
describe("[p0] P0 ordinary binding fork isolation (evaluator)", () => {
/**
 * 第九轮 P0 回归：普通绑定隔离 / nullish / try mark / switch 贯穿 / 循环累加 / ast-eval env join
 */




const absBool = { shape: { k: "prim", type: "boolean" }, conf: "path" } as never;
const absNum = { shape: { k: "prim", type: "number" }, conf: "path" } as never;

describe("P0 ordinary binding fork isolation (evaluator)", () => {
  it("if/else assign then read enumerates both arms", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; } else { x = 2; } return x; }`;
    expect(litValue(call(src, "f", true).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(src, "f", false).result)).toEqual({ ok: true, value: 2 });
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.shape.k).toBe("sum");
    const s = formatAbs(r.result);
    expect(s).toContain("1");
    expect(s).toContain("2");
    expect(formatShape(r.result)).not.toBe("2");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("if/else side effects on x do not accumulate across arms", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = x + 1; } else { x = x + 2; } return x; }`;
    expect(litValue(call(src, "f", true).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(src, "f", false).result)).toEqual({ ok: true, value: 2 });
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("3");
    expect(r.result.shape.k).toBe("sum");
  });

  it("if without else keeps fall-through binding", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; } return x; }`;
    expect(litValue(call(src, "f", false).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(src, "f", true).result)).toEqual({ ok: true, value: 1 });
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.shape.k).toBe("sum");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("object slot write joins both arms", () => {
    const src = `export function f(flag) { const o = { x: 0 }; if (flag) { o.x = 1; } else { o.x = 2; } return o.x; }`;
    expect(litValue(call(src, "f", true).result)).toEqual({ ok: true, value: 1 });
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("2");
  });
});

describe("P0 nullish ?? and ??=", () => {
  it("abstract number ??= keeps number domain", () => {
    const src = `export function f(a) { let x = a; x ??= 42; return x; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("42");
  });

  it("concrete nullish and non-nullish still correct", () => {
    const src = `export function f(a, b) { return a ?? b; }`;
    expect(litValue(call(src, "f", null, 7).result)).toEqual({ ok: true, value: 7 });
    expect(litValue(call(src, "f", 3, 7).result)).toEqual({ ok: true, value: 3 });
  });
});

describe("P0 try mark nested isolation", () => {
  it("pre-try abstract throw still surfaces after nested try-return", () => {
    const src = `
export function inner(y) {
  try { return y; } finally { var z = 1; }
}
export function outer(x) {
  if (x) { throw "pre"; }
  try { inner(0); return "done"; }
  catch (e) { return "c"; }
}`;
    const r = callAbs(src, "outer", [absBool]);
    expect(formatAbs(r.throws)).toContain("pre");
  });

  it("concrete outer paths still work", () => {
    const src = `
export function inner(y) {
  try { return y; } finally { var z = 1; }
}
export function outer(x) {
  if (x) { throw "pre"; }
  try { inner(0); return "done"; }
  catch (e) { return "c"; }
}`;
    const rt = call(src, "outer", true);
    expect(formatAbs(rt.throws)).toContain("pre");
    const rf = call(src, "outer", false);
    expect(litValue(rf.result)).toEqual({ ok: true, value: "done" });
  });
});

describe("P0 no-default switch mutator join includes fall-through", () => {
  it("abstract length is not exact mutated-only", () => {
    const src = `export function f(n) { const a=[1,2,3]; switch(n){ case 1: a.pop(); break; } return a.length; }`;
    expect(litValue(call(src, "f", 1).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(src, "f", 2).result)).toEqual({ ok: true, value: 3 });
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("2");
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("P0 switch non-break fall-through", () => {
  it("concrete case1 falls into case3 side effects", () => {
    const src = `export function f(n) { let x=0; switch(n){ case 1: case 2: x=1; case 3: x=x+1; break; default: x=99; } return x; }`;
    expect(litValue(call(src, "f", 1).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(src, "f", 2).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(src, "f", 3).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(src, "f", 4).result)).toEqual({ ok: true, value: 99 });
  });

  it("abstract is not exact last/default only", () => {
    const src = `export function f(n) { let x=0; switch(n){ case 1: case 2: x=1; case 3: x=x+1; break; default: x=99; } return x; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("99");
  });
});

describe("P0 loop accumulator abstract not exact maxIters", () => {
  it("for-loop sum under abstract n is not exact 8", () => {
    const src = `export function f(n) { let s=0; for(let i=0;i<n;i=i+1){s=s+1;} return s; }`;
    expect(litValue(call(src, "f", 3).result)).toEqual({ ok: true, value: 3 });
    const r = callAbs(src, "f", [absNum]);
    // T5 修复后：抽象条件循环携带累加器 growth-widen 为无上界 prim 域
    //（旧 `0..8` sum 是 的假 exact 上界形状）。
    expect(formatShape(r.result)).not.toBe("8");
    expect(formatShape(r.result)).toBe("number");
  });
});

describe("P0 env join via export call (check path)", () => {
  it("export call if/else assign then read enumerates arms", () => {
    const r = callAbs(
      `export function f(flag) { let x = 0; if (flag) { x = 1; } else { x = 2; } return x; }`,
      "f",
      [absBool],
    ).result;
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).not.toBe("0");
  });

  it("export call if without else keeps fall-through", () => {
    const r = callAbs(
      `export function f(flag) { let x = 0; if (flag) { x = 1; } return x; }`,
      "f",
      [absBool],
    ).result;
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).not.toBe("1");
  });
});

describe("joinAbs dual literals is enumeration", () => {
  it("joinAbs(1,2) is sum of members", async () => {
    const { joinAbs, numLit } = await import("@nudojs/core");
    const { formatShape } = await import("@nudojs/core");
    const r = joinAbs(numLit(1), numLit(2));
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).toContain("1");
    expect(formatShape(r)).toContain("2");
  });
});
});

// ---------------------------------------------------------------------------
// P0 fork isolation vs nested shadow names (evaluator)
// ---------------------------------------------------------------------------
describe("[p0] P0 fork isolation vs nested shadow names (evaluator)", () => {
/**
 * 第十轮 P0 回归：fork 嵌套同名隔离 / for-of 空与抽象 / check 复合赋值 /
 * do-while 双路径 / leq 字面量判别
 */




const absBool = { shape: { k: "prim", type: "boolean" }, conf: "path" } as never;
const absNum = { shape: { k: "prim", type: "number" }, conf: "path" } as never;

describe("P0 fork isolation vs nested shadow names (evaluator)", () => {
  it("outer let write + nested function param same name still joins", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; function g(x) { return x; } } return x; }`;
    expect(litValue(call(src, "f", true).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(src, "f", false).result)).toEqual({ ok: true, value: 0 });
    const r = callAbs(src, "f", [absBool]);
    const shown = formatAbs(r.result);
    expect(shown).toContain("1");
    expect(shown).toContain("0");
    expect(formatShape(r.result)).not.toBe("1");
    expect(formatShape(r.result)).not.toBe("0");
  });

  it("arrow param same name as outer write does not drop isolation", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; const h = (x) => x; } return x; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("1");
    expect(formatShape(r.result)).not.toBe("0");
  });

  it("forEach callback param same name keeps outer join", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; [1,2].forEach((x) => {}); } return x; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("1");
  });
});

describe("P0 for-of empty / abstract accumulators", () => {
  it("empty tuple for-of does not expand to maxIters", () => {
    const src = `export function f() { let s = 0; for (const x of []) { s = s + 1; } return s; }`;
    expect(litValue(call(src, "f").result)).toEqual({ ok: true, value: 0 });
  });

  it("abstract iterable (arr) widens to unbounded domain (0..n exits covered)", () => {
    const src = `export function f(a) { let s = 0; for (const x of a) { s = s + 1; } return s; }`;
    const absArr = { shape: { k: "arr", element: { shape: { k: "prim", type: "number" }, conf: "path" } }, conf: "path" } as never;
    const r = callAbs(src, "f", [absArr]);
    // 单代表迭代 + 增长宽化——计数器域 = 无上界 number（native
    // a.length 任意，{0,1} 不是超集），0 次出口由 number 域覆盖
    const shown = formatAbs(r.result);
    expect(shown).toContain("number");
    expect(shown).toContain("#widened");
    expect(formatShape(r.result)).not.toBe("8");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("for-of over a number-typed receiver is a definite TypeError (numbers are never iterable)", () => {
    // 原生：for (const x of 5) → TypeError（迭代守卫；此前静默迭代为错误）
    const src = `export function f(a) { let s = 0; for (const x of a) { s = s + 1; } return s; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatAbs(r.throws)).toContain("TypeError");
  });

  it("concrete tuple for-of still counts exactly", () => {
    const src = `export function f() { let s = 0; for (const x of [1,2]) { s = s + 1; } return s; }`;
    expect(litValue(call(src, "f").result)).toEqual({ ok: true, value: 2 });
  });
});

describe("P0 check-path compound / logical assignment", () => {
  it("export call += concrete", () => {
    const r = callAbs(`export function f(a) { let x = 1; x += a; return x; }`, "f", [$lit(5)]).result;
    expect(formatAbs(r)).toBe("6  #exact");
  });

  it("export call += abstract number", () => {
    const r = callAbs(
      `export function f(a) { let x = 1; x += a; return x; }`,
      "f",
      [absNum],
    ).result;
    expect(formatAbs(r)).not.toBe("1  #exact");
  });

  it("export call ??= writes RHS when left null", () => {
    const r = callAbs(`export function f(a) { let x = null; x ??= a; return x; }`, "f", [$lit(7)]).result;
    expect(litValue(r)).toEqual({ ok: true, value: 7 });
  });

  it("export call ?? keeps non-nullish domain", () => {
    const r = callAbs(`export function f(a) { return a ?? "fb"; }`, "f", [absNum]).result;
    expect(formatAbs(r)).not.toBe('"fb"');
    expect(formatShape(r)).toContain("number");
  });
});

describe("P0 do-while dual path", () => {
  it("evaluator runs do-while body at least once", () => {
    const src = `export function f() { let s = 0; do { s = s + 1; } while (false); return s; }`;
    expect(litValue(call(src, "f").result)).toEqual({ ok: true, value: 1 });
  });

  it("export-call do-while agrees", () => {
    const r = callAbs(
      `export function f() { let s = 0; do { s = s + 1; } while (false); return s; }`,
      "f",
      [],
    ).result;
    expect(formatAbs(r)).toBe("1  #exact");
  });
});

describe("P1 leq literal discrimination", () => {
  it("2 ⊄ 1", () => {
    expect(leqAbs($lit(2), $lit(1)).ok).toBe(false);
  });

  it("number ⊄ lit 1", () => {
    expect(leqAbs(absNum, $lit(1)).ok).toBe(false);
  });

  it("string ⊄ number still fails", () => {
    expect(
      leqAbs({ shape: { k: "prim", type: "string" }, conf: "path" } as never, absNum).ok,
    ).toBe(false);
  });

  it("lit 1 ≤ number prim succeeds", () => {
    expect(leqAbs($lit(1), absNum).ok).toBe(true);
  });
});
});
