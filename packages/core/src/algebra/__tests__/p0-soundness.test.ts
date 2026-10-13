/**
 * P0.1 数组 mutator 在抽象 if 臂间不得泄漏；
 * P0.3 a.at(0) 是首元素；
 * P0.2 Map/Set delete/clear 建模（经 evaluator builtin）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
  formatAbs,
} from "@nudojs/core";
import { callLit as call } from "./eval-helpers.ts";

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
  // at(-1)/at(1)/OOB/抽象下标回归已由 eval-array-methods-w7 Bug 67 控制组
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
