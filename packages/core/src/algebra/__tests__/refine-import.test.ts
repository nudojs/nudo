import { describe, it, expect } from "vitest";
import {
  number,
  instantiateConstraint,
  isNudoConstraint,
} from "../constraint.ts";
import {
  execNudoModule,
  extractNudoImports,
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  refineToIndexedFull,
  takeRefineDiags,
} from "../refine.ts";
import { checkSource, pTrue } from "../index.ts";
import { predToString } from "../pred.ts";

const intf = `
export const delay = number().gt(0);
export const percent = number().ge(0).le(100);
`;

const loadModule = (spec: string): string | undefined => {
  if (spec.includes("nudo")) return intf;
  return undefined;
};

describe("@nudo:contract <param> <constraint>", () => {
  it("number().gt(0) instantiates to param > 0", () => {
    const c = number().gt(0);
    expect(isNudoConstraint(c)).toBe(true);
    expect(predToString(instantiateConstraint(c, "ms"))).toBe("ms > 0");
  });

  it("chains bounds", () => {
    const c = number().ge(0).le(100);
    expect(predToString(instantiateConstraint(c, "n"))).toContain("0");
    expect(predToString(instantiateConstraint(c, "n"))).toContain("100");
  });

  it("executes .nudo.js module", () => {
    const exp = execNudoModule(intf);
    expect(Object.keys(exp).sort()).toEqual(["delay", "percent"]);
    expect(isNudoConstraint(exp.delay)).toBe(true);
  });

  it("parses named @nudo:import", () => {
    const src = `/// @nudo:import { delay, percent } from "./x.nudo.js"\n`;
    expect(extractNudoImports(src)).toEqual([
      { names: ["delay", "percent"], spec: "./x.nudo.js" },
    ]);
  });

  it("multiline /// @nudo:import strips line prefixes from names", () => {
    const src = `/// @nudo:import {\n///   delay,\n///   percent\n/// } from "./x.nudo.js"\n`;
    expect(extractNudoImports(src)).toEqual([
      { names: ["delay", "percent"], spec: "./x.nudo.js" },
    ]);
  });

  it("import-like text inside a template string is not an import", () => {
    const src =
      'const d = `\n@nudo:import { delay } from "./evil.nudo.js"\n`;\nexport function f(x){return x}';
    expect(extractNudoImports(src)).toEqual([]);
  });

  it("function name inside a string literal does not steal contract scan", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
const code = "function setDelay() { return 0; }";
/**
 * @nudo:contract n delay
 */
export function setDelay(n) { return n; }
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(reqs.map((r) => r.param)).toEqual(["n"]);
  });

  it("resolves ms delay to Pred", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("ms");
    expect(predToString(reqs[0]!.pred)).toBe("ms > 0");
  });

  it("check catches violation from template", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(0);
`;
    const r = checkSource("/t/demo.js", src, pTrue, {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("refineToIndexedFull maps param names", () => {
    const src = `
/// @nudo:import { delay, percent } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 * @nudo:contract n percent
 */
function f(ms, n) {
  return ms + n;
}
`;
    const idx = refineToIndexedFull(src, "f", ["ms", "n"], {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(idx.length).toBe(2);
  });

  it("namespace import expands ns.foo template refs", () => {
    const src = `
/// @nudo:import * as shapes from "./x.nudo.js"
/**
 * @nudo:contract ms shapes.delay
 * @nudo:contract return shapes.percent
 */
function setDelay(ms) {
  return ms;
}
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/ns.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("ms");
    expect(predToString(reqs[0]!.pred)).toBe("ms > 0");

    const ret = extractRefineReturnFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/ns.js",
    });
    expect(ret?.name).toBe("shapes.percent");
    expect(isNudoConstraint(ret!.constraint)).toBe(true);
  });
});

describe("@nudo:import { a as b } alias binding (BUG-016)", () => {
  it("alias import binds local name to the sidecar's original export", () => {
    const src = `
/// @nudo:import { delay as pos } from "./x.nudo.js"
/**
 * @nudo:contract x pos
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`;
    takeRefineDiags();
    const reqs = extractRefinesFromSource(src, "needsPositive", {
      loadModule,
      fromFile: "/t/alias.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("x");
    expect(predToString(reqs[0]!.pred)).toBe("x > 0");
    expect(takeRefineDiags()).toEqual([]);
  });

  it("mixed { a as b, c } resolves both aliased and plain names", () => {
    const src = `
/// @nudo:import { delay as ms, percent } from "./x.nudo.js"
/**
 * @nudo:contract ms ms && n percent
 */
function f(ms, n) {
  return ms + n;
}
`;
    takeRefineDiags();
    const reqs = extractRefinesFromSource(src, "f", {
      loadModule,
      fromFile: "/t/mix.js",
    });
    expect(reqs.map((r) => r.param)).toEqual(["ms", "n"]);
    expect(predToString(reqs[0]!.pred)).toBe("ms > 0");
    expect(takeRefineDiags()).toEqual([]);
  });

  it("alias import makes the contract enforced end-to-end (checkSource)", () => {
    const src = `
/// @nudo:import { delay as pos } from "./x.nudo.js"
/**
 * @nudo:contract x pos
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;
    const r = checkSource("/t/alias.js", src, pTrue, {
      loadModule,
      fromFile: "/t/alias.js",
    });
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("return contract resolves through an alias", () => {
    const src = `
/// @nudo:import { percent as pct } from "./x.nudo.js"
/**
 * @nudo:contract return pct
 */
function big() {
  return 150;
}
`;
    takeRefineDiags();
    const ret = extractRefineReturnFromSource(src, "big", {
      loadModule,
      fromFile: "/t/ret-alias.js",
    });
    expect(ret?.name).toBe("pct");
    expect(isNudoConstraint(ret!.constraint)).toBe(true);
    expect(takeRefineDiags()).toEqual([]);
  });

  it("alias to a nonexistent export names the original export, not the alias", () => {
    const src = `
/// @nudo:import { nope as pos } from "./x.nudo.js"
/**
 * @nudo:contract x pos
 */
function f(x) {
  return x;
}
`;
    takeRefineDiags();
    const reqs = extractRefinesFromSource(src, "f", {
      loadModule,
      fromFile: "/t/miss.js",
    });
    expect(reqs).toHaveLength(0);
    const diags = takeRefineDiags();
    // 查表按导出名报缺（修复前误报 has no export 'pos'）
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:interface-load" &&
          d.message.includes("has no export 'nope'"),
      ),
    ).toBe(true);
    // 契约引用的本地名查 miss 也不再静默
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:contract-syntax" &&
          d.message.includes("'pos'"),
      ),
    ).toBe(true);
  });

  it("typo'd constraint name (no alias) → contract-syntax diagnostic, not silence", () => {
    const src = `
/// @nudo:import { positive } from "./x.nudo.js"
/**
 * @nudo:contract x positve
 */
function f(x) {
  return x;
}
`;
    takeRefineDiags();
    const reqs = extractRefinesFromSource(src, "f", {
      loadModule,
      fromFile: "/t/typo.js",
    });
    expect(reqs).toHaveLength(0);
    expect(
      takeRefineDiags().some(
        (d) =>
          d.code === "nudo:contract-syntax" &&
          d.message.includes("'positve'"),
      ),
    ).toBe(true);
  });
});

describe("@nudo:import 原型链名（PR #80 F2）", () => {
  it("相对侧车依赖缺 toString 导出 → 诊断可见，原生函数不绑进侧车域", () => {
    // 触发机制：depExports 是普通对象字面量，`"toString" in depExports` 与
    // depExports["toString"] 裸读命中 Object.prototype → 修复前诊断被吞且
    // Object.prototype.toString 原生函数被绑给 t（y 导出成原生函数）
    const dep = `export const delay = number().gt(0);`;
    const sidecar = `import { toString as t } from "./dep.nudo.js"\nexport const y = t;`;
    takeRefineDiags();
    const exp = execNudoModule(sidecar, {
      loadModule: () => dep,
      fromFile: "/t/main.nudo.js",
    });
    expect(
      takeRefineDiags().some(
        (d) =>
          d.code === "nudo:interface-load" &&
          d.message.includes("has no export 'toString'"),
      ),
    ).toBe(true);
    expect(exp.y).toBeUndefined();
  });

  it('裸包名 import { toString as t } → not-an-injected-builder 诊断 + 绑定 undefined', () => {
    // 触发机制：sidecarInjects 是普通对象，`"toString" in sidecarInjects` 命中
    // Object.prototype → 修复前诊断被吞且 prologue __nudoInjects["toString"]
    // 把原生函数绑进侧车执行域
    const sidecar = `import { toString as t } from "@nudojs/core"\nexport const y = t;`;
    takeRefineDiags();
    const exp = execNudoModule(sidecar);
    expect(
      takeRefineDiags().some(
        (d) =>
          d.code === "nudo:interface-load" &&
          d.message.includes("is not an injected builder"),
      ),
    ).toBe(true);
    expect(exp.y).toBeUndefined();
  });
});
