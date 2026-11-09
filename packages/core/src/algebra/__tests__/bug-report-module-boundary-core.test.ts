/**
 * 缺陷报告分册 06-module-boundary —— 模块边界与导出扫描（core 面回归）。
 *
 * 覆盖：Bug 6（CJS 默认导出形态进 L2 入口表）、Bug 51（同名 static 顶掉实例
 * 方法形参表 / @nudo:assume 锚定面）、Bug 61（`export const C = class {}`）、
 * Bug 64（未导出内部基类的继承方法）、Bug 89（`export { local as public }`
 * 别名说明符 → 导出槽）、Bug 90（ESM 对象字面量方法）、Bug 105（类方法普查
 * 只认 Identifier 键）。
 *
 * core 侧钉的是三张表（localNamedExports / listTopFunctions /
 * listClassEntryNames）、导出槽解析与 check 闸门（签名 + L2 may-throw）。
 * dts 产物面见 service/emit/__tests__/bug-report-module-boundary-dts.test.ts，
 * CLI 四面见 nudojs/src/__tests__/bug-report-module-boundary-cli.test.ts。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check/check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface/interface.ts";
import { parseSource, resetParseSourceCache } from "../parse-source.ts";
import { listTopFunctions, listClassEntryNames } from "../scan/scan-top-functions.ts";
import { localNamedExports } from "../scan/scan-named-exports.ts";
import { resolveExportSlotCall } from "../interface/export-slot.ts";
import { makeFiles, l2Count, sigOf } from "./nudo-constraints.ts";

function run(src: string, file = "/t/mb/k.js", files: Record<string, string> = {}) {
  const { loadModule } = makeFiles(files);
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeInterfaceDiags();
  resetParseSourceCache();
});

// ---------------------------------------------------------------------------
// Bug 6 — CJS 默认导出形态不在 L2 入口表 ⇒ 假绿
// ---------------------------------------------------------------------------
describe("Bug 6 — CJS 默认导出形态进 L2 入口表", () => {
  const ANON_FN = "module.exports = function (user) { return user.name; };\n";
  const NAMED_FN = "module.exports = function getName(user) { return user.name; };\n";
  const CJS_CLASS =
    'module.exports = class C { constructor() { throw new TypeError("boom"); } };\n';
  const COMPUTED = 'exports["getName"] = function (user) { return user.name; };\n';
  const LEGAL = "module.exports = function () { return 1; };\n";

  it("module.exports = <匿名 fn> ⇒ default 进三张表 + L2 判红", () => {
    expect(localNamedExports(ANON_FN).has("default")).toBe(true);
    expect(listTopFunctions(ANON_FN)).toContain("default");
    expect(l2Count(run(ANON_FN, "/t/mb/f1.cjs"), "default")).toBeGreaterThan(0);
  });

  it("module.exports = <具名 fn> ⇒ 保留内层 id（指令面同口径）且签名不塌 unknown", () => {
    expect(listTopFunctions(NAMED_FN)).toContain("getName");
    const exports = localNamedExports(NAMED_FN);
    expect(exports.has("default")).toBe(true);
    expect(exports.has("getName")).toBe(true);
    const r = run(NAMED_FN, "/t/mb/f2.cjs");
    expect(sigOf(r, "getName")).not.toContain("unknown");
    expect(l2Count(r, "getName")).toBeGreaterThan(0);
  });

  it("module.exports = <class> ⇒ 类入口 default + 构造器必抛进 L2", () => {
    expect(listClassEntryNames(CJS_CLASS)).toContain("default");
    expect(localNamedExports(CJS_CLASS).has("default")).toBe(true);
    expect(l2Count(run(CJS_CLASS, "/t/mb/f3.cjs"), "default")).toBeGreaterThan(0);
  });

  it('exports["getName"] 静态字符串计算键 ⇒ 进导出名表 / 普查面 + L2 判红', () => {
    expect(localNamedExports(COMPUTED).has("getName")).toBe(true);
    expect(listTopFunctions(COMPUTED)).toContain("getName");
    expect(l2Count(run(COMPUTED), "getName")).toBeGreaterThan(0);
  });

  it("合法调用不假红（无危险操作的 CJS 默认导出）", () => {
    expect(l2Count(run(LEGAL, "/t/mb/legal.cjs"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 51 — 同名 static 顶掉实例方法形参表与 @nudo:assume 锚定面
// ---------------------------------------------------------------------------
describe("Bug 51 — 同名 static 方法不得顶掉实例方法", () => {
  const INST_FIRST = `export class C {
  m(x) { return "inst"; }
  static m(p, q) { return "stat"; }
}
`;
  const STATIC_FIRST = `export class C {
  static m(p, q) { return "stat"; }
  m(x) { return "inst"; }
}
`;
  const ASSUME = `export class C {
  /** @nudo:assume a <= b */
  m(a, b) { return a < b; }
  static m(p) { return p; }
}
`;

  it("签名顺序无关：两种书写顺序都取实例方法", () => {
    expect(sigOf(run(INST_FIRST), "C.m")).toContain('"inst"');
    expect(sigOf(run(STATIC_FIRST), "C.m")).toContain('"inst"');
  });

  it("形参来自实例方法（不是 static 的 p, q）", () => {
    const params = run(INST_FIRST).signatures.find((s) => s.name === "C.m")?.params ?? [];
    expect(params).toContain("x");
    expect(params).not.toContain("p");
    expect(params).not.toContain("q");
  });

  it("@nudo:assume 锚定到实例方法形参 ⇒ 无 nudo:assume-invalid", () => {
    const r = run(ASSUME);
    expect(r.issues.map((i) => i.code)).not.toContain("nudo:assume-invalid");
    const params = r.signatures.find((s) => s.name === "C.m")?.params ?? [];
    expect(params).toEqual(expect.arrayContaining(["a", "b"]));
    expect(params).not.toContain("p");
  });
});

// ---------------------------------------------------------------------------
// Bug 61 — export const C = class {} 的类表达式
// ---------------------------------------------------------------------------
describe("Bug 61 — 类表达式既不是入口也不是 dts 类", () => {
  const SRC = `export const C = class {
  constructor() { throw new TypeError("boom"); }
};
export const D = class {
  m() { throw new RangeError("r"); }
};
`;

  it("类值 C/D 进 listClassEntryNames，方法 D.m 进函数普查与导出名表", () => {
    expect(listClassEntryNames(SRC)).toEqual(expect.arrayContaining(["C", "D"]));
    expect(listTopFunctions(SRC)).toContain("D.m");
    expect(localNamedExports(SRC).has("D.m")).toBe(true);
  });

  it("构造器必抛与方法必抛都进 L2（不再 OK / 0 fn）", () => {
    const r = run(SRC);
    expect(l2Count(r, "C")).toBeGreaterThan(0);
    expect(l2Count(r, "D.m")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 64 — 未导出的内部基类：继承方法既不是 L2 入口也不进 dts
// ---------------------------------------------------------------------------
describe("Bug 64 — 内部基类继承方法进 L2 与导出名表", () => {
  const SRC = `class Base {
  m() { throw new TypeError("boom"); }
  n() { return 1; }
}
export class Derived extends Base {
  k() { return 2; }
}
`;

  it("Derived.m / Derived.n 进普查面与导出名表", () => {
    const names = listTopFunctions(SRC);
    expect(names).toContain("Derived.m");
    expect(names).toContain("Derived.n");
    expect(localNamedExports(SRC).has("Derived.m")).toBe(true);
  });

  it("Derived.m 的继承必抛事实进 L2，且 own 方法不受影响", () => {
    const r = run(SRC);
    expect(l2Count(r, "Derived.m")).toBeGreaterThan(0);
    expect(sigOf(r, "Derived.m")).toContain("throws TypeError");
    expect(sigOf(r, "Derived.k")).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// Bug 89 — export { local as public } 别名说明符
// ---------------------------------------------------------------------------
describe("Bug 89 — 别名说明符映射到导出槽", () => {
  const CLS_ALIAS = `class C { constructor() { throw new TypeError("ctor"); } m() { return 1; } }
export { C as Other };
`;
  const CLS_DEFAULT = `class C { constructor() { throw new TypeError("ctor"); } m() { return 1; } }
export { C as default };
`;
  const ARROW_ALIAS = 'const f = () => { throw new TypeError("arrow"); };\nexport { f as h };\n';

  it("resolveExportSlotCall：本地名 → 别名导出槽 / default 槽", () => {
    expect(
      resolveExportSlotCall(parseSource(CLS_ALIAS), "C", { Other: {} }),
    ).toEqual({ kind: "named", key: "Other" });
    expect(
      resolveExportSlotCall(parseSource(CLS_DEFAULT), "C", { default: {} }),
    ).toEqual({ kind: "default", key: "default" });
  });

  it("类别名与 as default：构造器必抛进 L2，签名取到真实类值", () => {
    for (const src of [CLS_ALIAS, CLS_DEFAULT]) {
      const r = run(src);
      expect(l2Count(r, "C")).toBeGreaterThan(0);
      expect(sigOf(r, "C")).not.toContain("any =>");
    }
  });

  it("const 箭头别名：may-throw 进 L2，签名不塌 unknown", () => {
    const r = run(ARROW_ALIAS);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    expect(sigOf(r, "f")).not.toContain("unknown");
  });
});

// ---------------------------------------------------------------------------
// Bug 90 — ESM export const api = { m(){} } 对象字面量方法
// ---------------------------------------------------------------------------
describe("Bug 90 — ESM 对象字面量方法与 CJS 同口径", () => {
  const SRC = `export const api = {
  danger() { throw new TypeError("boom"); },
  safe() { return 1; },
};
`;

  it("danger / safe 进普查面、导出名表（不再 0 fn）", () => {
    const names = listTopFunctions(SRC);
    expect(names).toContain("danger");
    expect(names).toContain("safe");
    expect(localNamedExports(SRC).has("danger")).toBe(true);
  });

  it("无条件必抛的 danger 进 L2，合法方法不假红", () => {
    const r = run(SRC);
    expect(l2Count(r, "danger")).toBeGreaterThan(0);
    expect(l2Count(r, "safe")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 105 — 类方法普查只认 Identifier 键
// ---------------------------------------------------------------------------
describe("Bug 105 — 字符串 / 计算 / 数字键方法与 Identifier 键同口径", () => {
  it("static \"make\" / static [\"mk\"] / 7() 都进普查面与导出名表", () => {
    expect(listTopFunctions('export class C { static "make"() { return 1; } }')).toContain(
      "C.make",
    );
    expect(listTopFunctions('export class A { static ["mk"]() { return 1; } }')).toContain(
      "A.mk",
    );
    expect(listTopFunctions("export class V { 7() { return 1; } }")).toContain("V.7");
    expect(localNamedExports("export class V { 7() { return 1; } }").has("V.7")).toBe(true);
  });

  it("必抛的字符串键 static 方法进 L2，签名不塌 unknown", () => {
    const r = run('export class T { static "boom"() { throw new TypeError("boom"); } }');
    expect(l2Count(r, "T.boom")).toBeGreaterThan(0);
    expect(sigOf(r, "T.boom")).toContain("throws TypeError");
  });

  it("侧车契约被真正执法（return \"s\" 违反 number() ⇒ constraint-violated）", () => {
    const SIDECAR = `import { fn, number } from "@nudojs/core";
export const C_make = fn({}, number());
`;
    const r = run(
      'export class C { static "make"() { return "s"; } }',
      "/t/mb/q.js",
      { "/t/mb/q.nudo.js": SIDECAR },
    );
    expect(r.issues.map((i) => i.code)).toContain("nudo:constraint-violated");
  });
});
