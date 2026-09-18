/**
 * 第六轮 review P0 回归：
 * - P0.1 语句位 switch 不得 return 截断后续控制流
 * - P0.2 抽象 switch 集合 side-table 按臂隔离
 * - P0.3 逻辑/三元短路臂内数组 mutator 不得无条件重绑
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  formatShape,
} from "@nudojs/core";

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    litArgs.map((a) => $lit(a as never)),
  );
}

function callWithAbs(src: string, fnName: string, args: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

const absBool = {
  shape: { k: "prim", type: "boolean" },
  conf: "path",
} as never;

const absNum = {
  shape: { k: "prim", type: "number" },
  conf: "path",
} as never;

describe("P0.1 statement switch does not truncate following code", () => {
  it("switch with break continues to code after (concrete)", () => {
    const r = call(
      `
export function f(n) {
  let x = 0;
  switch (n) {
    case 1: x = 1; break;
    case 2: x = 2; break;
  }
  return x + 100;
}
`,
      "f",
      1,
    );
    expect(litValue(r.result)).toBe(101);
  });

  it("switch all-return still returns from function", () => {
    const r = call(
      `
export function f(n) {
  switch (n) {
    case 1: return "one";
    default: return "other";
  }
}
`,
      "f",
      1,
    );
    expect(litValue(r.result)).toBe("one");
  });

  it("abstract mixed return/break keeps early-exit in exits join (P0)", () => {
    const src = `
export function f(n) {
  switch (n) {
    case 1: return 1;
    default: break;
  }
  return 100;
}
`;
    const r = callWithAbs(src, "f", [absNum]);
    const s = formatAbs(r.result);
    // 不得丢掉 case1 早退路径，折成 exact 100
    expect(s).not.toBe("100");
    expect(r.result.conf).not.toBe("exact");
  });

  it("concrete mixed switch still hits the matching arm", () => {
    const src = `
export function f(n) {
  switch (n) {
    case 1: return 1;
    default: break;
  }
  return 100;
}
`;
    expect(litValue(call(src, "f", 1).result)).toBe(1);
    expect(litValue(call(src, "f", 2).result)).toBe(100);
  });
});

describe("P0.2 abstract switch collection arm isolation", () => {
  it("map.set in one case does not pollute default get", () => {
    const src = `
export function f(n) {
  const m = new Map();
  m.set("a", 1);
  switch (n) {
    case 1:
      m.set("b", 2);
      return m.get("b");
    default:
      return m.get("b");
  }
}
`;
    const r = callWithAbs(src, "f", [absNum]);
    const s = formatAbs(r.result);
    // default 臂真实语义是 undefined；不得只剩 exact 2
    expect(s).not.toBe("2");
    expect(s).toContain("2");
    expect(s).toMatch(/undefined|unknown/);
    // sum：两臂成员都在（2 与缺省）
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0.3 logical/ternary mutator arm isolation", () => {
  it("concrete false && a.pop() leaves array intact", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  const flag = false;
  flag && a.pop();
  return a.length;
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("concrete true && a.pop() still mutates", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  const flag = true;
  flag && a.pop();
  return a.length;
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("abstract flag && a.pop() is not exact 2", () => {
    const src = `
export function f(flag) {
  const a = [1, 2, 3];
  flag && a.pop();
  return a.length;
}
`;
    const r = callWithAbs(src, "f", [absBool]);
    const s = formatShape(r.result);
    // 健全性：不得把未进入臂的 pop 折成 exact 2
    expect(s === "2").toBe(false);
    expect(r.result.conf).not.toBe("exact");
  });

  it("concrete false ternary does not pop", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  const flag = false;
  flag ? a.pop() : 0;
  return a.length;
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("left mutator in a.pop() && x still rebinds container", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  const x = a.pop() && 1;
  return a.length;
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(2);
  });
});
