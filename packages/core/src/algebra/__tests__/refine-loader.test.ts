/**
 * 侧车 loader 升级（design-refine-derivation §2.2 Phase 1）：
 * Babel 语句级改写（多行 import / 注释与字符串不误伤）、相对 .nudo 递归、
 * 环检测（NudoSidecarError）、依赖闭包内容指纹缓存、静默吞错翻转
 * （nudo:interface-load / nudo:interface-cycle）、@nudo:interface 别名。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  execNudoModule,
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  resetNudoModuleExecCache,
  setRefineDiagCollector,
  takeRefineDiags,
  NudoSidecarError,
} from "../refine.ts";
import {
  instantiateConstraint,
  isNudoConstraint,
  type NudoConstraint,
} from "../constraint.ts";
import { predToString } from "../pred.ts";

beforeEach(() => {
  resetNudoModuleExecCache();
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("侧车 loader：Babel 语句级改写", () => {
  it("多行 named import（含 alias）正确求值", () => {
    const src = `
import {
  number,
  string as str,
} from "@nudojs/core";

export const positive = number().gt(0);
export const named = str().min(1);
`;
    const exp = execNudoModule(src);
    expect(Object.keys(exp).sort()).toEqual(["named", "positive"]);
    expect(isNudoConstraint(exp.positive)).toBe(true);
    expect(isNudoConstraint(exp.named)).toBe(true);
    expect(takeRefineDiags()).toEqual([]);
  });

  it("注释/字符串里的 `export const` 字样不误伤", () => {
    const src = `
// export const fake = number().gt(0);
const note = "export const trap = number();";
export const real = number().gt(1);
`;
    const exp = execNudoModule(src);
    // 正则剥壳会从注释/字符串里捡出 fake/trap 假导出名
    expect(Object.keys(exp)).toEqual(["real"]);
    expect(isNudoConstraint(exp.real)).toBe(true);
    expect(takeRefineDiags()).toEqual([]);
  });

  it("裸用构建器（无 import 行）仍经参数注入求值", () => {
    const exp = execNudoModule(`export const positive = number().gt(0);`);
    expect(isNudoConstraint(exp.positive)).toBe(true);
  });
});

describe("侧车 loader：相对 .nudo 递归", () => {
  it("两级相对 import 递归求值", () => {
    const std = `export const positive = number().gt(0);`;
    const mid = `
import { positive } from "./std.nudo.js";
export const midPos = positive;
`;
    const root = `
import {
  midPos,
} from "./mid.nudo.js";
export const top = midPos;
`;
    const loadModule = (spec: string) =>
      spec === "./mid.nudo.js" ? mid : spec === "./std.nudo.js" ? std : undefined;
    const exp = execNudoModule(root, { loadModule, fromFile: "/t/root.nudo.js" });
    expect(Object.keys(exp)).toEqual(["top"]);
    expect(isNudoConstraint(exp.top)).toBe(true);
    expect(predToString(instantiateConstraint(exp.top as NudoConstraint, "x"))).toBe("x > 0");
    expect(takeRefineDiags()).toEqual([]);
  });

  it("spec 链成环 → NudoSidecarError（code=nudo:interface-cycle，消息含链）", () => {
    const a = `import { bName } from "./b.nudo.js";\nexport const aName = bName;\n`;
    const b = `import { aName } from "./a.nudo.js";\nexport const bName = aName;\n`;
    const loadModule = (spec: string) => (spec === "./a.nudo.js" ? a : b);
    let err: unknown;
    try {
      execNudoModule(a, { loadModule, fromFile: "/t/a.nudo.js" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NudoSidecarError);
    const e = err as NudoSidecarError;
    expect(e.code).toBe("nudo:interface-cycle");
    expect(e.message).toContain("/t/a.nudo.js");
    expect(e.message).toContain("/t/b.nudo.js");
  });

  it("环经 collectConstraints 转为 nudo:interface-cycle 诊断（不裸抛）", () => {
    const a = `import { bName } from "./b.nudo.js";\nexport const aName = bName;\n`;
    const b = `import { aName } from "./a.nudo.js";\nexport const bName = aName;\n`;
    const loadModule = (spec: string) => (spec === "./a.nudo.js" ? a : b);
    const src = `
/// @nudo:import { aName } from "./a.nudo.js"
/**
 * @nudo:refine x aName
 */
function f(x) { return x; }
`;
    const reqs = extractRefinesFromSource(src, "f", { loadModule, fromFile: "/t/demo.js" });
    expect(reqs).toEqual([]);
    const diags = takeRefineDiags();
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:interface-cycle" &&
          d.message.includes("/t/a.nudo.js") &&
          d.message.includes("/t/b.nudo.js"),
      ),
    ).toBe(true);
  });

  it("无 loadModule 的相对 import → nudo:interface-load（unresolvable）", () => {
    const src = `
import { positive } from "./std.nudo.js";
export const p = positive;
`;
    const exp = execNudoModule(src);
    expect("p" in exp).toBe(true); // 部分求值：绑定 undefined，不崩
    const diags = takeRefineDiags();
    expect(
      diags.some(
        (d) => d.code === "nudo:interface-load" && d.message.includes("unresolvable"),
      ),
    ).toBe(true);
  });

  it("loadModule 返回 undefined → nudo:interface-load（unresolvable）", () => {
    const src = `
import { positive } from "./std.nudo.js";
export const p = positive;
`;
    execNudoModule(src, { loadModule: () => undefined, fromFile: "/t/x.nudo.js" });
    expect(
      takeRefineDiags().some(
        (d) => d.code === "nudo:interface-load" && d.message.includes("unresolvable"),
      ),
    ).toBe(true);
  });
});

describe("侧车 loader：吞错翻转（不再静默）", () => {
  it("export function 侧车导出 → nudo:interface-load", () => {
    const src = `
import { number } from "@nudojs/core";
export function helper(x) { return x; }
export const positive = number().gt(0);
`;
    const exp = execNudoModule(src);
    expect(Object.keys(exp)).toEqual(["positive"]);
    expect(isNudoConstraint(exp.positive)).toBe(true);
    expect(
      takeRefineDiags().some(
        (d) =>
          d.code === "nudo:interface-load" && d.message.includes("export function helper"),
      ),
    ).toBe(true);
  });

  it("侧车执行失败 → nudo:interface-load（原 catch { continue } 静默）", () => {
    const bad = `export const boom = undefinedVariable;`;
    const src = `
/// @nudo:import { boom } from "./bad.nudo.js"
/**
 * @nudo:refine x boom
 */
function f(x) { return x; }
`;
    const reqs = extractRefinesFromSource(src, "f", {
      loadModule: () => bad,
      fromFile: "/t/a.js",
    });
    expect(reqs).toEqual([]);
    expect(
      takeRefineDiags().some(
        (d) => d.code === "nudo:interface-load" && d.message.includes("failed to execute"),
      ),
    ).toBe(true);
  });

  it("导入名不在侧车导出表 → nudo:interface-load", () => {
    const std = `export const positive = number().gt(0);`;
    const src = `
/// @nudo:import { nope } from "./std.nudo.js"
/**
 * @nudo:refine x nope
 */
function f(x) { return x; }
`;
    const reqs = extractRefinesFromSource(src, "f", {
      loadModule: () => std,
      fromFile: "/t/a.js",
    });
    expect(reqs).toEqual([]);
    expect(
      takeRefineDiags().some(
        (d) => d.code === "nudo:interface-load" && d.message.includes("'nope'"),
      ),
    ).toBe(true);
  });

  it("诊断 collector 挂钩；takeRefineDiags 收集即清空", () => {
    const seen: unknown[] = [];
    setRefineDiagCollector((d) => seen.push(d));
    const src = `import { positive } from "./std.nudo.js";\nexport const p = positive;\n`;
    execNudoModule(src);
    setRefineDiagCollector(null);
    expect(seen.length).toBeGreaterThan(0);
    const diags = takeRefineDiags();
    expect(diags.length).toBe(seen.length);
    expect(takeRefineDiags()).toEqual([]); // 已清空
  });
});

describe("侧车 loader：依赖闭包内容指纹缓存", () => {
  it("修改 dep 内容后父侧车结果更新（内容键直接生效，无需 reset）", () => {
    let depSrc = `export const positive = number().gt(0);`;
    const parent = `
import { positive } from "./std.nudo.js";
export const bound = positive;
`;
    const loadModule = (spec: string) =>
      spec.includes("parent") ? parent : spec.includes("std") ? depSrc : undefined;
    const src = `
/// @nudo:import { bound } from "./parent.nudo.js"
/**
 * @nudo:refine x bound
 */
function f(x) { return x; }
`;
    const opts = { loadModule, fromFile: "/t/demo.js" };
    const p1 = extractRefinesFromSource(src, "f", opts);
    expect(p1.length).toBe(1);
    expect(predToString(p1[0]!.pred)).toBe("x > 0");

    depSrc = `export const positive = number().gt(10);`;
    const p2 = extractRefinesFromSource(src, "f", opts);
    expect(p2.length).toBe(1);
    expect(predToString(p2[0]!.pred)).toBe("x > 10"); // 单文件 src 键会命中陈旧导出
  });

  it("dep 未变时命中缓存（约束对象复用）", () => {
    const depSrc = `export const positive = number().gt(0);`;
    const parent = `
import { positive } from "./std.nudo.js";
export const bound = positive;
`;
    const loadModule = (spec: string) =>
      spec.includes("parent") ? parent : spec.includes("std") ? depSrc : undefined;
    const src = `
/// @nudo:import { bound } from "./parent.nudo.js"
/**
 * @nudo:refine x bound
 */
function f(x) { return x; }
`;
    const opts = { loadModule, fromFile: "/t/demo.js" };
    const p1 = extractRefinesFromSource(src, "f", opts);
    const p2 = extractRefinesFromSource(src, "f", opts);
    expect(p2[0]!.constraint).toBe(p1[0]!.constraint); // 缓存命中，同一 exports 记录
  });
});

describe("@nudo:interface 别名", () => {
  const std = `export const positive = number().gt(0);`;

  it("参数精化解析出与 @nudo:refine 相同的 RefineEntry", () => {
    const mk = (directive: string) => `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * ${directive} x positive
 */
function f(x) { return x; }
`;
    const opts = { loadModule: () => std, fromFile: "/t/a.js" };
    const a = extractRefinesFromSource(mk("@nudo:refine"), "f", opts);
    const b = extractRefinesFromSource(mk("@nudo:interface"), "f", opts);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(b[0]!.param).toBe(a[0]!.param);
    expect(predToString(b[0]!.pred)).toBe(predToString(a[0]!.pred));
    expect(predToString(b[0]!.pred)).toBe("x > 0");
    expect(b[0]!.constraint).toBe(a[0]!.constraint);
  });

  it("return 精化同样接受别名", () => {
    const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:interface return positive
 */
function f(x) { return x; }
`;
    const ret = extractRefineReturnFromSource(src, "f", {
      loadModule: () => std,
      fromFile: "/t/a.js",
    });
    expect(ret?.name).toBe("positive");
    expect(isNudoConstraint(ret?.constraint)).toBe(true);
  });
});
