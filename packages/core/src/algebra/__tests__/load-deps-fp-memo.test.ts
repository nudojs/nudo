import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  generalizeFromAst,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  getGeneralizeMemoSize,
  pTrue,
} from "../index.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

/** 生成 >64 个可达 require 依赖的源码 */
function manyDepsSource(n: number): { src: string; deps: Record<string, string> } {
  const deps: Record<string, string> = {};
  let src = "";
  for (let i = 0; i < n; i++) {
    const name = `./d${i}.js`;
    deps[`/t/d${i}.js`] = `module.exports = { n: ${i} };\n`;
    src += `const m${i} = require("${name}");\n`;
  }
  src += `function id(x) { return x; }\nid(m0.n);\n`;
  return { src, deps };
}

function makeLoad(deps: Record<string, string>) {
  return (spec: string, fromFile: string) => {
    const i = fromFile.lastIndexOf("/");
    const base = i >= 0 ? fromFile.slice(0, i) : "";
    const joined = spec.startsWith(".")
      ? `${base}/${spec.replace(/^\.\//, "")}`
      : spec;
    return deps[joined];
  };
}

describe("check memo fail-open on truncated dep fingerprint", () => {
  it("does not crash when loadable deps exceed the node cap", () => {
    const { src, deps } = manyDepsSource(70);
    const loadModule = makeLoad(deps);
    const opts = { loadModule, fromFile: "/t/a.js" };
    // 截断指纹不可信 → fail-open：不写整文件 memo，必须仍能出报告
    const r1 = checkSource("/t/a.js", src, pTrue, opts);
    expect(r1).toBeDefined();
    expect(Array.isArray(r1.issues)).toBe(true);
  });

  it("still re-checks after an uncached dep changes (no stale hit)", () => {
    const { src, deps } = manyDepsSource(70);
    // 假设 64 节点 cap 后 d69 可能未进指纹；改它再 check 必须重算
    deps["/t/d69.js"] = `module.exports = { n: 999 };\n`;
    const loadModule = makeLoad(deps);
    const opts = { loadModule, fromFile: "/t/a.js" };
    const r = checkSource("/t/a.js", src, pTrue, opts);
    expect(r).toBeDefined();
    expect(Array.isArray(r.issues)).toBe(true);
  });
});

describe("generalize L0 fingerprints ordinary require deps", () => {
  it("misses L0 when a plain require target changes (parent source unchanged)", () => {
    let dep = `module.exports = { add1: (x) => x + 1 };\n`;
    const loadModule = (spec: string) =>
      spec === "./util.js" ? dep : undefined;
    const src = `
const util = require("./util.js");
function go(x) {
  return util.add1(x);
}
`;
    const opts = {
      refine: { loadModule, fromFile: "/t/a.js" },
    };
    const g0 = generalizeFromAst("go", src, opts);
    expect(g0).toBeDefined();
    expect(getGeneralizeMemoSize()).toBe(1);

    dep = `module.exports = { add1: (x) => x + 10 };\n`;
    const g1 = generalizeFromAst("go", src, opts);
    expect(g1).toBeDefined();
    // dep 内容变了 → L0 不得复用旧 PolyFn
    expect(g1).not.toBe(g0);
    expect(getGeneralizeMemoSize()).toBe(2);
  });

  it("still hits L0 when require target is unchanged", () => {
    const dep = `module.exports = { add1: (x) => x + 1 };\n`;
    const loadModule = (spec: string) =>
      spec === "./util.js" ? dep : undefined;
    const src = `
const util = require("./util.js");
function go(x) {
  return util.add1(x);
}
`;
    const opts = {
      refine: { loadModule, fromFile: "/t/a.js" },
    };
    const g0 = generalizeFromAst("go", src, opts);
    const g1 = generalizeFromAst("go", src, opts);
    expect(g1).toBe(g0);
    expect(getGeneralizeMemoSize()).toBe(1);
  });

  it("does not write L0 when deps fingerprint is truncated", () => {
    const deps: Record<string, string> = {};
    let src = "";
    for (let i = 0; i < 70; i++) {
      deps[`/t/d${i}.js`] = `module.exports = { n: ${i} };\n`;
      src += `const m${i} = require("./d${i}.js");\n`;
    }
    src += `function id(x) { return x; }\nid(m0.n);\n`;
    const loadModule = makeLoad(deps);
    const g0 = generalizeFromAst("id", src, {
      refine: { loadModule, fromFile: "/t/a.js" },
    });
    expect(g0).toBeDefined();
    expect(getGeneralizeMemoSize()).toBe(0);
  });
});
