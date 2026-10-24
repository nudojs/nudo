/**
 * Bug 1154 —— 类成员的参数契约在**导入类实例** / **内联 `new`** / **静态调用**
 * 形态下不执法（假绿）。
 *
 * 复现（`lib.js` 的类方法带侧车契约 `K_m` / `K_s`，`main.js` 导入 K）：
 * - `const c = new K(); c.m(-1)` ⇒ 0 诊断（本地类实例 `c.m(-1)` 已执法）；
 * - `new K().m(-1)`（导入 / 本地都）⇒ 0；
 * - `K.s(-1)`（导入 / 本地都）⇒ 0。
 *
 * 根因：`scan-call-graph.ts` 的实例成员绑定只按 `knownFns` 前缀收**本地**类，
 * 导入类（`externalFn`）不建成员绑定；`resolveCalleeFn` 只认 Identifier
 * 接收者，没有静态（`K.s`）与内联（`new K().m`）路径。
 *
 * 修法：类成员的调用点解析改由**类 AST 事实**驱动（own 实例 / 静态方法），
 * 本地类仍走 `knownFns` 闸门（未导出的类保持零诊断），导入类走外部模块
 * 描述（`checkExternalCall` + 定义文件侧车）。守卫：继承 / 构造器
 * `this.m = …` / getter-setter / computed / 遮蔽 / 重新赋值 / 静态实例交叉
 * 调用一律不解析。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
});

/** 类 + 普通函数（侧车契约绑 K_m / K_s / f） */
const LIB = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
export function f(a) { return a; }
`;

const LIB_SIDECAR = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
export const f = fn({ a: positive }, number());
`;

/** 同文件本地类（导出 ⇒ 进 knownFns 普查面，与 Bug 441 的本地实例路径同闸门） */
const LOCAL = `export class L {
  m(a) { return a; }
  static s(a) { return a; }
}

const c = new L();
c.m(-1);
`;

const LOCAL_SIDECAR = `export const positive = number().gt(0);
export const L_m = fn({ a: positive }, number());
export const L_s = fn({ a: positive }, number());
`;

/** 默认虚拟文件集：lib 三件套 */
function filesOf(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDECAR,
    ...extra,
  };
}

function check(
  source: string,
  extra: Record<string, string> = {},
  file = "/t/b1154-main.js",
) {
  const { loadModule } = makeFiles(filesOf(extra));
  return checkSource(file, source, pTrue, { loadModule, fromFile: file });
}

/** 调用点契约违例（按被调名可过滤） */
function violated(
  r: { issues: Array<{ code: string; fn?: string }> },
  fn?: string,
): Array<{ code: string; fn?: string }> {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (fn === undefined || i.fn === fn),
  );
}

describe("Bug 1154 —— 导入类的成员调用点执法", () => {
  it("导入类实例：const c = new K(); c.m(-1) ⇒ K.m 违例", () => {
    const r = check(`import { K } from "./lib.js";
const c = new K();
c.m(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it("导入类内联：new K().m(-1) ⇒ K.m 违例", () => {
    const r = check(`import { K } from "./lib.js";
new K().m(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
  });

  it("导入类静态：K.s(-1) ⇒ K.s 违例", () => {
    const r = check(`import { K } from "./lib.js";
K.s(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  });

  it("导入类：合法实参（1 / 5）三种形态都不报", () => {
    const r = check(`import { K } from "./lib.js";
const c = new K();
c.m(1);
new K().m(1);
K.s(5);
`);
    expect(violated(r)).toEqual([]);
  });

  it("导入普通函数 f(-1) 既有强制不回归（负控制）", () => {
    const r = check(`import { f } from "./lib.js";
f(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "f")).toHaveLength(1);
  });

  it("导入普通函数 f(5) 不报（负控制）", () => {
    const r = check(`import { f } from "./lib.js";
f(5);
`);
    expect(violated(r)).toEqual([]);
  });
});

describe("Bug 1154 —— 本地类：内联 new / 静态调用补齐（实例路径不回归）", () => {
  it("本地类实例：const c = new L(); c.m(-1) ⇒ L.m（既有路径）", () => {
    const r = check(LOCAL, { "/t/local.js": LOCAL, "/t/local.nudo.js": LOCAL_SIDECAR }, "/t/local.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  });

  it("本地类内联：new L().m(-1) ⇒ L.m", () => {
    const src = `export class L {
  m(a) { return a; }
}
new L().m(-1);
`;
    const r = check(
      src,
      { "/t/local-inline.js": src, "/t/local-inline.nudo.js": LOCAL_SIDECAR },
      "/t/local-inline.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  });

  it("本地类静态：L.s(-1) ⇒ L.s", () => {
    const src = `export class L {
  static s(a) { return a; }
}
L.s(-1);
`;
    const r = check(
      src,
      { "/t/local-static.js": src, "/t/local-static.nudo.js": LOCAL_SIDECAR },
      "/t/local-static.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.s")).toHaveLength(1);
  });

  it("本地类：合法实参（1 / 5）不报（负控制）", () => {
    const src = `export class L {
  m(a) { return a; }
  static s(a) { return a; }
}
const c = new L();
c.m(1);
new L().m(1);
L.s(5);
`;
    const r = check(
      src,
      { "/t/local-ok.js": src, "/t/local-ok.nudo.js": LOCAL_SIDECAR },
      "/t/local-ok.js",
    );
    expect(violated(r)).toEqual([]);
  });
});

describe("Bug 1154 —— 同名静态 / 实例：按 AST 事实区分", () => {
  /** 静态 m 有源码契约；实例 m 无契约（Bug 425 的 scope 名 `C.static.m`） */
  const COLLIDE_LIB = `/// @nudo:import { positive } from "./lib2.nudo.js"
export class C {
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
`;
  const COLLIDE_SIDECAR = `export const positive = number().gt(0);
`;

  const collideFiles = {
    "/t/lib2.js": COLLIDE_LIB,
    "/t/lib2.nudo.js": COLLIDE_SIDECAR,
  };

  it("静态同名调用 C.m(-1) ⇒ 只套静态契约（C.static.m）", () => {
    const r = check(`import { C } from "./lib2.js";
C.m(-1);
`, collideFiles);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "C.static.m")).toHaveLength(1);
  });

  it("实例同名调用（new C().m / const c = new C(); c.m）⇒ 实例无契约，零诊断", () => {
    const r = check(`import { C } from "./lib2.js";
new C().m(-1);
const c = new C();
c.m(-1);
`, collideFiles);
    expect(violated(r)).toEqual([]);
  });

  it("静态同名调用合法实参 C.m(1) 不报（负控制）", () => {
    const r = check(`import { C } from "./lib2.js";
C.m(1);
`, collideFiles);
    expect(violated(r)).toEqual([]);
  });

  it("本地类同名：C.m(-1) 只套静态契约，实例调用零诊断", () => {
    const src = `/// @nudo:import { positive } from "./lib8.nudo.js"
export class C {
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
C.m(-1);
const c = new C();
c.m(-1);
new C().m(-1);
`;
    const r = check(
      src,
      { "/t/lib8.js": src, "/t/lib8.nudo.js": COLLIDE_SIDECAR },
      "/t/lib8.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "C.static.m")).toHaveLength(1);
  });
});

describe("Bug 1154 —— 不确定形态一律不解析（守卫假红）", () => {
  it("extends 且 m 不是 own 方法 ⇒ 零诊断", () => {
    const lib = `export class Base {
  m(a) { return a; }
}
export class K extends Base {}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const Base_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K } from "./lib3.js";
new K().m(-1);
const k = new K();
k.m(-1);
`,
      { "/t/lib3.js": lib, "/t/lib3.nudo.js": sidecar },
    );
    expect(violated(r)).toEqual([]);
  });

  it("构造器 this.m = … 覆盖方法 ⇒ 零诊断", () => {
    const lib = `export class K {
  constructor() { this.m = (a) => a; }
  m(a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K } from "./lib4.js";
new K().m(-1);
const k = new K();
k.m(-1);
`,
      { "/t/lib4.js": lib, "/t/lib4.nudo.js": sidecar },
    );
    expect(violated(r)).toEqual([]);
  });

  it("接收者被遮蔽（形参 / 局部同名）或重新赋值 ⇒ 零诊断", () => {
    const r = check(`import { K } from "./lib.js";
export function shadowParam(K) {
  const c = new K();
  return c.m(-1);
}
export function shadowLocal() {
  const K = { m: (a) => a };
  return K.m(-1);
}
export function reassign() {
  let c = new K();
  c = { m: (a) => a };
  return c.m(-1);
}
`);
    expect(violated(r)).toEqual([]);
  });

  it("静态 / 实例交叉调用（K.m 实例方法 / new K().s 静态方法）⇒ 零诊断", () => {
    const r = check(`import { K } from "./lib.js";
K.m(-1);
new K().s(-1);
const k = new K();
k.s(-1);
`);
    expect(violated(r)).toEqual([]);
  });

  it("getter / computed 成员 ⇒ 零诊断", () => {
    const getterLib = `export class K {
  get m() { return 1; }
}
`;
    const computedLib = `export class K {
  ["m"](a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K as G } from "./lib5.js";
import { K as H } from "./lib6.js";
new G().m(-1);
new H().m(-1);
`,
      {
        "/t/lib5.js": getterLib,
        "/t/lib5.nudo.js": sidecar,
        "/t/lib6.js": computedLib,
        "/t/lib6.nudo.js": sidecar,
      },
    );
    expect(violated(r)).toEqual([]);
  });

  it("未契约的导入类方法 ⇒ 零新诊断（不扩面）", () => {
    const lib = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
`;
    const r = check(
      `import { K } from "./lib7.js";
const c = new K();
c.m(-1);
new K().m(-1);
K.s(-1);
`,
      { "/t/lib7.js": lib },
    );
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
