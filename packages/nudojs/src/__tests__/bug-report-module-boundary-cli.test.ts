/**
 * 缺陷报告分册 06-module-boundary —— CLI 四面（check / test / export --format dts /
 * contract）端到端回归。
 *
 * 覆盖 9 条缺陷的「修前 OK / 0 fn / No analyzed functions found」→「修后判红 /
 * 有签名 / 有声明」。core 与 dts 面的函数级 / 投影级钉见同名的
 * `bug-report-module-boundary-*.test.ts`（core / service/emit 目录）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 建一个临时工程，返回 file 路径构造函数 */
function fixture(files: Record<string, string>): (name: string) => string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mb-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{"name":"mb","version":"1.0.0","type":"module"}\n');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return (name: string) => join(dir, name);
}

const CJS = {
  "f1.cjs": "module.exports = function (user) { return user.name; };\n",
  "f2.cjs": "module.exports = function getName(user) { return user.name; };\n",
  "f3.cjs":
    'module.exports = class C { constructor() { throw new TypeError("boom"); } };\n',
  "f4.js": 'exports["getName"] = function (user) { return user.name; };\n',
};

describe("Bug 6 — CJS 默认导出形态在 check 面不再假绿", () => {
  it("f1/f2/f3/f4 全部判红（修前 OK / 0 fn）", () => {
    const at = fixture(CJS);
    for (const name of ["f1.cjs", "f2.cjs", "f3.cjs", "f4.js"]) {
      const r = runCliTsx(["check", at(name)]);
      expect(r.status, `${name}: ${r.stdout}`).toBe(1);
      expect(r.stdout).toContain("nudo:entry-may-throw");
    }
  }, 120000);
});

describe("Bug 51 — 同名 static 方法的签名与书写顺序无关", () => {
  const A = `export class C {
  m(x) { return "inst"; }
  static m(p, q) { return "stat"; }
}
`;
  const A2 = `export class C {
  static m(p, q) { return "stat"; }
  m(x) { return "inst"; }
}
`;

  it("两种顺序都打印 C.m(x: any) => \"inst\"（形参/返回同属实例方法）", () => {
    const at = fixture({ "a.js": A, "a2.js": A2 });
    for (const name of ["a.js", "a2.js"]) {
      const r = runCliTsx(["check", at(name)]);
      expect(r.stdout, name).toContain('C.m(x: any) => "inst"');
      expect(r.stdout).not.toContain("C.m(p: any");
    }
  }, 120000);
});

describe("Bug 61 / 64 — 类表达式与内部基类进 L2", () => {
  const CEXPR = `export const C = class {
  constructor() { throw new TypeError("boom"); }
};
export const D = class {
  m() { throw new RangeError("r"); }
};
`;
  const INHERIT = `class Base {
  m() { throw new TypeError("boom"); }
  n() { return 1; }
}
export class Derived extends Base {
  k() { return 2; }
}
`;

  it("类表达式：C 构造器与 D.m 都判红（修前 0 fn / OK）", () => {
    const at = fixture({ "cexpr.js": CEXPR });
    const r = runCliTsx(["check", at("cexpr.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("C() => C  throws TypeError");
    expect(r.stdout).toContain("D.m() => never  throws RangeError");
  }, 120000);

  it("内部基类：Derived.m 的继承必抛进 L2（修前 OK）", () => {
    const at = fixture({ "k.js": INHERIT });
    const r = runCliTsx(["check", at("k.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Derived.m() => never  throws TypeError");
  }, 120000);
});

describe("Bug 89 — 别名说明符导出仍是入口", () => {
  it("export { C as Other } 与 export { f as h } 都判红（修前 OK）", () => {
    const at = fixture({
      "cls-alias.js":
        'class C { constructor() { throw new TypeError("ctor"); } m() { return 1; } }\nexport { C as Other };\n',
      "arrow-alias.js":
        'const f = () => { throw new TypeError("arrow"); };\nexport { f as h };\n',
    });
    for (const name of ["cls-alias.js", "arrow-alias.js"]) {
      const r = runCliTsx(["check", at(name)]);
      expect(r.status, name).toBe(1);
      expect(r.stdout).toContain("nudo:entry-may-throw");
    }
  }, 120000);
});

describe("Bug 90 — ESM 对象字面量方法与 CJS 同口径", () => {
  const ESM = `export const api = {
  danger() { throw new TypeError("boom"); },
  safe() { return 1; },
};
`;

  it("check 判红 + test / contract 都看得到 danger（修前 OK / 0 fn / 无函数）", () => {
    const at = fixture({ "esm-obj.js": ESM });
    const check = runCliTsx(["check", at("esm-obj.js")]);
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("nudo:entry-may-throw");

    const test = runCliTsx(["test", at("esm-obj.js")]);
    expect(test.stdout).toContain("=== danger ===");
    expect(test.stdout).toContain("=== safe ===");

    const contract = runCliTsx(["contract", at("esm-obj.js")]);
    expect(contract.stdout).toContain("danger");
  }, 120000);
});

describe("Bug 62 / 63 — CJS 值导出与解构导出进 dts 面", () => {
  it("CJS 值：四个值声明 + 值-only 模块不空产物", () => {
    const at = fixture({
      "vals.cjs":
        'exports.num = 1;\nexports.str = "s";\nexports.obj = { a: 1 };\nexports.arr = [1, 2];\nexports.fn = function fn(x) { return x; };\n',
      "only.cjs": 'exports.num = 1;\nexports.str = "s";\n',
    });
    const vals = runCliTsx(["export", "--format", "dts", at("vals.cjs")]);
    expect(vals.stdout).toContain("export declare const num: number;");
    expect(vals.stdout).toContain("export declare const str: string;");
    expect(vals.stdout).toContain("export declare const obj: { a: number };");
    expect(vals.stdout).toContain("export declare const arr: number[];");

    const only = runCliTsx(["export", "--format", "dts", at("only.cjs")]);
    expect(only.stdout).not.toContain("No analyzed functions found.");
    expect(only.stdout).toContain("export declare const num: number;");
  }, 120000);

  it("解构：a/b/c/rest 各有声明 + 解构-only 不空产物", () => {
    const at = fixture({
      "d.js": `const src = { a: 1, b: "s" };
export const { a, b } = src;
const arr = [1, 2, 3];
export const [c, ...rest] = arr;
export const plain = 9;
`,
      "only.js": `const src = { a: 1, b: "s" };
export const { a, b } = src;
`,
    });
    const d = runCliTsx(["export", "--format", "dts", at("d.js")]);
    for (const line of [
      "export declare const a: number;",
      "export declare const b: string;",
      "export declare const c: number;",
      "export declare const rest: number[];",
    ]) {
      expect(d.stdout).toContain(line);
    }
    const only = runCliTsx(["export", "--format", "dts", at("only.js")]);
    expect(only.stdout).not.toContain("No analyzed functions found.");
    expect(only.stdout).toContain("export declare const a: number;");
  }, 120000);
});

describe("Bug 105 — 非 Identifier 键的侧车契约被执法", () => {
  it('static "make"() 返回 "s" 违反 number() ⇒ nudo:constraint-violated', () => {
    const at = fixture({
      "q.js": 'export class C { static "make"() { return "s"; } }\n',
      "q.nudo.js":
        'import { fn, number } from "@nudojs/core";\nexport const C_make = fn({}, number());\n',
    });
    const r = runCliTsx(["check", at("q.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nudo:constraint-violated");
    expect(r.stdout).toContain('C.make() => "s"');
  }, 120000);
});
