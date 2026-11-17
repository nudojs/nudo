/**
 * 模块套件：入口普查与调用点的**形态覆盖**。
 *
 * 入口表 / 调用点扫描都是「枚举已知 AST 形状」的分派器：漏一种形态 =
 * 该构造整体不进入分析（门禁无对象可查 ⇒ 判绿）。本套件钉住四条形态：
 * `new` 作为调用点、`export const s = new C()` 作为入口源、对象字面量经
 * spread 引入的成员、以及 `new` 上的前置契约执法。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { listTopFunctions } from "../scan/scan-top-functions.ts";
import { makeFiles, STD_NUDO_SRC } from "./nudo-constraints.ts";

const loadModule = (files: ReturnType<typeof makeFiles>["loadModule"]) => {
  return (spec: string, from: string): string | undefined => {
    if (spec.includes(".nudo.")) return STD_NUDO_SRC;
    return files(spec, from);
  };
};

describe("入口普查的声明形态覆盖", () => {
  it("导出「本地非导出类的实例」时，实例方法进入口表（BUG-054）", () => {
    const names = listTopFunctions(`class Svc {
  run(x) { return x; }
}
export const svc = new Svc();
`);
    expect(names).toContain("Svc.run");
  });

  it("对象字面量经 spread 引入的方法进入口表（BUG-108）", () => {
    const names = listTopFunctions(`const base = { bad(x) { return x; } };
export const api = { ...base, good() { return 1; } };
`);
    expect(names).toContain("bad");
    expect(names).toContain("good");
  });

  it("负控制：未导出的实例不是模块入口（照旧不入表）", () => {
    const names = listTopFunctions(`class Svc { run(x) { return x; } }
const svc = new Svc();
export function keep() { return svc; }
`);
    expect(names).not.toContain("Svc.run");
    expect(names).toContain("keep");
  });
});

describe("new 表达式是调用点", () => {
  const LIB = `/// @nudo:import { positive } from "./std.nudo.js"
/** @nudo:contract x positive */
export function make(x) { return { x }; }
`;
  // 载入器按 spec 特征返回（/t 下的相对解析与本用例无关）
  const loadModule = (spec: string): string | undefined => {
    if (spec.includes(".nudo.")) return STD_NUDO_SRC;
    if (spec.includes("lib")) return LIB;
    return undefined;
  };
  const run = (path: string, src: string) =>
    checkSource(path, src, pTrue, { loadModule, fromFile: path });
  const CALL = `import { make } from "./lib.js";
export function caller() { return make(-1); }
`;
  const NEW = `import { make } from "./lib.js";
export function caller() { return new make(-1); }
`;

  it("`new F(-1)` 与 `F(-1)` 同一份契约、同一裁决（BUG-077）", () => {
    const direct = run("/t/viaCall.js", CALL);
    const viaNew = run("/t/viaNew.js", NEW);
    expect(direct.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
    expect(viaNew.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
    expect(viaNew.issues.find((i) => i.code === "nudo:constraint-violated")?.fn).toBe("make");
  });
});
