/**
 * Bug 343 —— callee 违反自己的返回契约时，调用点**不得**用「声明面」替换
 * 真实返回值。
 *
 * 旧行为（presentCallResultFace 无条件替换）：引擎已经算出 callee 的真实
 * 返回（`5`），也已经在同一次运行里判定 `5 ⊭ unit01`（违例），但调用点
 * 仍把**声明面**（`[0,1]`）当作事实交给 caller ⇒ caller 的返回契约被
 * 「证得」⇒ 跨模块时 `nudo check` 零错误（假绿）。
 *
 * 新行为：推断面**确定违反**声明约束时保留真实返回值 ⇒ caller 侧也红。
 *
 * 覆盖面：同文件路径（ambient 侧车）+ 跨模块路径（桥接 Abs）。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  runTranspiled,
  callTranspiledExportApply,
  absFunction,
} from "@nudojs/core";
import { sigOf } from "./nudo-constraints.ts";

const TPL = `import { number } from "@nudojs/core";\nexport const unit01 = number().ge(0).le(1);`;

/** callee：声明返回契约 unit01，实际返回 5（违约） */
const LIB = `/// @nudo:import { unit01 } from "./t.nudo.js"
/**
 * @nudo:contract return unit01
 */
export function inner(d, max) {
  return 5;
}
`;

function tplOpts(file: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec.includes("t.nudo.js") ? TPL : undefined,
    fromFile: file,
  };
}

describe("Bug 343 同文件：callee 违约 ⇒ caller 的返回契约不得被证得", () => {
  const src = `${LIB}
/**
 * @nudo:contract return unit01
 */
export function outer(d, max) {
  return inner(d, max);
}
`;
  const r = checkSource("/t/b343.js", src, pTrue, tplOpts("/t/b343.js"));

  it("callee 与 caller 都报 return 违例（caller 不再被「证得」）", () => {
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.map((i) => i.fn).sort()).toEqual(["inner", "outer"]);
    expect(r.ok).toBe(false);
  });

  it("caller 的返回面是真实值（5），不是声明面", () => {
    expect(sigOf(r, "outer")).toMatch(/^5\b/);
    expect(sigOf(r, "outer")).not.toContain("where");
  });

  it("caller 不得出现「靠 assume 证得」的假证明", () => {
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });
});

describe("Bug 343 跨模块：callee 在依赖文件里违约 ⇒ 调用方也红", () => {
  /** 依赖模块求值一次，按导出名桥接成 fn Abs（与 service 的模块导出面同构） */
  function bridgeDep(depSrc: string, names: string[]): Record<string, unknown> {
    const run = runTranspiled(depSrc, { mode: "analyze" });
    const named: Record<string, unknown> = {};
    for (const n of names) {
      named[n] = absFunction(["d", "max"], {
        apply: callTranspiledExportApply(run, n),
        kind: "eval-export",
        fingerprint: `eval:b343#${n}`,
      });
    }
    return named;
  }

  const modules = {
    "./lib.js": { named: bridgeDep(LIB, ["inner"]), evaluated: true },
  };

  const caller = `/// @nudo:import { unit01 } from "./t.nudo.js"
import { inner } from "./lib.js";
/**
 * @nudo:assume d <= max
 * @nudo:contract return unit01
 */
export function outer(d, max) {
  return inner(d, max);
}
`;

  const r = checkSource("/t/b343-xm.js", caller, pTrue, {
    loadModule: (spec: string): string | undefined => {
      if (spec.includes("t.nudo.js")) return TPL;
      if (spec.includes("lib.js")) return LIB;
      return undefined;
    },
    fromFile: "/t/b343-xm.js",
    modules: modules as never,
  });

  it("调用方的返回契约被判违例（旧行为：零错误 + assume-relied 假证明）", () => {
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.map((i) => i.fn)).toContain("outer");
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("调用方的返回面是真实值（5），不是声明面", () => {
    expect(sigOf(r, "outer")).toMatch(/^5\b/);
  });
});
