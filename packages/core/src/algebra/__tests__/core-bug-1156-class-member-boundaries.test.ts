/**
 * Bug 1156 —— 类成员调用点义务的**三条保守边界**（假绿）。
 *
 * 前置事实（本次修复的基准，已用 probe 验证）：
 * - 普通函数面：**未导出的本地函数**带 `@nudo:contract` 时，调用点照常执法
 *   （普查面 `listTopFunctions` 收全部顶层函数）；
 * - 导入面：`import { f }` / `export { f } from` / `export * from` /
 *   `import * as ns; ns.f(…)` 都执法（`default.m` 的具名 default 类同）。
 *
 * 三条边界（修前均为 0 诊断）：
 * - (a) 未导出的本地类：`class L { @nudo:contract m }` 的
 *   `const c = new L(); c.m(-1)` / `new L().m(-1)` / `L.s(-1)` —— 类成员名
 *   此前只有**导出类**进普查面 ⇒ knownFns 闸门挡住 ⇒ 与本地函数规则不一致；
 * - (b) 匿名 `export default class { m(a){} }` 作为 `import K from './lib.js'`
 *   的默认导出 ⇒ 没有本地名 ⇒ 类绑定解析不到（具名 `export default class K`
 *   已可用，本文作为负控制）；
 * - (c) `import * as ns from './lib.js'` 的 `new ns.K().m(-1)` / `ns.K.s(-1)`
 *   ⇒ 命名空间只登记了 `ns.__module__`（普通函数路径），没有类解析。
 *
 * 修法：
 * - (a) `scan-call-graph.localClassMemberNames` 把模块级类（不只导出类）的
 *   own 方法名并入**调用点扫描**的 knownFns（签名普查面不动 ⇒ 签名列表不扩）；
 * - (b) 匿名默认类的绑定名 = 导出槽名 `default`（`default.m` 契约键，与
 *   generalize / 指令 scope 同口径）；`localNamedExports` 同步登记成员键；
 * - (c) `ns.K` 复用 `classBindingOf`（与具名导入同一套类 AST 解析），
 *   命名空间模块按**词法作用域**解析（内层同名遮蔽 ⇒ 不解析）。
 *
 * 守卫（A4 既有口径全部保留）：继承无 own 方法 / 构造器 `this.m = …` /
 * getter-setter / computed / 形参遮蔽 / 重新赋值（**沿作用域链**失效）/
 * static 与实例同名消歧 / 未契约类零诊断。
 *
 * parity（有意保持不执法，不发明更宽义务）：
 * - `export { K as J } from './lib.js'` 的**别名**再导出（普通函数同样不执法：
 *   再导出解析保留的是导出名、定义模块按本地名查契约）；
 * - `import { K } from './lib.js'; export { K }`（普通函数同样不执法）；
 * - `import * as ns from './index.js'`（index 再导出 ⇒ `ns.f` 同样不执法）。
 *   以上有测试钉住（0 诊断），避免后续误扩。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
});

/** 指令契约用的公共约束模块（`/// @nudo:import` 绑定名，不是同名侧车） */
const POS_MODULE = `export const positive = number().gt(0);
`;

const POS_IMPORT = `/// @nudo:import { positive } from "./pos.nudo.js"
`;

/** 导入类的类 + 普通函数（侧车契约绑 K_m / K_s） */
const LIB = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
`;

const LIB_SIDECAR = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
`;

/** 匿名 / 具名 default 类定义（b 切片） */
const ANON_DEFAULT = `${POS_IMPORT}export default class {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
`;

/** 默认虚拟文件集：pos 约束模块 + 导入类三件套 */
function filesOf(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "/t/pos.nudo.js": POS_MODULE,
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDECAR,
    ...extra,
  };
}

function check(
  source: string,
  extra: Record<string, string> = {},
  file = "/t/b1156-main.js",
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

/** 未导出的本地类（指令契约在本文件内；侧车不绑未导出名，与普通函数同口径） */
function localClassSrc(head = ""): string {
  return `${POS_IMPORT}class L {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
${head}`;
}

describe("Bug 1156 —— (a) 未导出的本地类：与本地函数同一条调用点义务", () => {
  it("实例（const c = new L()）：c.m(-1) ⇒ L.m 违例", () => {
    const src = `${localClassSrc("const c = new L();\n")}export function viaConst() { return c.m(-1); }
`;
    const r = check(src, { "/t/local.js": src }, "/t/local.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  });

  it("内联 new：new L().m(-1) ⇒ L.m 违例", () => {
    const src = `${localClassSrc()}export function viaInline() { return new L().m(-1); }
`;
    const r = check(src, { "/t/local-inline.js": src }, "/t/local-inline.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  });

  it("静态：L.s(-1) ⇒ L.s 违例", () => {
    const src = `${localClassSrc()}export function viaStatic() { return L.s(-1); }
`;
    const r = check(src, { "/t/local-static.js": src }, "/t/local-static.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.s")).toHaveLength(1);
  });

  it("合法实参（1 / 5）三种形态都不报（负控制）", () => {
    const src = `${localClassSrc()}const c = new L();
export function use() { c.m(1); new L().m(1); L.s(5); return c; }
`;
    const r = check(src, { "/t/local-ok.js": src }, "/t/local-ok.js");
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("未契约的本地类 ⇒ 零新诊断（不扩面）", () => {
    const src = `class L {
  m(a) { return a; }
  static s(a) { return a; }
}
const c = new L();
export function use() { c.m(-1); new L().m(-1); L.s(-1); return c; }
`;
    const r = check(src, { "/t/local-bare.js": src }, "/t/local-bare.js");
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("本地类方法不进签名普查面（调用点义务 ≠ 签名面扩面）", () => {
    const src = `${localClassSrc()}export function use() { return 1; }
`;
    const r = check(src, { "/t/local-sig.js": src }, "/t/local-sig.js");
    expect(r.signatures.map((s) => s.name)).toEqual(["use"]);
  });

  it("本地类的侧车契约不绑（未导出名）——与未导出本地函数同口径（parity）", () => {
    const src = `class L {
  m(a) { return a; }
}
const c = new L();
export function use() { return c.m(-1); }
`;
    const r = check(
      src,
      {
        "/t/local-sidecar.js": src,
        "/t/local-sidecar.nudo.js": `export const positive = number().gt(0);
export const L_m = fn({ a: positive }, number());
`,
      },
      "/t/local-sidecar.js",
    );
    expect(violated(r)).toEqual([]);
  });

  it("守卫：extends 无 own / 构造器 this.m / getter / computed ⇒ 零诊断", () => {
    const src = `${POS_IMPORT}class Base {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class E1 extends Base {}
class E2 {
  constructor() { this.m = (a) => a; }
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class E3 {
  get m() { return 1; }
}
class E4 {
  ["m"](a) { return a; }
}
const e1 = new E1();
const e2 = new E2();
const e3 = new E3();
export function use() {
  e1.m(-1);
  e2.m(-1);
  return e3.m + new E4().m(-1);
}
`;
    const r = check(src, { "/t/local-guard.js": src }, "/t/local-guard.js");
    expect(violated(r)).toEqual([]);
  });

  it("守卫：形参遮蔽 / 实例重新赋值 / 类名重新赋值 / static↔实例交叉 ⇒ 零诊断", () => {
    const src = `${POS_IMPORT}class G1 {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class G2 {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class G3 {
  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
export function shadowParam(G1) {
  return new G1().m(-1);
}
export function reassignInstance() {
  let c = new G2();
  c = { m: (a) => a };
  return c.m(-1);
}
export function reassignClass() {
  G3 = { s: (a) => a };
  return G3.s(-1);
}
export function cross() {
  G2.m(-1);
  return new G3().s(-1);
}
`;
    const r = check(src, { "/t/local-guard2.js": src }, "/t/local-guard2.js");
    expect(violated(r)).toEqual([]);
  });
});

describe("Bug 1156 —— (b) 匿名 export default class 的成员调用点", () => {
  it("匿名 default 类（指令契约）⇒ default.m 违例", () => {
    const r = check(`import K from "./anon.js";
new K().m(-1);
const c = new K();
c.m(-1);
`, { "/t/anon.js": ANON_DEFAULT });
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "default.m")).toHaveLength(2);
  });

  it("匿名 default 类（侧车 default_m）⇒ default.m 违例", () => {
    const lib = `export default class {
  m(a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const default_m = fn({ a: positive }, number());
`;
    const r = check(
      `import K from "./anon2.js";
new K().m(-1);
`,
      { "/t/anon2.js": lib, "/t/anon2.nudo.js": sidecar },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "default.m")).toHaveLength(1);
  });

  it("匿名 default 类：合法实参不报（负控制）", () => {
    const r = check(`import K from "./anon3.js";
new K().m(1);
const c = new K();
c.m(2);
`, { "/t/anon3.js": ANON_DEFAULT });
    expect(violated(r)).toEqual([]);
  });

  it("匿名 default 类未契约 ⇒ 零诊断（不扩面）", () => {
    const lib = `export default class {
  m(a) { return a; }
}
`;
    const r = check(
      `import K from "./anon4.js";
new K().m(-1);
`,
      { "/t/anon4.js": lib },
    );
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("具名 export default class K 已可用（负控制，不得回归）", () => {
    const lib = `export default class K {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
`;
    const r = check(
      `import K from "./named.js";
new K().m(-1);
`,
      { "/t/named.js": `${POS_IMPORT}${lib}` },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
  });

  it("匿名 default 类的静态成员：K.s(-1) ⇒ default.s 违例", () => {
    const lib = `${POS_IMPORT}export default class {
  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
`;
    const r = check(
      `import K from "./anon-static.js";
K.s(-1);
`,
      { "/t/anon-static.js": lib },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "default.s")).toHaveLength(1);
  });
});

describe("Bug 1156 —— (c) 命名空间导入的类", () => {
  it("new ns.K().m(-1) ⇒ K.m 违例", () => {
    const r = check(`import * as ns from "./lib.js";
new ns.K().m(-1);
const c = new ns.K();
c.m(-1);
`);
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "K.m")).toHaveLength(2);
  });

  it("ns.K.s(-1) ⇒ K.s 违例", () => {
    const r = check(`import * as ns from "./lib.js";
ns.K.s(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  });

  it("命名空间：合法实参不报（负控制）", () => {
    const r = check(`import * as ns from "./lib.js";
new ns.K().m(1);
ns.K.s(5);
const c = new ns.K();
c.m(2);
`);
    expect(violated(r)).toEqual([]);
  });

  it("命名空间名被形参 / 局部 const 遮蔽 ⇒ 零诊断（守卫）", () => {
    const r = check(`import * as ns from "./lib.js";
export function shadowParam(ns) {
  return new ns.K().m(-1);
}
export function shadowLocal() {
  const ns = { K: class { m(a) { return a; } } };
  return new ns.K().m(-1);
}
`);
    expect(violated(r)).toEqual([]);
  });

  it("命名空间类：实例方法不许当静态、静态不许当实例 ⇒ 零诊断（守卫）", () => {
    const r = check(`import * as ns from "./lib.js";
ns.K.m(-1);
new ns.K().s(-1);
const c = new ns.K();
c.s(-1);
`);
    expect(violated(r)).toEqual([]);
  });

  it("require 的模块命名空间同一路径（const m = require）", () => {
    const r = check(`const m = require("./lib.js");
new m.K().m(-1);
m.K.s(-1);
`);
    expect(violated(r)).toHaveLength(2);
  });

  it("命名空间经再导出 index（parity：普通函数 ns.f 也不执法）⇒ 0", () => {
    const r = check(
      `import * as ns from "./idx.js";
new ns.K().m(-1);
ns.K.s(-1);
`,
      {
        "/t/idx.js": `export { K } from "./lib.js";\n`,
        "/t/idx.nudo.js": LIB_SIDECAR,
      },
    );
    expect(violated(r)).toEqual([]);
  });
});

describe("Bug 1156 —— 再导出链：已可用形态不回归 / 未执法形态保持（parity）", () => {
  it("export { K } from：成员调用执法（不回归）", () => {
    const r = check(
      `import { K } from "./idx.js";
new K().m(-1);
K.s(-1);
`,
      { "/t/idx.js": `export { K } from "./lib.js";\n` },
    );
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "K.m")).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  });

  it("export * from：成员调用执法（不回归）", () => {
    const r = check(
      `import { K } from "./idx.js";
new K().m(-1);
K.s(-1);
`,
      { "/t/idx.js": `export * from "./lib.js";\n` },
    );
    expect(violated(r)).toHaveLength(2);
  });

  it("别名再导出 export { K as J } from / import+export ⇒ 0（parity：普通函数同样不执法）", () => {
    const sidecar = LIB_SIDECAR;
    const alias = check(
      `import { J } from "./idx.js";
new J().m(-1);
J.s(-1);
`,
      {
        "/t/idx.js": `export { K as J } from "./lib.js";\n`,
        "/t/idx.nudo.js": sidecar,
      },
    );
    expect(violated(alias)).toEqual([]);
    const reexp = check(
      `import { K } from "./idx2.js";
new K().m(-1);
K.s(-1);
`,
      {
        "/t/idx2.js": `import { K } from "./lib.js";\nexport { K };\n`,
        "/t/idx2.nudo.js": sidecar,
      },
    );
    expect(violated(reexp)).toEqual([]);
  });

  it("再导出环（a ↔ b）终止且零诊断", () => {
    const r = check(
      `import { K } from "./a.js";
new K().m(-1);
import * as ns from "./a.js";
new ns.K().m(-1);
`,
      {
        "/t/a.js": `export { K } from "./b.js";\n`,
        "/t/b.js": `export { K } from "./a.js";\n`,
      },
    );
    expect(violated(r)).toEqual([]);
  });
});
