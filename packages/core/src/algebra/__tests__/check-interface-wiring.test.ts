/**
 * check/generalize 的 refine 提取收口（design-refine-derivation Phase 1 T7a）：
 * - 手写侧车 fn 契约 + 违例 case → nudo:case-inconsistency
 * - 侧车加载失败 → nudo:interface-load 进 issues（不再静默吞错）
 * - 源码 @nudo:contract 与侧车同名手写绑定常数界矛盾 → nudo:interface-conflict
 * - generated 段：case 见证不报 inconsistency（不执法），params 仍进 generalize 入口
 * - 诊断 side-channel：checkSource 多次调用取即清空无泄漏；memo 命中不重复报
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

/** 虚拟文件系统 loader：相对 spec 按 fromFile 目录解析 */
function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  return {
    loadModule: (spec: string, from: string): string | undefined =>
      files[resolve(from, spec)],
  };
}

describe("check × effectiveInterface 收口", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("手写侧车 fn 契约 + 违例 case → nudo:case-inconsistency", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
      "/t/half.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const half = fn({ x: number().gt(0) }, number());`,
    });
    const src = `
/**
 * @nudo:case "neg" (-5)
 */
export function half(x) {
  return x / 2;
}
`;
    const r = checkSource("/t/half.js", src, pTrue, {
      loadModule,
      fromFile: "/t/half.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(issue).toBeDefined();
    expect(issue!.fn).toBe("half");
    expect(issue!.expected).toContain(">");
    expect(r.ok).toBe(false);
  });

  it("侧车加载失败 → issues 出现 nudo:interface-load（不再静默）", () => {
    const { loadModule } = makeFiles({
      "/t/broken.nudo.js": `export const broken = fn({ x: number().gt(0 `,
    });
    const src = `
export function broken(x) {
  return x;
}
`;
    const r = checkSource("/t/broken.js", src, pTrue, {
      loadModule,
      fromFile: "/t/broken.js",
    });
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("broken");
  });

  it("源码 refine 与侧车同名手写绑定常数界矛盾 → nudo:interface-conflict", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
      "/t/f.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number().lt(0) });`,
    });
    const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;
    const r = checkSource("/t/f.js", src, pTrue, {
      loadModule,
      fromFile: "/t/f.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:interface-conflict");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.fn).toBe("f");
    expect(issue!.message).toContain("x");
    expect(r.ok).toBe(false);
  });

  it("conflict 位跳过调用点执法：不再叠加 constraint-violated", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
      "/t/f.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number().lt(0) });`,
    });
    const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
f(1);
`;
    const r = checkSource("/t/f.js", src, pTrue, {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(r.issues.some((i) => i.code === "nudo:interface-conflict")).toBe(true);
    // 契约本身不可满足时，调用点不该被当成违例（双重诊断）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("eq/eq 矛盾 → nudo:interface-conflict", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { lit } from "@nudojs/core";\nexport const fortyTwo = lit(42);`,
      "/t/f.nudo.js": `import { fn, lit } from "@nudojs/core";\nexport const f = fn({ x: lit(43) });`,
    });
    const src = `
/// @nudo:import { fortyTwo } from "./std.nudo.js"
/**
 * @nudo:contract x fortyTwo
 */
export function f(x) {
  return x;
}
`;
    const r = checkSource("/t/f.js", src, pTrue, {
      loadModule,
      fromFile: "/t/f.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:interface-conflict");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("x");
  });

  it("契约参数名不在形参表 → nudo:interface-param-mismatch（C4.5）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
    });
    const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract n positive
 */
export function area(n) {
  return n > 0 ? n : 0;
}
`;
    // 错名：契约写 x，形参是 n
    const bad = src.replace("@nudo:contract n positive", "@nudo:contract x positive");
    const r = checkSource("/t/area.js", bad, pTrue, {
      loadModule,
      fromFile: "/t/area.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:interface-param-mismatch");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.fn).toBe("area");
    expect(issue!.message).toContain("x");
    expect(issue!.expected).toContain("n");
    expect(r.ok).toBe(false);
  });

  it("正确参数名 → 不报 param-mismatch", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
    });
    const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract n positive
 */
export function area(n) {
  return n > 0 ? n : 0;
}
area(5);
`;
    const r = checkSource("/t/area-ok.js", src, pTrue, {
      loadModule,
      fromFile: "/t/area-ok.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-param-mismatch")).toEqual([]);
  });

  it("侧车 fn 参数名错 → 同样报 param-mismatch", () => {
    const { loadModule } = makeFiles({
      "/t/scale.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const scale = fn({ k: number().gt(0) }, number());`,
    });
    const src = `
export function scale(factor) {
  return factor * 2;
}
`;
    const r = checkSource("/t/scale.js", src, pTrue, {
      loadModule,
      fromFile: "/t/scale.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:interface-param-mismatch");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("k");
    expect(issue!.expected).toContain("factor");
  });

  it("generated 段：case 见证不报 inconsistency，params 仍进 generalize 入口", () => {
    const { loadModule } = makeFiles({
      "/t/gen.nudo.js": `import { fn, number } from "@nudojs/core";\n// @generated by nudo — do not edit\nexport const gen = fn({ x: number().gt(0) }, number());`,
    });
    const src = `
/**
 * @nudo:case "neg" (-1)
 */
export function gen(x) {
  return x;
}
`;
    const r = checkSource("/t/gen.js", src, pTrue, {
      loadModule,
      fromFile: "/t/gen.js",
    });
    expect(
      r.issues.find((i) => i.code === "nudo:case-inconsistency"),
    ).toBeUndefined();
    expect(r.ok).toBe(true);
    // generated params 进 generalize：签名展示带上入口约束（展示/推导面可用）
    const sig = r.signatures.find((s) => s.name === "gen");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain(">");
  });

  it("诊断收口：多次调用取即清空无泄漏；memo 命中不重复报；侧车修复后失效重算", () => {
    const files: Record<string, string> = {
      "/t/w.nudo.js": `export const w = fn({ x: number().gt(0 `,
    };
    const { loadModule } = makeFiles(files);
    const src = `
export function w(x) {
  return x;
}
`;
    const opts = { loadModule, fromFile: "/t/w.js" };
    const r1 = checkSource("/t/w.js", src, pTrue, opts);
    expect(r1.issues.some((i) => i.code === "nudo:interface-load")).toBe(true);
    // 诊断已被 checkSource 取走并入报告：side-channel 无残留
    expect(takeRefineDiags()).toEqual([]);
    expect(takeInterfaceDiags()).toEqual([]);
    // 同输入再查：memo 命中，已并入报告的诊断不重复不丢失
    const r2 = checkSource("/t/w.js", src, pTrue, opts);
    expect(
      r2.issues.filter((i) => i.code === "nudo:interface-load").length,
    ).toBe(1);
    expect(takeInterfaceDiags()).toEqual([]);
    // 侧车修复：闭包指纹变化 → memo 失效重算 → 诊断消失
    files["/t/w.nudo.js"] = `export const w = fn({ x: number().gt(0) }, number());`;
    const r3 = checkSource("/t/w.js", src, pTrue, opts);
    expect(
      r3.issues.some((i) => i.code === "nudo:interface-load"),
    ).toBe(false);
    expect(takeInterfaceDiags()).toEqual([]);
  });
});
