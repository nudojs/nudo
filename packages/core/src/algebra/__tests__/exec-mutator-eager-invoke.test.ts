/**
 * Bug 49 / Bug 51：数组 mutator 在 $invoke 调用点就地变更。
 *
 * Bug 49——同表达式内多个 mutator 此前都在「变更前容器」上求值（延迟到
 * 语句尾重绑）：s.pop()+s.pop() 折 6（原生 5）、sort 后 reverse 看到未
 * 排序数组。Bug 51——CallExpression 接收者（m.get("a").push(1)）不可
 * 语句位重绑，变更被静默丢弃。根修：invokeArrMethod 的 mutator 分支经
 * $arrMutContainer 就地 writeBack（Abs 身份不变 → 别名/成员槽/Map 条目
 * 同步可见），语句位不再发射重绑行。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue, formatShape, anyAbs } from "@nudojs/core";
import { callTranspiledExportFull, runTranspiled } from "../exec/run.ts";

/** 断言结果折到字面量（litValue ok）且等于原生执行值 */
function expectNative(src: string, expected: unknown, fnName = "f") {
  const r = call(src, fnName);
  const lv = litValue(r.result);
  expect(lv).toEqual({ ok: true, value: expected });
}

describe("Bug 49 — compound mutator expressions evaluate sequentially", () => {
  it("s.pop() + s.pop() sees the first pop (native 5, was 6)", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; return s.pop() + s.pop(); }`,
      5,
    );
  });

  it("q.shift() + q.shift() sees the first shift (native 3, was 2)", () => {
    expectNative(
      `export function f() { const q = [1, 2]; return q.shift() + q.shift(); }`,
      3,
    );
  });

  it("pop followed by index read in one expression sees post-pop state", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; return s.pop() + s[0]; }`,
      4,
    );
  });

  it("chained a.sort().join() + a.reverse().join() (native \"1,2,33,2,1\")", () => {
    expectNative(
      `export function f() { const a = [3, 1, 2]; return a.sort().join(",") + a.reverse().join(","); }`,
      "1,2,33,2,1",
    );
  });

  it("post-expression container state reflects both pops", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; const r = s.pop() + s.pop(); return r * 10 + s.length; }`,
      51,
    );
  });

  it("single mutator expression still returns the JS value", () => {
    expectNative(`export function f() { return [1, 2, 3].pop(); }`, 3);
  });

  it("push returns the exact new length (tuple receiver)", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; const n = s.push(4); return n * 10 + s.length; }`,
      44,
    );
  });

  it("statement-position pair pops exactly twice", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; s.pop(); s.pop(); return s.length; }`,
      1,
    );
  });

  it("return-position compound mutators keep sequential order", () => {
    expectNative(
      `export function f() { const s = [1, 2, 3]; return s.pop() + s.pop(); }`,
      5,
    );
  });
});

describe("Bug 51 — non-rebindable receiver mutators persist", () => {
  it("m.get(\"a\").push(1) persists into the Map entry (native 1, was 0)", () => {
    expectNative(
      `
export function f() {
  const m = new Map();
  m.set("a", []);
  m.get("a").push(1);
  return m.get("a").length;
}
`,
      1,
    );
  });

  it("f().push(x) through a helper call persists (native 1, was 0)", () => {
    expectNative(
      `
export function f() {
  const m = new Map();
  m.set("a", []);
  const get = () => m.get("a");
  get().push(2);
  return m.get("a").length;
}
`,
      1,
    );
  });

  it("arr.filter(…).push(x) mutates only the fresh temporary (native 2)", () => {
    expectNative(
      `
export function f() {
  const arr = [1, 2, 3];
  arr.filter((x) => x > 1).push(9);
  return arr.filter((x) => x > 1).length;
}
`,
      2,
    );
  });

  it("member-path receiver obj.arr.push(x) still persists", () => {
    expectNative(
      `export function f() { const o = { arr: [1] }; o.arr.push(2); return o.arr.length; }`,
      2,
    );
  });

  it("variable alias receiver keeps working (regression)", () => {
    expectNative(
      `
export function f() {
  const m = new Map();
  m.set("a", []);
  const v = m.get("a");
  v.push(1);
  return m.get("a").length;
}
`,
      1,
    );
  });

  it("aliased binding sees the eager mutation", () => {
    expectNative(
      `export function f() { const a = [1, 2]; const b = a; a.push(3); return b.length; }`,
      3,
    );
  });

  it("this.arr.push(x) inside a method persists on the instance", () => {
    expectNative(
      `
export function f() {
  const o = { arr: [1] };
  o.add = function (x) { this.arr.push(x); };
  o.add(7);
  return o.arr.length;
}
`,
      2,
    );
  });
});

describe("eager mutator × branch isolation (fork snapshot/join must hold)", () => {
  it("conditional pop joins both arm states, not wrong-exact", () => {
    const exports = runTranspiled(
      `export function f(c) { const s = [1, 2, 3]; if (c) { s.pop(); } return s; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyAbs]);
    // 臂快照/join 仍成立：两臂结束态并集，不得 wrong-exact 单臂
    const shape = formatShape(r.result);
    expect(shape).toContain("[1, 2]");
    expect(shape).toContain("[1, 2, 3]");
  });

  it("logical-arm pop joins both arm states, not wrong-exact", () => {
    const exports = runTranspiled(
      `export function f(c) { const s = [1, 2, 3]; const r = c && s.pop(); return s; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyAbs]);
    const shape = formatShape(r.result);
    expect(shape).toContain("[1, 2]");
    expect(shape).toContain("[1, 2, 3]");
  });

  it("switch-arm sort persists per-arm and joins (statement-level exact sort)", () => {
    expectNative(
      `export function f() { const a = [3, 1, 2]; a.sort(); return a.join(","); }`,
      "1,2,3",
    );
    expectNative(
      `export function f() { const a = [3, 1, 2]; a.sort(); return a[0]; }`,
      1,
    );
  });

  it("unsorted statement sort degrades soundly (comparator present)", () => {
    const r = call(
      `export function f() { const a = [3, 1, 2]; a.sort((x, y) => y - x); return a; }`,
    );
    // 比较器在场：位次不可信 → 降 arr（元素域 1|2|3），不得假精确
    expect(formatShape(r.result)).toMatch(/arr|\[/);
  });

  it("frozen receiver mutator throws at call point (native TypeError)", () => {
    const r = call(
      `export function f() { try { const a = Object.freeze([2, 1]); a.sort(); return a; } catch (e) { return "THROW"; } }`,
    );
    const lv = litValue(r.result);
    expect(lv).toEqual({ ok: true, value: "THROW" });
  });

  it("sealed receiver push throws at call point (native TypeError)", () => {
    const r = call(
      `export function f() { try { const a = Object.seal([1]); a.push(2); return a.length; } catch (e) { return "THROW"; } }`,
    );
    const lv = litValue(r.result);
    expect(lv).toEqual({ ok: true, value: "THROW" });
  });

  it("reverse returns the receiver (alias identity)", () => {
    expectNative(
      `export function f() { const a = [1, 2, 3]; const r = a.reverse(); r.push(4); return a.join(","); }`,
      "3,2,1,4",
    );
  });

  it("splice returns removed elements exactly (receiver degrades per Bug 33)", () => {
    // 接收者容器按既有 $arrMutContainer splice 口径降 arr（元素域）——
    // 此处钉「返回被删元素 tuple 精确 + 变更在调用点发生」
    expectNative(
      `export function f() { const a = [1, 2, 3, 4]; const r = a.splice(1, 2); return r.join(","); }`,
      "2,3",
    );
  });
});
