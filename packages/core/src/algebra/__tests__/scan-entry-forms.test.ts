/**
 * 模块套件：入口普查与调用点的**形态覆盖**。
 *
 * 入口表 / 调用点扫描都是「枚举已知 AST 形状」的分派器：漏一种形态 =
 * 该构造整体不进入分析（门禁无对象可查 ⇒ 判绿）。本套件钉住这些形态：
 * `new` 作为调用点、`export const s = new C()` 作为入口源（含未导出类
 * 表达式）、对象字面量 own / spread 成员的普查与导出面登记、导出面成员键的
 * 侧车绑定，以及 `.bind` / `.call` / `.apply` 这些别名的**作用域裁决**。
 * 每个用户可见修复都有至少一条**前修复必红**的回归。
 */
import { describe, it, expect } from "vitest";
import { checkSource, localNamedExports, pTrue } from "../index.ts";
import { listTopFunctions } from "../scan/scan-top-functions.ts";
import { STD_NUDO_SRC } from "./nudo-constraints.ts";

/** 标准约束库 import 行（对象方法 / 局部函数的契约都从它取名） */
const IMP = `/// @nudo:import { positive } from "./std.nudo.js"\n`;
const CONTRACT_POSITIVE = `/** @nudo:contract x positive */\n`;

/** 载入器：`std.nudo` ⇒ 标准库；其余 `.nudo.` 说明符 ⇒ 可选侧车 */
const loadWith = (sidecar?: string) => (spec: string): string | undefined => {
  if (spec.includes("std.nudo")) return STD_NUDO_SRC;
  if (sidecar !== undefined && spec.includes(".nudo.")) return sidecar;
  return undefined;
};

const run = (path: string, src: string, sidecar?: string) =>
  checkSource(path, src, pTrue, { loadModule: loadWith(sidecar), fromFile: path });

const codesOf = (r: ReturnType<typeof run>): string[] => r.issues.map((i) => i.code);

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

  it("同一类的多个实例导出只登记一次（成员名不重复）（BUG-054）", () => {
    const names = listTopFunctions(`class Api {
  run(x) { return x; }
}
export const a = new Api();
export const b = new Api();
`);
    expect(names.filter((n) => n === "Api.run")).toHaveLength(1);
  });

  it("`const C = class {…}`（未导出的类表达式）经 `new` 导出时，实例方法进入口表（BUG-054）", () => {
    const names = listTopFunctions(`const Svc = class {
  run(x) { return x; }
};
export const svc = new Svc();
`);
    expect(names).toContain("Svc.run");
  });

  it("CJS `module.exports = { ...base }` 的展开成员进入口表（BUG-108）", () => {
    const names = listTopFunctions(`const base = { bad(x) { return x; } };
module.exports = { ...base, good() { return 1; } };
`);
    expect(names).toContain("bad");
    expect(names).toContain("good");
  });
});

describe("对象字面量展开的 last-wins / const-only 口径", () => {
  it("spread 之后的同名对象方法覆盖前者：helper 只登记一次（BUG-108）", () => {
    const names = listTopFunctions(`const base = { helper() { return 1; } };
export const api = { ...base, helper() { return 2; } };
`);
    expect(names.filter((n) => n === "helper")).toHaveLength(1);
  });

  it("spread 之后的非可调用覆盖 ⇒ base 的函数不再是入口（BUG-108）", () => {
    const names = listTopFunctions(`const base = { helper() { return 1; }, other() { return 3; } };
export const api = { ...base, helper: 42 };
`);
    expect(names).not.toContain("helper");
    expect(names).toContain("other");
  });

  it("spread 之后的访问器覆盖 ⇒ base 的函数不再是入口（BUG-108）", () => {
    const names = listTopFunctions(`const base = { helper() { return 1; } };
export const api = { ...base, get helper() { return 2; } };
`);
    expect(names).not.toContain("helper");
  });

  it("仅 spread（后方无覆盖）照旧登记 base 成员（BUG-108）", () => {
    expect(
      listTopFunctions(`const base = { helper() { return 1; } };
export const api = { ...base };
`),
    ).toContain("helper");
  });

  it("CJS 导出对象同口径：非可调用覆盖不保活 base 的成员（BUG-108）", () => {
    const names = listTopFunctions(`const base = { helper() { return 1; } };
module.exports = { ...base, helper: 42 };
`);
    expect(names).not.toContain("helper");
  });

  it("`let` 对象的初值不入索引：重赋值的陈旧成员不得登记（BUG-108）", () => {
    const names = listTopFunctions(`let base = { stale() { return 1; } };
base = { fresh() { return 2; } };
export const api = { ...base };
`);
    // 重赋值后的新值不是词法事实（顺序/控制流不可知）⇒ 不猜；旧初值必须消失
    expect(names).not.toContain("stale");
    expect(names).not.toContain("fresh");
  });

  it("`export { api }` 的成员表同样 last-wins / const-only（BUG-108）", () => {
    const overridden = localNamedExports(`const base = { helper() { return 1; } };
const api = { ...base, get helper() { return 2; } };
export { api };
`);
    expect(overridden.has("helper")).toBe(false);
    const reassigned = localNamedExports(`let base = { stale() { return 1; } };
base = { fresh() { return 2; } };
const api = { ...base };
export { api };
`);
    expect(reassigned.has("stale")).toBe(false);
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

describe("调用点别名 / 成员映射的作用域裁决", () => {
  it("`.bind` 别名按词法作用域解析：局部同名遮蔽不借顶层签名（BUG-045）", () => {
    const r = run(
      "/t/bind-shadow.js",
      `export function f(x) { return x; }
export function h() {
  const f = () => 1;
  const g = f.bind(null);
  return g();
}
`,
    );
    expect(codesOf(r)).not.toContain("nudo:arg-count");
    expect(r.issues).toEqual([]);
  });

  it("`.bind` 对照：顶层函数的绑定别名照旧执法（不放宽过头）（BUG-045）", () => {
    const r = run(
      "/t/bind-control.js",
      `${IMP}${CONTRACT_POSITIVE}export function f(x) { return x; }
const g = f.bind(null);
export function h() { return g(-1); }
`,
    );
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "f"),
    ).toBe(true);
  });

  it("局部对象方法与无关顶层函数同名时不借对方签名（BUG-138）", () => {
    const r = run(
      "/t/local-object-method.js",
      `function log(x) { return x; }
export function h() {
  const api = { log() { return 1; } };
  return api.log();
}
`,
    );
    expect(codesOf(r)).not.toContain("nudo:arg-count");
    expect(r.issues).toEqual([]);
  });

  it("导出对象字面量的方法照旧执法（成员映射不被误关）（BUG-138）", () => {
    const r = run(
      "/t/exported-bag.js",
      `${IMP}export const api = {
  ${CONTRACT_POSITIVE.trim()}
  bad(x) { return x; }
};
export function h() { return api.bad(-1); }
`,
    );
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "bad"),
    ).toBe(true);
  });

  it("函数体内 `{ ...base }`：展开源在模块帧也照样搬成员（契约执法）（BUG-108）", () => {
    const r = run(
      "/t/nested-spread.js",
      `${IMP}export const base = {
  ${CONTRACT_POSITIVE.trim()}
  bad(x) { return x; }
};
export function h() {
  const api = { ...base };
  return api.bad(-1);
}
`,
    );
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "bad"),
    ).toBe(true);
  });
});

describe("导出面成员键 / 间接调用形态", () => {
  it("`export { api as default }` 的对象成员键参与侧车绑定（成员契约执法）（BUG-108）", () => {
    const SIDECAR = `export const m = fn({ x: number().gt(0) }, any());\n`;
    const r = run(
      "/t/export-as-default.js",
      `const api = { m(x) { return x; } };
export { api as default };
export function h() { return api.m(-1); }
`,
      SIDECAR,
    );
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "m"),
    ).toBe(true);
  });

  it("CJS `module.exports = { ...base }` 的成员经侧车契约执法（BUG-108）", () => {
    const SIDECAR = `export const m = fn({ x: number().gt(0) }, any());\n`;
    const r = run(
      "/t/cjs-spread.js",
      `const base = { m(x) { return x; } };
module.exports = { ...base };
export function h() { return base.m(-1); }
`,
      SIDECAR,
    );
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "m"),
    ).toBe(true);
  });

  it("`f.call(...xs)`：thisArg 是展开 ⇒ 跳过元数判定（不按 0 实参判红）（BUG-045）", () => {
    const r = run(
      "/t/call-spread.js",
      `${IMP}${CONTRACT_POSITIVE}export function f(x) { return x; }
export function h(xs) { return f.call(...xs); }
`,
    );
    expect(codesOf(r)).not.toContain("nudo:arg-count");
    // 对照：静态 thisArg 的间接调用照旧执法
    const control = run(
      "/t/call-control.js",
      `${IMP}${CONTRACT_POSITIVE}export function f(x) { return x; }
export function h() { return f.call(null, -1); }
`,
    );
    expect(
      control.issues.some((i) => i.code === "nudo:constraint-violated" && i.fn === "f"),
    ).toBe(true);
  });

  it("`f.apply(null, [1,,3])`：空洞按显式 undefined 实参计数（元数 3）（BUG-045）", () => {
    const r = run(
      "/t/apply-holes.js",
      `${IMP}/**
 * @nudo:contract a positive
 * @nudo:contract b positive
 */
export function f(a, b, c) { return [a, b, c]; }
export function h() { return f.apply(null, [1, , 3]); }
`,
    );
    // 第 2 位是空洞 ⇒ 运行时是 undefined ⇒ 违反 b 的契约；元数本身是 3（不是 2）
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && i.fn === "f" && i.message.includes("[b]"),
      ),
    ).toBe(true);
    expect(codesOf(r)).not.toContain("nudo:arg-count");
  });

  it("嵌套对象方法的 `@nudo:case` 不对账外层同名入口（无假红）（BUG-138）", () => {
    const r = run(
      "/t/nested-object-case.js",
      `${IMP}export const api = { other() { return 1; } };
/**
 * @nudo:contract x positive
 */
export function log(x) { return x; }
export function h() {
  const api = {
    /** @nudo:case "nested" (-1) */
    log(x) { return x; }
  };
  return api.log(1);
}
`,
    );
    expect(codesOf(r)).not.toContain("nudo:case-inconsistency");
  });
});
