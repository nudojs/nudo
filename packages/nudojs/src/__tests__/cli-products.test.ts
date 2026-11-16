/**
 * 模块套件：nudojs draft/emit/export/dts 产品面。
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { runCliTsx, runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// export --out 的模块标识与绝对路径无关
// ---------------------------------------------------------------------------
describe("export --out 的模块标识与绝对路径无关", () => {
/**
 * `nudo export --out` 用**绝对源路径**当模块标识 ⇒ 产物重复 +
 * 输出不可复现。
 *
 * 症状：同一份源码放在两个目录里分别导出到同一个 `--out` 目录 ⇒ 第二个模块被
 * 当成「另一个模块」⇒ 多出一份 hash 后缀副本，旧副本遗留；产物首行的
 * `// nudo-export-module:` 还内嵌**构建机绝对路径** ⇒ 同一份源码在不同
 * checkout / 不同机器上产出不同字节。
 *
 * 修法：模块标识改为**与路径无关**的稳定 id（包内 ⇒ `<包名>/<相对包根路径>`；
 * 包外 ⇒ `<stem>|<导出名集合>`），marker 里不再写绝对路径。
 *
 * 钉：
 * - 两个目录下的同一份源码导出后，`--out` 目录里**只有一份**产物（原地覆盖）；
 * - marker 行不含绝对路径（可复现构建）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function clean(x) {\n  return x + 1;\n}\nclean(1);\n";

describe("export --out 的模块标识与绝对路径无关", () => {
  it("同一份源码在两个目录下导出到同一 out 目录 ⇒ 只有一份产物；产物 marker 不含绝对路径（同一源码 ⇒ 同一字节）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-"));
    dirs.push(dir);
    for (const sub of ["A", "B"]) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, "clean.js"), SRC, "utf-8");
    }
    const out = join(dir, "out");

    const a = runCliTsx(["export", join(dir, "A", "clean.js"), "--format", "dts", "--out", out]);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("wrote");
    const b = runCliTsx(["export", join(dir, "B", "clean.js"), "--format", "dts", "--out", out]);
    expect(b.status).toBe(0);

    const products = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 改前：clean.d.ts（A 的遗留副本）+ clean.<hash>.d.ts（B 的新副本）
    expect(products).toEqual(["clean.d.ts"]);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-marker-"));
    dirs.push(dir);
    mkdirSync(join(dir, "A"), { recursive: true });
    mkdirSync(join(dir, "B"), { recursive: true });
    writeFileSync(join(dir, "A", "clean.js"), SRC, "utf-8");
    writeFileSync(join(dir, "B", "clean.js"), SRC, "utf-8");
    const outA = join(dir, "outA");
    const outB = join(dir, "outB");

    expect(runCliTsx(["export", join(dir, "A", "clean.js"), "--format", "dts", "--out", outA]).status).toBe(0);
    expect(runCliTsx(["export", join(dir, "B", "clean.js"), "--format", "dts", "--out", outB]).status).toBe(0);

    const a = readFileSync(join(outA, "clean.d.ts"), "utf-8");
    const b = readFileSync(join(outB, "clean.d.ts"), "utf-8");
    const marker = a.split("\n")[0]!;
    expect(marker).toMatch(/^\/\/ nudo-export-module: clean\|clean$/);
    expect(marker).not.toContain(dir);
    expect(a).toBe(b);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// stdout 不劫持用户导出名
// ---------------------------------------------------------------------------
describe("stdout 不劫持用户导出名", () => {
/**
 * `export --format all` 的 stdout 会**劫持用户自己的导出名**，且与
 * `--out` 产物不一致。
 *
 * 症状：用户模块里有 `fooInput` / `fooOutput`（极常见的命名）时，zod 段生成的
 * `<fn>Input` / `<fn>Output` 先占了去重表 ⇒ dts 段（承载**用户 API**）被改名成
 * `fooInputDts` / `fooOutputDts`，而 `--out` 落盘（各段各占一个文件）不改名 ⇒
 * 同一命令两条投递路径给出**两份不同的公开 API**。
 *
 * 修法：用户 API 名（dts 段 = 模块面）**先预留**；撞名时**工具让位**
 * （zod 段 → `fooInputZod`、standard 段 → `fooInputStandard`）。
 *
 * 钉：stdout 的 dts 段与 `--out` 的 `.d.ts` **逐字相同**（用户 API 不被改名）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = [
  "export function foo(x) { return x; }",
  "export function fooInput(y) { return y; }",
  "export function fooOutput(z) { return z; }",
  "",
].join("\n");

const DTS_DECL = /^export declare function .*$/gm;

describe("stdout 不劫持用户导出名", () => {
  it("用户导出名在 stdout 的 dts 段保持原名（不出现 *Dts 后缀）；stdout 的 dts 段与 --out 落盘的 .d.ts 逐字相同（两条投递路径同一公开 API）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function fooInput(y: unknown): unknown;");
    expect(r.stdout).toContain("export declare function fooOutput(z: unknown): unknown;");
    expect(r.stdout).not.toContain("fooInputDts");
    expect(r.stdout).not.toContain("fooOutputDts");
    // 生成的校验器名让位（不是抢占用户导出名）
    expect(r.stdout).toContain("export const fooInputZod");
    expect(r.stdout).toContain("export const fooInputStandard");
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-parity-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");

    const stdout = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(stdout.status).toBe(0);
    const written = runCliTsx(["export", join(dir, "collide.js"), "--format", "all", "--out", out]);
    expect(written.status).toBe(0);

    const dtsName = readdirSync(out).find((f) => f.endsWith(".d.ts"));
    expect(dtsName).toBeDefined();
    const dts = readFileSync(join(out, dtsName!), "utf-8");

    const fromStdout = stdout.stdout.match(DTS_DECL) ?? [];
    const fromFile = dts.match(DTS_DECL) ?? [];
    expect(fromFile).toHaveLength(3);
    expect([...fromStdout].sort()).toEqual([...fromFile].sort());
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 纯 barrel 也出模块面产物
// ---------------------------------------------------------------------------
describe("纯 barrel 也出模块面产物", () => {
/**
 * 纯 re-export 模块（barrel）`export --format dts` 不产出任何产物。
 *
 * 症状：`export { helper } from "./cjs.js";` 单独成文件时，`functions.length`
 * 为 0 ⇒ 早退发生在**模块面组装之前** ⇒ 再导出被整个丢掉，只打印
 * "No analyzed functions found."；同一个 re-export 放在有本地函数的文件里却
 * 正常产出。
 *
 * 修法：空产物判据改为「**既无本地函数，也无模块面再导出**」，模块面在早退
 * 之前组装。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b033-"));
  dirs.push(dir);
  writeFileSync(join(dir, "cjs.js"), "export function helper(x) {\n  return x;\n}\n", "utf-8");
  writeFileSync(join(dir, "reexp.js"), 'export { helper } from "./cjs.js";\n', "utf-8");
  writeFileSync(
    join(dir, "mix.js"),
    'export { helper } from "./cjs.js";\nexport function own() { return 2; }\n',
    "utf-8",
  );
  return dir;
}

describe("纯 barrel 也出模块面产物", () => {
  it("只有再导出的模块：dts 产出再导出声明（不是「无函数」早退）；负控制：本地函数 + 再导出的模块两条面都在；负控制：真的没有导出面的模块仍如实说明（不静默零产物）", () => {
(() => {

    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "reexp.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
    expect(r.stdout).not.toContain("No analyzed functions found");
  })();
(() => {

    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "mix.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function own(): number;");
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
  })();
(() => {

    const dir = fixture();
    writeFileSync(join(dir, "empty.js"), "const x = 1;\nexport { };\n", "utf-8");
    const r = runCliTsx(["export", join(dir, "empty.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("No ");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// --draft --fn 按导出名匹配（别名导出）
// ---------------------------------------------------------------------------
describe("--draft --fn 按导出名匹配（别名导出）", () => {
/**
 * `nudo contract --draft --fn renamed` 静默产出**空草稿**（exit 0）。
 *
 * 契约身份恒为**导出名**（DESIGN-003），但 `--fn` 过滤把用户的导出名直接与
 * `analysis.functions[].name`（**本地名**）比较、且 CLI 的「一个都没命中」
 * 门禁只比 `entry.fn`（本地名）⇒ 别名导出（`export { localFn as renamed }`）
 * 永远匹配不上 ⇒ 草稿里一条 export 都没有。
 *
 * 修法：过滤与门禁都按**导出名**（`draftIdentity` / `entry.identity`）比较。
 */






const LIB = `function localFn(a) {
  return a + 1;
}
export { localFn as renamed };
export function caller() {
  return localFn(1);
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-040-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  return dir;
}

describe("-draft --fn 按导出名匹配（别名导出）", () => {
  it("--fn renamed ⇒ 草拟出 `export const renamed = fn(`（不再是空草稿）；不回归 BUG-042：名字写错仍是用法错误 + 不落盘", () => {
(() => {

    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--fn", "renamed", "--", "lib.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("matched no export");
    expect(r.stdout).toContain("export const renamed = fn(");
    expect(r.stdout).toContain("(sidecar key: renamed)");
  })();
(() => {

    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--write", "--fn", "totallyMissing", "--", "lib.js"], {
      cwd: dir,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("matched no export");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// nudo contract --draft --fn 未命中 · 不许静默空草稿
// ---------------------------------------------------------------------------
describe("nudo contract --draft --fn 未命中 · 不许静默空草稿", () => {
/**
 * `nudo contract --draft --fn <写错的名字>` 是**静默 no-op**（空草稿 + exit 0）。
 *
 * 改前（`contract-draft.ts`）：`fnNames` 原样传进 `draftContract`，
 * **没有「一个都没命中」的门禁** ⇒ 发射器把全部条目丢弃 ⇒ 落盘一份只有头部的
 * 空草稿、exit 0 ⇒ 名字拼错在 CI / agent 流程里**不可见**；而同一个 `--fn`
 * 名单在 `--emit` 面是**用法错误 + 列出可用导出名**（`contract-emit.ts`）
 * ⇒ 同一命令族两套语义。
 *
 * 钉：`--draft` 面复用 `--emit` 面的规则 —— 名单一处都没命中 ⇒
 * 用法错误（exit 1）、列出可用导出名、**不落盘**；`--json` 面同样是
 * 一份合法 JSON 文档 + exit 1。
 */






const LIB = `function helper(x) {
  return x + 1;
}
export function handwritten(a) {
  return helper(a);
}
export function caller(b) {
  return handwritten(b);
}
caller(2);
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-042-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  return dir;
}

describe("nudo contract --draft --fn 未命中 · 不许静默空草稿", () => {
  it("名字写错 ⇒ 用法错误（exit 1）+ 列出可用导出名 + **不落盘**；--json 面：stdout 仍是**一份合法 JSON 文档**（usage-error 有条目）+ exit 1；对照组：名字正确 ⇒ exit 0 且草稿点名该导出；非导出的本地函数名 ⇒ 仍走**可见**的 not-an-export 条目（门禁不误伤）", () => {
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--draft", "--write", "--fn", "totallyMissing", "--", "lib.js"],
      { cwd: dir },
    );

    // 与 `--emit` 面同款：说清哪个名字没命中 + 列出本地导出名候选
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("matched no export");
    expect(r.stderr).toContain("totallyMissing");
    expect(r.stderr).toContain("available exports");
    expect(r.stderr).toContain("handwritten");
    // 没有谎报成功，也没有落下一份空草稿
    expect(r.stdout).not.toContain("// @nudo:draft");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--draft", "--json", "--fn", "totallyMissing", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as Array<{
      file?: string;
      errors?: Array<{ code?: string; message?: string }>;
    }>;
    expect(Array.isArray(doc)).toBe(true);
    expect(doc[0]?.errors?.[0]?.code).toBe("nudo:usage-error");
    expect(doc[0]?.errors?.[0]?.message).toContain("totallyMissing");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "handwritten", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const handwritten = fn(");
    // 未点名的导出不出现在草稿里（过滤仍然生效）
    expect(r.stdout).not.toContain("export const caller = fn(");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "helper", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not-an-export");
    expect(r.stderr).not.toContain("matched no export");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// CJS `module.exports = { … }` 导出面与 dot 形态同口径
// ---------------------------------------------------------------------------
describe("CJS `module.exports = { … }` 导出面与 dot 形态同口径", () => {
/**
 * CLI 回归：CJS `module.exports = { … }` 形态的导出面三方言。
 *
 * 症状（修前）：同一份 `x + 1`，`module.exports = { h(x) { … } }` 的
 * - dts → `export declare function h(x: unknown): unknown;`（check 面说 `number | string`）
 * - zod → `hOutput = z.unknown()`（接受一切）
 * - guard → `return true;`（校验器空操作 = 假绿）
 * 而对照写法 `module.exports.h = fn` 三方言都正常。
 *
 * 这里钉的是**产物面**（用户实际拿到的校验器），根因与求值面回归见
 * `packages/service/src/__tests__/service-cjs-object-export-member.test.ts`。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const OBJ_LITERAL = `module.exports = {
  h(x) {
    return x + 1;
  },
};
`;

const DOT_ASSIGN = `module.exports.h = function (x) {
  return x + 1;
};
`;

function fixture(): { obj: string; dot: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b045-"));
  dirs.push(dir);
  const obj = join(dir, "obj.js");
  const dot = join(dir, "dot.js");
  writeFileSync(obj, OBJ_LITERAL, "utf-8");
  writeFileSync(dot, DOT_ASSIGN, "utf-8");
  return { obj, dot };
}

describe("CJS `module.exports = { … }` 导出面与 dot 形态同口径", () => {
  it("dts 面：返回位是真类型（不是 unknown），且与 dot 形态逐字一致；zod 面：Output 是联合（不是 `z.unknown()`），且与 dot 形态逐字一致；guard 面：校验器真的校验（不是 `return true;`），且与 dot 形态逐字一致", () => {
(() => {

    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "dts", obj]);
    const d = runCliTsx(["export", "--format", "dts", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).toContain("export declare function h(x: unknown): number | string;");
    expect(o.stdout).not.toContain("): unknown;");
    expect(o.stdout).toBe(d.stdout);
  })();
(() => {

    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "schema", obj]);
    const d = runCliTsx(["export", "--format", "schema", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("hOutput = z.unknown()");
    expect(o.stdout).toContain("z.union([");
    expect(o.stdout).toBe(d.stdout);
  })();
(() => {

    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "guard", obj]);
    const d = runCliTsx(["export", "--format", "guard", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("return true;");
    expect(o.stdout).toContain('typeof data === "number" || typeof data === "string"');
    expect(o.stdout).toBe(d.stdout);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// （CLI）— freeze 不得把违反被调方契约的见证写进被调方
// ---------------------------------------------------------------------------
describe("（CLI）— freeze 不得把违反被调方契约的见证写进被调方", () => {
/**
 * （CLI 面）：`nudo test --freeze` 把**违反被调方契约**的见证写进被调方
 * ⇒ 一个本来绿色的被调方被自己的 freeze 操作冻成红色（`nudo:case-inconsistency`），
 * 且 `--freeze=update` 原样重记 ⇒ 没有自愈路径。
 *
 * 契约：违反被写方**手写契约**的候选见证**不写入**（归因留给调用现场的
 * `nudo:contract-domain-exceeds`）⇒ 固化后 check 仍绿；update 不再重记。
 */






// ⚠ cwd 必须留在 repo 根：tsx 按 **cwd** 找 tsconfig 的 paths 别名；
// cwd 指向临时目录 ⇒ `@nudojs/service/emit` 落回 package.json exports 的
// **dist**（陈旧产物）⇒ 测试验的不是本次源码。路径一律用绝对路径。

function project(): { dir: string; lib: string; usage: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-cli-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:import { positive } from "./tmpl.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x * 2;
}
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "usage.js"),
    `import { needsPositive } from "./lib.js";
needsPositive(5);
needsPositive(-1);
`,
    "utf-8",
  );
  return { dir, lib: join(dir, "lib.js"), usage: join(dir, "usage.js") };
}

describe("（CLI）— freeze 不得把违反被调方契约的见证写进被调方", () => {
  it("违约见证不写入；固化后 check 仍绿（旧行为：check FAILED + exit 1）；--freeze=update 不再重记违约见证（旧行为：原样重记同一条 ⇒ 永远红）", () => {
(() => {

    const { dir, lib, usage } = project();
    try {
      const before = runCliTsx(["check", lib]);
      expect(before.status, before.stdout).toBe(0);

      const freeze = runCliTsx(["test", lib, "--from", usage, "--freeze"]);
      // 退出码不是本条的判据：调用点上确实存在违反契约的实参 ⇒ 分析面如实报
      // `nudo:contract-domain-exceeds`（error 级，口径）⇒ exit 1 是**正确**的。
      // 的判据是「固化不得把该违约搬进被调方」。
      expect(freeze.stdout).toContain("freeze →");
      expect(freeze.stdout).toContain("nudo:contract-domain-exceeds");

      const after = readFileSync(lib, "utf-8");
      expect(after).toContain('@nudo:case "call@usage.js:L2" (5)');
      // 旧行为：`(-1)` 也被写进来 ⇒ 随后 `nudo:case-inconsistency` 判红
      expect(after).not.toContain("call@usage.js:L3");

      const check = runCliTsx(["check", lib]);
      expect(check.stdout, check.stdout).not.toContain("case-inconsistency");
      expect(check.status, check.stdout).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
(() => {

    const { dir, lib, usage } = project();
    try {
      const first = runCliTsx(["test", lib, "--from", usage, "--freeze"]);
      expect(first.stdout).toContain("freeze →");
      const once = readFileSync(lib, "utf-8");
      const upd = runCliTsx(["test", lib, "--from", usage, "--freeze=update"]);
      expect(upd.stdout).toContain("freeze: no changes.");
      expect(upd.stdout).not.toContain("freeze →");
      expect(readFileSync(lib, "utf-8")).toBe(once);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// stdout 平铺面的 default 导出必须是 ambient 合法形态
// ---------------------------------------------------------------------------
describe("stdout 平铺面的 default 导出必须是 ambient 合法形态", () => {
/**
 * `nudo export --format all` 的 stdout 平铺面在模块有 `default`
 * 导出时**不是合法 TS 模块**（TS2391 / TS2390）。
 *
 * dts 生成器写的是 `.d.ts` 上下文：具名导出带 `declare`，但 `default` 导出
 * 写成 `export default function f(…): T;`（无实现、无 `declare`）⇒ 平铺进
 * stdout 这个**普通 `.ts` 模块**就不可编译。`--out` 落盘时各段进 `.d.ts`
 * 文件 ⇒ 合法，缺陷只在 stdout 平铺面。
 *
 * 修复：平铺前改写成 ambient 形态
 * `declare function f(…): T;` + `export { f as default };`（类同理）。
 */






const DEFAULT_FN = `export default function main(x) {
  return x + 1;
}
main(1);
`;

const DEFAULT_CLASS = `export default class Box {
  constructor(v) {
    this.v = v;
  }
  get() {
    return this.v;
  }
}
`;

const NAMED = `export function add(a, b) {
  return a + b;
}
`;

function withProject(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug74-"));
  try {
    for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stdout 平铺面的 default 导出必须是 ambient 合法形态", () => {
  it("default 函数：declare function + `export { main as default }`；default 类：declare class + `export { Box as default }`；单独 --format dts 同样合法（存成 .ts 也可编译）；具名导出保持既有 `export declare function` 形态", () => {
(() => {

    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defexp.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
      // `export default function` 在普通模块里没有实现 ⇒ TS2391
      expect(out).not.toMatch(/^export default function /m);
    });
  })();
(() => {

    withProject({ "defcls.js": DEFAULT_CLASS }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defcls.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare class Box {");
      expect(out).toContain("export { Box as default };");
      expect(out).not.toMatch(/^export default class /m);
    });
  })();
(() => {

    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defexp.js"), "--format", "dts"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
    });
  })();
(() => {

    withProject({ "named.js": NAMED }, (dir) => {
      const out = runCliTsx(["export", join(dir, "named.js"), "--format", "all"]).stdout;
      expect(out).toContain("export declare function add(");
      expect(out).not.toContain("as default");
    });
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// nudo contract --from-dts · 不许静默吞旗标
// ---------------------------------------------------------------------------
describe("nudo contract --from-dts · 不许静默吞旗标", () => {
/**
 * `nudo contract --from-dts` 把 `--emit` / `--fn` / `--all` /
 * `--dry-run` / `--exit-on-diff` **静默吞掉** ⇒ 漂移门禁恒 exit 0（假绿）。
 *
 * 改前（`contract.ts` 的分派）：`--from-dts` 只把 `write` / `dryRun` / `force`
 * 交给 `runContractFromDts`，`opts.emit` / `opts.fn` / `opts.all` **既没转发
 * 也没校验** ⇒ `--from-dts --emit --all --dry-run --exit-on-diff x.d.ts` 与单跑
 * `--from-dts` **逐字节相同**：exit 0、无侧车、无警告 ⇒ 把
 * `nudo contract --emit --dry-run --exit-on-diff` 当漂移门禁的流水线一旦多带
 * 一个 `--from-dts`（或反过来）就**彻底失效且无提示**。
 *
 * 钉（与 `--json` 同一条策略：「不许给了不生效且不报错」）：互斥旗标 ⇒
 * 用法错误（exit 1）+ 点名冲突旗标；`--from-dts` 单独跑仍然出草稿。
 */






const TYPES_DTS = `export declare function addOne(n: number): number;
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-100-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "types.d.ts"), TYPES_DTS, "utf-8");
  return dir;
}

describe("nudo contract --from-dts · 不许静默吞旗标", () => {
  it("--from-dts + --emit/--all/--dry-run/--exit-on-diff ⇒ 用法错误（exit 1）+ 不写侧车；--from-dts + --fn ⇒ 同样用法错误（过滤不许被吞）；对照组：--from-dts 单独跑 ⇒ 仍出草稿（exit 0）；机器面控制组：--from-dts + --emit + --json ⇒ 仍是合法 JSON + exit 1（绝不假绿）", () => {
(() => {

    const dir = makeFixture();

    const r = runCli(
      [
        "contract",
        "--from-dts",
        "--emit",
        "--all",
        "--dry-run",
        "--exit-on-diff",
        "--",
        "types.d.ts",
      ],
      { cwd: dir },
    );

    // 改前：exit 0 + 一份草稿（门禁假绿）；改后：显式拒绝
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from-dts cannot be combined with");
    expect(r.stderr).toContain("--emit");
    expect(r.stderr).toContain("--all");
    // 没有侧车、也没有草稿正文
    expect(existsSync(join(dir, "types.d.nudo.js"))).toBe(false);
    expect(r.stdout).not.toContain("// @nudo:draft");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--fn", "addOne", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from-dts cannot be combined with --fn");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("addOne");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--from-dts", "--emit", "--json", "--", "types.d.ts"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as Array<{
      pathErrors?: Array<{ code?: string; message?: string }>;
    }>;
    expect(doc[0]?.pathErrors?.[0]?.code).toBe("nudo:usage-error");
    // `--json` 与 `--from-dts` 本身互斥（规则 ⑤ 先命中）⇒ 两种拒绝都是用法错误；
    // 关键是 stdout 有一份**可机器读取的理由**，且没有任何草稿/侧车正文。
    expect(doc[0]?.pathErrors?.[0]?.message).toContain("--from-dts");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// nudo contract --emit · 派生分支 vs 主分支 = 净效果
// ---------------------------------------------------------------------------
describe("nudo contract --emit · 派生分支 vs 主分支 = 净效果", () => {
/**
 * `nudo contract --emit` 的**派生分支**与**主分支**各写一次同一侧车
 * 且段格式不一致 ⇒ `--dry-run` 的 diff ≠ 真实写盘 ⇒ `--exit-on-diff` 永久 exit 1。
 *
 * 场景：侧车里既有**手写段**（`tag`），源里又有同名导出 ⇒ 派生分支
 * （`emitDerivedFromRoot`，段是 4 行版，含 `// derived-from:`）先写，
 * 主分支（`emitContract`，段是 3 行版）后写并**整段替换** ⇒ 落盘**净变化 0**
 * （md5 不变），但
 * ① 报告说「Updated … written: wrap,tag」（审计台账被污染）；
 * ② `--dry-run` 打印一份**永不落盘**的 diff（要求加 `// derived-from:` 行）；
 * ③ `--exit-on-diff` 因此**永久 exit 1** ⇒ CI 漂移门禁永远红。
 *
 * 之后的钉法（单写者 + 同源）：
 * - 根侧车由 **CLI** 写（直写分支永远 dry-run；派生分支 `skipWrite` 跳过它）；
 * - 最终文本 = 派生分支在**直写分支产物**之上做的**段级合并**：直写正文优先，
 * `// derived-from:` 标签行**并进去**（不再被随后那次整段重写抹掉）；
 * - 判定 = 落盘内容 vs 写前内容（逐字）⇒ 预览与写盘同源。
 *
 * ⇒ 这里的期望随之改写：
 * ① 首次 `--emit --all` **真的补上**标签行（报告 `Updated` 与文件一致）；
 * ② 第二次逐字不变、不报 `Updated`（收敛）；
 * ③ `--dry-run --exit-on-diff` 首次 exit 1（有净漂移，且 diff 里的标签行
 * 真实写盘会产生）；**收敛后 exit 0**、不打印 diff。
 *
 * ⚠ CLI 子进程的 `@nudojs/service/emit` 解析会按 **cwd** 找 tsconfig：cwd 是
 * 临时夹具 ⇒ 落到 `packages/service/dist/`（可能是旧构建）。夹具里写一份
 * `writeSrcTsconfig` 钉到仓内 src ⇒ 断言不依赖构建新鲜度。
 */






const LIB = `export function wrap(text) {
  return \`(\${text})\`;
}
export function tag(n) {
  return \`#\${n}\`;
}
wrap(42);
tag(7);
`;

/** 手写段（tag）在前，直写分支的生成段（wrap）在后 —— 双写者的命中面 */
const SIDECAR = `import { fn, number } from "@nudojs/core";

// 手写段（tag）：API 表面想强制的契约
export const tag = fn({ n: number().gt(0) }, string());

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:wrap
export const wrap = fn({ text: number() }, string());
`;

/** 收敛态：直写正文 + 派生分支并进来的溯源行（） */
const SIDECAR_CONVERGED = `import { fn, number } from "@nudojs/core";

// 手写段（tag）：API 表面想强制的契约
export const tag = fn({ n: number().gt(0) }, string());

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:wrap
// derived-from: lib.js:tag
// evidence: local
export const wrap = fn({ text: number() }, string());
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-122-"));
  // cwd 是夹具 ⇒ 必须钉住 @nudojs/* 的源码解析（见文件头）
  writeSrcTsconfig(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}

describe("nudo contract --emit · 派生分支 vs 主分支 = 净效果", () => {
  it("首次 --emit --all：标签行真落盘（Updated 与文件一致）；第二次逐字不变（幂等）；--dry-run --exit-on-diff：预览与落盘同源 —— 收敛前 exit 1，收敛后 exit 0；对照组：真有净漂移 ⇒ dry-run 打 diff 且 --exit-on-diff exit 1（门禁没被关掉）", () => {
(() => {

    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");

    const r = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });

    expect(r.status).toBe(0);
    // 派生分支的溯源行**真的落盘**（直写正文 + 标签行），不再被整段覆盖
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR_CONVERGED);
    // 真的变了 ⇒ 报告必须说 Updated（台账与文件一致）
    expect(r.stdout).toContain("Updated");
    expect(r.stdout).toContain("written: wrap");

    // 第二次跑：收敛（不收敛 = 门禁恒红）
    const r2 = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(r2.status).toBe(0);
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR_CONVERGED);
    expect(r2.stdout).toContain("no contract changes");
    expect(r2.stdout).not.toContain("Updated");
  })();
(() => {

    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");

    const r = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });

    // 首次：预览要求加的 `// derived-from:` 行**真实写盘会产生** ⇒ 有净漂移 ⇒ exit 1
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[dry-run] would update lib.nudo.js:");
    expect(r.stdout).toContain("+// derived-from: lib.js:tag");
    // dry-run 不落盘
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR);

    // 真写一次收敛
    const real = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(real.status).toBe(0);
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR_CONVERGED);

    // 收敛后：同一命令 exit 0 且不打印 diff
    const r2 = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    expect(r2.status).toBe(0);
    expect(r2.stdout).not.toContain("would update");
    expect(r2.stdout).toContain("no contract changes");
  })();
(() => {

    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");
    const drifted = SIDECAR.replace("text: number()", "text: lit(9)");
    writeFileSync(sidecar, drifted, "utf-8");

    const r = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });

    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[dry-run] would update lib.nudo.js:");
    expect(r.stdout).toContain("+export const wrap = fn({ text: number() }, string());");
    // 手写段不被触碰
    expect(r.stdout).not.toContain("-export const tag");
    expect(readFileSync(sidecar, "utf-8")).toBe(drifted);
  })();
});; // 2 个 CLI 子进程（tsx 冷启动）

  ; // 3 个 CLI 子进程

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// nudo contract --emit · 同一侧车同一段 = 一个写者
// ---------------------------------------------------------------------------
describe("nudo contract --emit · 同一侧车同一段 = 一个写者", () => {
/**
 * `nudo contract --emit` 的**派生分支**与**直写分支**抢同一侧车的
 * 同一段：两个写者、两种段格式 ⇒
 * ① 派生分支算出的 `// derived-from:` 溯源行**永不落盘**（被直写分支整段覆盖）；
 * ② 落盘字节不变，报告却说「Updated」（台账与文件不符）；
 * ③ `--dry-run` 预览要求加一行**真实写盘从不产生**的行 ⇒ 预览与写盘相反，
 * `--exit-on-diff` 因此**永不收敛**（恒 exit 1 ⇒ CI 漂移门禁永远红）。
 *
 * 钉（单写者 + 同源）：
 * - 根侧车**只有 CLI 一个写者**：直写分支永远 dry-run（只算），派生分支
 * `skipWrite` 跳过该文件；最终文本在 CLI 里一次决定、一次落盘。
 * - 段级合并：直写正文**优先**，派生分支只把 `// derived-from:` 标签行并进去。
 * - 判定 = 落盘内容 vs 写前内容（逐字）⇒ **预览 == 写盘**（字节级）。
 * - 幂等：连跑两次 `--emit --all`，第二次无 `Updated` 且 md5 不变；
 * 收敛后 `--dry-run --exit-on-diff` ⇒ exit 0。
 *
 * 夹具（与 `tmp/repro/` 同形，但测试自建临时目录 ⇒ 不读写 tmp/）：
 * `lib.js` 里 `@nudo:contract` 让 `bar` 成为 root ⇒ 派生推导点名下游导出
 * `foo`（派生段 = `fn({ a: lit(1) }, lit(2))`），而 `foo` 同时被直写分支覆盖
 * （`fn({ a: number() }, number())`）⇒ 同一段两个写者。
 *
 * ⚠ CLI 子进程的 `@nudojs/service/emit` 解析会按 **cwd** 找 tsconfig：cwd 是
 * 临时夹具 ⇒ 落到 `packages/service/dist/`（可能是旧构建，的语义
 * 在 service 源码里）⇒ 夹具里写一份 `writeSrcTsconfig` 钉到仓内 src。
 */







const LIB = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract y positive
 */
export function bar(y) {
  return y * 2;
}
export function foo(a) {
  return a + 1;
}
foo(1);
`;

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

/** 同一段：直写分支的正文（`number()`）+ 派生分支并进来的溯源行 */
const EXPECTED_WRAP = `export const foo = fn({ a: number() }, number());`;

function makeFixture(): { dir: string; sidecar: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-196-"));
  // cwd 是夹具 ⇒ 必须钉住 @nudojs/* 的源码解析（见文件头）
  writeSrcTsconfig(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","private":true}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "std.nudo.js"), STD, "utf-8");
  return { dir, sidecar: join(dir, "lib.nudo.js") };
}

function md5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

/** 取 diff 里的新增行（去掉首列前缀）——用于「预览 == 写盘」字节比对 */
function addedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

describe("nudo contract --emit · 同一侧车同一段 = 一个写者", () => {
  it("两个分支都命中同一导出 ⇒ 直写正文优先 + `derived-from` 标签行真落盘；幂等：连跑两次 --emit --all ⇒ 第二次无 Updated 且 md5 不变；收敛后 --dry-run --exit-on-diff ⇒ exit 0，且不再打印永不落盘的 diff；预览 == 写盘（字节级）：dry-run 的新增行拼起来就是真实写盘内容", () => {
(() => {

    const { dir, sidecar } = makeFixture();

    const r = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(r.status, r.stdout + r.stderr).toBe(0);

    const written = readFileSync(sidecar, "utf-8");
    // 直写分支的正文（`number()`）优先于派生分支的 `lit(1)`
    expect(written).toContain(EXPECTED_WRAP);
    expect(written).not.toContain("lit(1)");
    // 派生分支的溯源行**真的落盘**（旧实现被直写分支整段覆盖 ⇒ 永不出现）
    expect(written).toContain("// derived-from: lib.js:bar");
    // 台账与文件一致：内容真的变了 ⇒ 必须报 Updated
    expect(r.stdout).toContain("Updated");
    expect(r.stdout).toContain("written: foo");
  })();
(() => {

    const { dir, sidecar } = makeFixture();

    const first = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const afterFirst = readFileSync(sidecar, "utf-8");
    const md5First = md5(sidecar);

    const second = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(second.status, second.stdout + second.stderr).toBe(0);

    expect(second.stdout).toContain("no contract changes");
    expect(second.stdout).not.toContain("Updated");
    expect(readFileSync(sidecar, "utf-8")).toBe(afterFirst);
    expect(md5(sidecar)).toBe(md5First);
  })();
(() => {

    const { dir, sidecar } = makeFixture();

    const real = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(real.status, real.stdout + real.stderr).toBe(0);
    const converged = readFileSync(sidecar, "utf-8");

    const dry = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    if (dry.status !== 0) throw new Error(`dry-run status=${dry.status}\n${dry.stdout}${dry.stderr}`);
    expect(dry.stdout).not.toContain("would update");
    expect(dry.stdout).toContain("no contract changes");
    // dry-run 不落盘
    expect(readFileSync(sidecar, "utf-8")).toBe(converged);
  })();
(() => {

    const { dir, sidecar } = makeFixture();
    expect(existsSync(sidecar)).toBe(false);

    const dry = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run"], { cwd: dir });
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain("[dry-run] would update lib.nudo.js:");
    // 预览点名要加的溯源行
    expect(dry.stdout).toContain("+// derived-from: lib.js:bar");
    // 预览不落盘
    expect(existsSync(sidecar)).toBe(false);

    const real = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(real.status, real.stdout + real.stderr).toBe(0);

    // 全新侧车 ⇒ 预览的新增行按序拼起来 == 真实写盘内容（逐字节）
    const previewed = `${addedLines(dry.stdout.replace(/^\[dry-run\][^\n]*\n/, "")).join("\n")}\n`;
    expect(readFileSync(sidecar, "utf-8")).toBe(previewed);
  })();
});; // 1 个 CLI 子进程

  ; // 2 个 CLI 子进程

  ; // 2 个 CLI 子进程

  ; // 2 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// export 不得静默吞掉接口冲突诊断
// ---------------------------------------------------------------------------
describe("export 不得静默吞掉接口冲突诊断", () => {
/**
 * `nudo export` 静默吞掉自己已收集的 `nudo:contract-conflict`。
 *
 * `collectExportDiagnostics` 的阻断判据只看 `severity === "error"`，而
 * `nudo:contract-conflict` 是 **warning** 级；`export.ts` 又只在 `blocking`
 * 时才上屏 ⇒ 已收集的诊断既不打印也不阻断 ⇒ 出货「只编码了一半契约」的产物、
 * stderr 空、exit 0，与同文件 `nudo check` 的结论相反。
 *
 * 钉：阻断判据与 `EXPORT_BLOCKING_CODES` **按码**对齐 ⇒ 该族任一成员都阻断
 * （诊断上屏 + exit 1）。
 */






function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-233-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:import { big } from "./lib.nudo.js"\n/**\n * @nudo:contract n big\n */\nexport function undec(n) {\n  return n;\n}\nundec({ a: 1 });\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.nudo.js"),
    `import { fn, number, shape } from "@nudojs/core";\nexport const big = number().ge(5);\nexport const undec = fn({ n: shape({ a: number() }) });\n`,
    "utf-8",
  );
  return dir;
}

describe("export 不得静默吞掉接口冲突诊断", () => {
  it("warning 级 nudo:contract-conflict ⇒ 阻断（诊断上屏 + exit 1）", () => {
    const dir = makeFixture();
    const r = runCli(["export", "lib.js", "--format", "all"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("contract-conflict");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// TS-only 的模块出口语句必须被剥除（产物是合法 JS）
// ---------------------------------------------------------------------------
describe("TS-only 的模块出口语句必须被剥除（产物是合法 JS）", () => {
/**
 * TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物**根本
 * 不是合法 JS**（`node --check` 报 SyntaxError），而 `migrate verify` 对同一
 * 文件**报 OK / exit 0**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（语句级删除判定补
 * `TSExportAssignment` / `TSNamespaceExportDeclaration`）。本钉是**产物面**
 * 的回归钉：产物必须 `node --check` 过，且不得残留这两条 TS-only 语句。
 *
 * ⚠ 验收口径是「**strip 不产出坏产物**」——`migrate verify` 的契约是「跑
 * `nudo check`」，**不在**族 12 的改动范围（跨族增强须先改文档）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const EXPORT_ASSIGN_TS = `declare namespace N { const x: number; }
export = N;
`;
const NAMESPACE_EXPORT_TS = `export as namespace MyGlobal;
export declare const v: number;
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("TS-only 的模块出口语句必须被剥除（产物是合法 JS）", () => {
  it("`export =` 被剥除 ⇒ 产物 `node --check` 过；`export as namespace` 被剥除 ⇒ 产物 `node --check` 过；兜底闸门认得这两条语句（真源漏网 ⇒ 拒绝写盘 + 点名文件 + exit 1）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "a.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "a.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export =");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "b.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "b.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export as namespace");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  })();
(() => {

    // 判据层断言：闸门对「剥完仍有 TS-only 出口语句」的文件必须报错。
    // 这里用**只读**的探针口径：以 `.ts` 源为输入 ⇒ 若真源漏网，命令层闸门
    // 会拦下（真源修好后不拦 ⇒ 下面的 exit 0 就是「不误伤」）。
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    for (const name of ["a.js", "b.js"]) {
      const check = nodeCheck(join(dir, name));
      expect(check.status, `${name}\n${check.stderr}`).toBe(0);
    }
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// export — @nudo:skip 的函数不被静默丢掉（）
// ---------------------------------------------------------------------------
describe("export — @nudo:skip 的函数不被静默丢掉（）", () => {
/**
 * `@nudo:skip` 的函数被导出入口 filter **静默丢掉**。
 *
 * 根因：`selectExportFunctions` 只放行「有 case 见证」的函数，而 `@nudo:skip`
 * 按设计**不合成** entry@ 见证（零 case）⇒ skip 函数永远进不了导出面 ⇒
 * 导出面少一块，且 dts 生成器专为 skip 建的 `contractOnlySignature` 路径永不可达。
 *
 * 钉：skip 函数（带契约）必须出现在四个产物面里。
 */






/** 带 `@nudo:skip` + 参数契约的导出函数（约束名走 `@nudo:import` 绑定）。 */
function writeSkipFixture(dir: string): void {
  writeFileSync(
    join(dir, "std.nudo.js"),
    `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "skipped.js"),
    `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:skip
 * @nudo:contract a positive
 */
export function skipped(a) {
  throw new Error("unreachable");
}
`,
    "utf-8",
  );
}

describe("export — @nudo:skip 的函数不被静默丢掉（）", () => {
  it("skip 函数进导出面（zod / standard / dts / guard 四面都有）；skip 函数在 --out 落盘面同样有产物（四个文件都在）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-"));
    writeSkipFixture(dir);

    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 面：skip 函数的入参校验器在（契约面 a: number > 0）
    expect(r.stdout).toContain("skippedInput");
    // standard 面：skip 函数的参数位在
    expect(r.stdout).toContain("skipped_a");
    // guard 面：skip 函数的块在（无 case ⇒ 无守卫函数，但块本身不被丢掉）
    expect(r.stdout).toContain("// === skipped Type Guards ===");
    // dts 面：skip 函数的声明在（走 contractOnlySignature 路径）
    expect(r.stdout).toMatch(/export declare function skipped\(/);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-out-"));
    writeSkipFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out);
    // schema / standard / guard / dts —— skip 函数不再让任何一面缺席
    expect(files.some((f) => f.includes("schema"))).toBe(true);
    expect(files.some((f) => f.includes("standard"))).toBe(true);
    expect(files.some((f) => f.includes("guard"))).toBe(true);
    expect(files.some((f) => f.endsWith(".d.ts"))).toBe(true);
    const std = files.find((f) => f.includes("standard"));
    expect(std).toBeDefined();
    expect(readFileSync(join(out, std!), "utf-8")).toContain("skipped_a");
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// nudo export --out · 不覆盖手写产物
// ---------------------------------------------------------------------------
describe("nudo export --out · 不覆盖手写产物", () => {
/**
 * `nudo export --out` **静默覆盖手写的 `.d.ts`** ⇒ 类型精度倒退，
 * exit 0、零提示。
 *
 * 钉：目标已存在且**不是本工具生成的** ⇒ 拒绝覆盖（exit 1 + 可诊断的
 * `nudo:path-io` 面），手写文件逐字不变。
 */






const HANDWRITTEN = "export declare function add(a: number, b: number): number;\n";

describe("nudo export --out · 不覆盖手写产物", () => {
  it("手写 .d.ts 在 out 目录里 ⇒ 拒绝覆盖 + exit 1 + 文件逐字不变；本工具自己生成的产物 ⇒ 允许覆盖更新（同模块重导）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-617-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function add(a, b) {\n  return a + b;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    const target = join(out, "lib.d.ts");
    writeFileSync(target, HANDWRITTEN, "utf-8");

    const r = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(r.status).toBe(1);
    // 手写文件逐字不变（类型精度没被替换成 unknown）
    expect(readFileSync(target, "utf-8")).toBe(HANDWRITTEN);
    // 诊断面可读：说清「不是本工具生成的」
    expect(r.stderr).toContain("was not generated by nudo export");
    expect(r.stderr).toContain("lib.d.ts");
    expect(r.stderr).toContain("fix:");
    // 没有谎报成功
    expect(r.stdout).not.toContain("wrote ");
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-617b-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function add(a, b) {\n  return a + b;\n}\n", "utf-8");
    const out = join(dir, "out");

    const first = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(first.status).toBe(0);
    const body = readFileSync(join(out, "lib.d.ts"), "utf-8");
    const second = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(second.status).toBe(0);
    expect(readFileSync(join(out, "lib.d.ts"), "utf-8")).toBe(body);
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 2 个顺序 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// export — 四个产物面共用导出面闸门（）
// ---------------------------------------------------------------------------
describe("export — 四个产物面共用导出面闸门（）", () => {
/**
 * 四个产物面「哪些函数算公开」有**四套口径**：dts 面按模块导出面
 * 裁剪，zod / standard / guard 三面**不裁剪** ⇒ 源模块**一个导出都没有**时，
 * 三个运行时校验器产物照样产出（内部实现被当成公开契约），`.d.ts` 却静默缺席。
 *
 * 根因：`onExportFace` 这道**模块公开面**闸门只装在 dts 分支上。
 *
 * 钉：导出面过滤下沉到循环入口 ⇒ 四个面共用一道闸门（内部函数不进任何一面）。
 */






/** 只有一个**非导出**函数的模块（的原始夹具形状）。 */
function writeInternalOnlyFixture(dir: string): void {
  writeFileSync(
    join(dir, "lib.js"),
    `/** @nudo:case "c1" (1) => 2 */
function internal(x) {
  return x + 1;
}
`,
    "utf-8",
  );
}

describe("export — 四个产物面共用导出面闸门（）", () => {
  it("非导出函数不进 zod / standard / guard 三面（stdout 面）；非导出函数不进任何落盘产物（--out 面）；导出面函数照常进四（闸门不误伤公开面）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-"));
    writeInternalOnlyFixture(dir);

    const r = runCli(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // 内部函数不得出现在任何产物面
    expect(r.stdout).not.toContain("internalInput");
    expect(r.stdout).not.toContain("internalOutput");
    expect(r.stdout).not.toContain("internal_x");
    expect(r.stdout).not.toContain("isinternalOutput");
    // 零产物如实说明（不是静默零产物）
    expect(r.stdout).toContain("No exported declarations found");
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-out-"));
    writeInternalOnlyFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "lib.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No exported declarations found");
    // 目录里没有任何产物文件（四个面一致缺席）
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-keep-"));
    writeFileSync(
      join(dir, "pub.js"),
      `/** @nudo:case "c1" (1) => 2 */
export function public1(x) {
  return x + 1;
}
`,
      "utf-8",
    );

    const r = runCli(["export", join(dir, "pub.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("public1Input");
    expect(r.stdout).toContain("public1_x");
    expect(r.stdout).toContain("ispublic1Output");
    expect(r.stdout).toContain("export declare function public1");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// nudo contract --emit --fn 未命中 · 过滤器不降级
// ---------------------------------------------------------------------------
describe("nudo contract --emit --fn 未命中 · 过滤器不降级", () => {
/**
 * `nudo contract --emit --fn <拼错的名字>` **静默丢弃过滤器**。
 *
 * 改前（`runContractEmit`）：`--fn` 名单经 `localNamedExports` 过滤后，
 * **命中数为 0 时把过滤结果整段降级成 `undefined`** ⇒ 发射器收不到任何
 * `fnNames` ⇒ 作用域从「只写这一个」静默放大成「刷新全部既有 `@generated` 段」
 * （叠加 `--all` 时放大成「新建全部导出段」）⇒ **写盘**、exit 0、零告警。
 *
 * 钉（族 20 · 片 C）：
 * ① **全部未命中** ⇒ 当**用法错误**：列出本地导出名候选、**exit 1**、**不写盘**
 * （侧车逐字不变 ⇒ 作用域没有被放大）；
 * ② **部分命中** ⇒ 未命中的名字**原样**传给发射器 ⇒ 走发射器**已存在**的
 * `skipped <fn> (not-an-export)` 通道（与 LSP / agent 面同款文案）；
 * ③ 对照组：名字正确时**只**改那一个（作用域没被放大）。
 *
 * ⚠ **口径变更后的重钉**（对照组里的 alpha 段）：调用点**点观测**不再
 * 直接成为字面量契约 —— 先 `widenObservationAbs` 再 `joinThenProject` ⇒ 一次
 * 调用 `alpha({ x: 5 })` 折出 `shape({ x: number() })` / `number()`，而不是
 * `shape({ x: lit(5) })` / `lit(5)`。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

/** 夹具：lib.js + 调用点 usage.js（域证据）+ 已有生成段的 lib.nudo.js */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-657-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}

describe("nudo contract --emit --fn 未命中 · 过滤器不降级", () => {
  it("全部未命中 ⇒ 用法错误（exit 1）+ 列出候选 + **侧车逐字不变**；未命中 ⇒ 连 dry-run 预览都不给（不产生放大作用域的 diff）；部分命中 ⇒ 未命中的名字走 `skipped <fn> (not-an-export)` 通道（与 LSP/agent 同构）；对照组：名字正确 ⇒ 只改那一个（beta 的段不被刷新）", () => {
(() => {

    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");

    const r = runCli(
      ["contract", "--emit", "--fn", "alhpa", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    // 用法错误面：exit 1 + 说清哪个名字没命中 + 列出本地导出名候选
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("alhpa");
    expect(r.stderr).toContain("available exports");
    expect(r.stderr).toContain("alpha");
    expect(r.stderr).toContain("beta");
    // 没有谎报成功，也没有偷偷写盘
    expect(r.stdout).not.toContain("written:");
    expect(r.stdout).not.toContain("Updated");
    // 侧车逐字不变（作用域没被放大成「刷新全部既有生成段」）
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR);
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--fn", "alhpa", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("would update");
    expect(r.stdout).not.toContain("+export const beta");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      [
        "contract",
        "--emit",
        "--fn",
        "alpha",
        "--fn",
        "nope",
        "--dry-run",
        "--from",
        "usage.js",
        "--",
        "lib.js",
      ],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("skipped nope (not-an-export)");
    // 命中的那个照常处理（只改 alpha）
    expect(r.stdout).toContain("would update lib.nudo.js");
    expect(r.stdout).not.toContain("-export const beta");
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--fn", "alpha", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    // 调用点**点观测**不再直接成为字面量契约 —— 先 `widenObservationAbs`
    // 再 `joinThenProject` ⇒ 一次调用 `alpha({ x: 5 })` 折出
    // `shape({ x: number() })` / `number()`（不是 `lit(5)`）。
    expect(r.stdout).toContain("+export const alpha = fn({ p: shape({ x: number() }) }, number());");
    // beta 的生成段**不在**改动面里（只作为 diff 上下文出现）
    expect(r.stdout).not.toContain("-export const beta");
    expect(r.stdout).not.toContain("+export const beta");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）
// ---------------------------------------------------------------------------
describe("contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）", () => {
/**
 * `nudo contract <目录> --draft --json` 的 stdout 是 **N 份 JSON 拼接**
 * （`JSON.parse` 抛 "Unexpected non-whitespace character after JSON"）。
 *
 * 根因：JSON 出口是**单文档**（每个 root 一次 `console.log`），而命令层对每个
 * root 各跑一次 ⇒ **没有跨文件聚合层**。
 *
 * 修法（族 20 · 片 A）：命令层加**跨文件聚合层** ⇒ 收集所有 root 的机器文档后
 * **一次**打印；**单文件也走同一路径** ⇒ 顶层恒为**数组**（单文件 = 单元素数组）。
 *
 * ⚠ 本钉同时锁住 **print 分支**（`nudo contract --json <目录>`）：改前它同样
 * 是多份 JSON 拼接（报告标题只写了 `--draft --json`，实测 print 分支也拼）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  entries?: { fn: string }[];
  draftPath?: string;
  draftSource?: string;
  diff?: string;
};

describe("contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）", () => {
  it("目录 + --draft --json：stdout 可被 JSON.parse 解析（改前抛）；目录 + --json（print 分支）：同样是一份 JSON 数组（改前是多份拼接）；单文件 + --json：顶层仍是数组（单元素）⇒ 形态恒定；单文件 + --draft --json：顶层仍是数组（单元素）⇒ 形态恒定；非 --json 面不受影响（人类面仍是逐文件文本，不是 JSON）", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    let parsed: JsonEntry[];
    expect(() => {
      parsed = JSON.parse(r.stdout) as JsonEntry[];
    }).not.toThrow();
    const docs = parsed!;
    // 顶层恒为数组（形态恒定）
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    for (const d of docs) {
      expect(typeof d.draftSource).toBe("string");
      expect(typeof d.draftPath).toBe("string");
      expect(typeof d.diff).toBe("string");
      expect(Array.isArray(d.entries)).toBe(true);
    }
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", ".", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    expect(docs.map((d) => d.entries?.map((e) => e.fn)).flat().sort()).toEqual(["one", "two"]);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "a.js", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].entries?.map((e) => e.fn)).toEqual(["one"]);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "a.js", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].draftSource).toContain("// @nudo:draft");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "."], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("one");
    expect(() => JSON.parse(r.stdout)).toThrow();
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// --from-dts 不得绕过用法校验（先校验、后分派）
// ---------------------------------------------------------------------------
describe("--from-dts 不得绕过用法校验（先校验、后分派）", () => {
/**
 * `nudo contract --from-dts` 在**所有用法校验之前**短路
 * ⇒ `--emit` / `--draft` / `--json` 被静默吞掉。
 *
 * 改前：`--from-dts … --emit --draft` **不报**互斥错误、exit 0、直接出 draft 正文；
 * `--from-dts … --json` 的 stdout 是 draft 文本、**不是** JSON、exit 0。
 *
 * 修法（族 20 · 片 A）：`--from-dts` **不早退** ⇒ 与其它模式共用同一套
 * 「先校验、后分派」的顺序（互斥 / `--write` 需要草稿模式 / `--exit-on-diff`
 * 的前置条件 / `--json` 与 `--from-dts` 互斥）。
 *
 * ⚠ `--write` + `--from-dts` 是**合法**组合（help 与 cli-reference 的口径都是
 * 「With --draft / --from-dts」）⇒ 校验按**模式**判定，不误伤。
 */






let dir: string;
let dts: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("-from-dts 不得绕过用法校验（先校验、后分派）", () => {
  it("--from-dts + --emit --draft：报互斥错误 + exit 1（改前：静默出 draft、exit 0）；--from-dts + --exit-on-diff：报前置条件错误 + exit 1（改前：静默忽略、exit 0）；--from-dts + --json：显式拒绝（机器面拿不到 JSON ⇒ 不是静默吞旗标）；控制组：--from-dts（无旗标）仍然照常出 draft 正文 + exit 0（不误伤）；控制组：--from-dts + --", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--emit", "--draft"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
    // 不得产出 draft 正文（分派在校验之后 ⇒ 根本没跑）
    expect(r.stdout).not.toContain("// @nudo:draft");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--exit-on-diff"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--exit-on-diff requires --emit --dry-run");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**机器可读**的拒绝信封（不是 draft 文本）
    const docs = JSON.parse(r.stdout) as { pathErrors?: { code: string; message: string }[] }[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].pathErrors?.[0]?.message).toContain("--json cannot be combined with --from-dts");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("export const mul = fn({ a: number(), b: number() }, number());");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--write"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("wrote");
    // ⚠ 族 20 · （片 C）起：草稿落点是**贴着源 `.d.ts`**的
    // `sidecarDraftPath` 口径，**不再**是以 CWD 为基准的
    // `types.nudo.draft.js`（那会静默覆盖同基名的另一个文件的草稿）。
    // ⚠ 落点名的 `.d.` 段按 （`tmp/bug-report/sections/.md`
    // + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
    // **不得含 `.d.`**（basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒
    // 草稿与它建议的复制落点都过不了 `tsc --strict`，TS1254）⇒
    // `types.d.ts` ⇒ `types.nudo.draft.ts`（**不是** `types.d.nudo.draft.ts`）。
    // 用例意图不变：「--from-dts + --write」是合法组合，不被用法校验误伤。
    expect(existsSync(join(dir, "types.nudo.draft.ts"))).toBe(true);
    expect(existsSync(join(dir, "types.nudo.draft.js"))).toBe(false);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const lib = join(dir, "lib.js");
    writeFileSync(lib, "export function f() { return 1; }\n", "utf-8");
    const r = runCli(["contract", "--emit", "--draft", lib], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// contract --draft --write --dry-run 必须打 unified diff
// ---------------------------------------------------------------------------
describe("contract --draft --write --dry-run 必须打 unified diff", () => {
/**
 * `nudo contract --draft --write --dry-run` **不打 unified diff**
 * （只打一行「[dry-run] would write → …」），而 CLI Reference 承诺
 * `--dry-run` = "Print a unified diff instead of writing"
 * （`packages/website/docs/api/cli-reference.md` 的 contract 选项表）。
 *
 * 根因：unified diff 的生成器**只接在 `--emit` 分支**上 ⇒ 同一个 `--dry-run`
 * 旗标在 `--emit` 与 `--draft` 两条分支上**语义不同**。
 *
 * 修法（族 20 · 片 B）：`--draft` 分支的 `--dry-run` **复用 `--emit` 分支的
 * 同一个 diff 生成器**（`unifiedDiff` 已在 `@nudojs/service/emit`
 * ⇒ 零新增导出、两侧共用同一实现，不另写一份）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里（cwd = 临时目录）⇒ 绝不往仓里写文件。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("contract --draft --write --dry-run 必须打 unified diff", () => {
  it("dry-run 打 unified diff（--- a/ + ++ b/ + @@ hunk）且**不写盘**；负控制：非 dry-run 的 `--draft --write` 仍然写盘，且**不打** diff；diff 头与 `--emit --dry-run` 的头**同款**（同一个 unifiedDiff 生成器）", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "--dry-run", "calc.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    // diff 头（与 `--emit --dry-run` 同一个生成器 ⇒ 同款头）
    expect(r.stdout).toContain("--- a/calc.nudo.draft.js");
    expect(r.stdout).toContain("+++ b/calc.nudo.draft.js");
    // 真正的 hunk（不是只有一行路径提示）
    expect(r.stdout).toMatch(/^@@ /m);
    expect(r.stdout).toContain("+export const calc = fn({});");
    // dry-run **不写盘**
    expect(existsSync(join(dir, "calc.nudo.draft.js"))).toBe(false);
    // 改前：stdout 只有「[dry-run] would write → …」，**没有** diff
    expect(r.stdout).toContain("[dry-run] would write → calc.nudo.draft.js");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "calc.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Draft written → calc.nudo.draft.js");
    expect(r.stdout).not.toContain("--- a/");
    expect(existsSync(join(dir, "calc.nudo.draft.js"))).toBe(true);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    // `--emit --dry-run` 的对照面：既有 `@generated` 侧车 + 改了返回值的源
    // ⇒ 发射器算出「侧车会变」⇒ 打出 diff 头。
    writeFileSync(
      join(dir, "lib.nudo.js"),
      "// @generated by nudo — do not edit; regenerate with `nudo contract --emit`\n// source: lib.js:one\nexport const one = fn({  }, lit(1));\n",
      "utf-8",
    );
    writeFileSync(join(dir, "lib.js"), "export function one() {\n  return 2;\n}\n", "utf-8");

    const emit = runCli(["contract", "--emit", "--dry-run", "lib.js"], { cwd: dir });
    const draft = runCli(["contract", "--draft", "--write", "--dry-run", "calc.js"], { cwd: dir });

    expect(emit.status).toBe(0);
    expect(draft.status).toBe(0);
    // 两条分支的 diff 头**同形**（`--- a/<path>` / `+++ b/<path>`）
    const headOf = (s: string): string[] =>
      s.split("\n").filter((l) => l.startsWith("--- a/") || l.startsWith("+++ b/"));
    expect(headOf(emit.stdout)).toEqual(["--- a/lib.nudo.js", "+++ b/lib.nudo.js"]);
    expect(headOf(draft.stdout)).toEqual([
      "--- a/calc.nudo.draft.js",
      "+++ b/calc.nudo.draft.js",
    ]);
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 2 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// nudo contract --emit --dry-run · 预览标签取侧车
// ---------------------------------------------------------------------------
describe("nudo contract --emit --dry-run · 预览标签取侧车", () => {
/**
 * `nudo contract --emit --dry-run` 的**预览标签点名源文件**，
 * 而 **diff 的目标是侧车** ⇒ 工具声称「会更新 `lib.js`」，实际只会改
 * `lib.nudo.js`；同文件另两分支（派生分支 / 写盘分支）都取**侧车** ⇒
 * **单点笔误**，不是取舍。
 *
 * 钉（族 20 · 片 C）：dry-run 预览标签取**侧车路径**
 * （`result.sidecarPath`），与 diff 头、与另两分支**同口径**。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-662-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}

describe("nudo contract --emit --dry-run · 预览标签取侧车", () => {
  it("dry-run 标签点名**侧车**（与 diff 头同口径），不再点名源文件", () => {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    // 标签 = 侧车
    expect(r.stdout).toContain("[dry-run] would update lib.nudo.js:");
    // 不再是源文件（标签与 diff 头指向两个不同文件的笔误已消）
    expect(r.stdout).not.toContain("would update lib.js:");
    // diff 头本来就指侧车 ⇒ 标签与 diff 头现在一致
    expect(r.stdout).toContain("--- a/lib.nudo.js");
    expect(r.stdout).toContain("+++ b/lib.nudo.js");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// contract --draft --json --write 必须**显式拒绝**
// ---------------------------------------------------------------------------
describe("contract --draft --json --write 必须**显式拒绝**", () => {
/**
 * `nudo contract --draft --json --write`：`--write` 被**静默丢弃**
 * ⇒ 草稿**根本没落盘**、**exit 0**、**零提示**（stdout 是合法 JSON、无
 * 「Draft written」）⇒ agent / CI 据此认为「契约已落盘」，磁盘上**没有**
 * 侧车草稿 ⇒ **假绿 + 静默数据丢失**。
 *
 * 根因：`--json` 分支以 `return` 早退 ⇒ 后面的 `--write` 分支**不可达**；
 * 而 `--json` 与 `--write` 都是 `--draft` 的合法搭配，**没有**互斥拒绝。
 *
 * 修法（族 20 · 片 B · 裁决 = **显式拒绝**）：`--json` 与 `--write` 互斥
 * ⇒ `error: --write cannot be combined with --json` + **exit 1**
 * ⇒ 「给了不生效且不报错」不再可能。
 *
 * ⚠ 机器面（`--json`）：stdout 仍是**一份合法 JSON 文档**（命令层的跨文件
 * 聚合层会把它收进恒定数组外壳）⇒ 载荷形状与命令层的 per-root 失败条目
 * 同款（`{file, errors:[{code, message}]}`）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里（cwd = 临时目录）⇒ 绝不往仓里写文件。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string; suggestion?: string }[];
};

/**
 * 取「第一个 root 的机器文档」。
 *
 * 命令层的跨文件聚合层（族 20 · 片 A）让顶层**恒为数组**（单文件 = 单元素
 * 数组）；聚合层落地前的旧形态是**单文档**（顶层就是对象）⇒ 这里两种都吃，
 * 免得负控制用例被聚合层的形态变化误伤。
 */
function firstDoc(stdout: string): JsonEntry {
  const parsed = JSON.parse(stdout) as JsonEntry | JsonEntry[];
  return Array.isArray(parsed) ? (parsed[0] as JsonEntry) : parsed;
}

describe("contract --draft --json --write 必须**显式拒绝**", () => {
  it("--json + --write：exit 1 + 机器面给出理由 + 草稿**没有**落盘；负控制：`--draft --json`（无 --write）仍然照常出审阅载荷（不误伤）；负控制：`--draft --write`（无 --json）仍然照常写盘（不误伤）", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--json", "--write", "lib.js"], { cwd: dir });

    // 改前：exit 0、stdout 是合法 JSON、**草稿文件不存在**、零提示
    expect(r.status).toBe(1);
    // stdout 仍是**一份**合法 JSON（聚合层的外壳：恒为数组）
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("lib.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].errors?.[0]?.message).toContain("--write cannot be combined with --json");
    // 假绿 / 静默数据丢失已消：草稿**没有**被写出来
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
    expect(r.stdout).not.toContain("Draft written");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--json", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    const doc = firstDoc(r.stdout);
    expect(doc.draftSource).toContain("// @nudo:draft");
    expect(doc.errors).toBeUndefined();
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Draft written → lib.nudo.draft.js");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// contract --json 遇语法错文件：失败 root 必须进载荷
// ---------------------------------------------------------------------------
describe("contract --json 遇语法错文件：失败 root 必须进载荷", () => {
/**
 * `nudo contract --draft --json` 遇**语法错文件**：
 * 单文件 ⇒ stdout **0 字节** + exit 1（违反同文件里自己写下的「绝不空 stdout +
 * exit 1」不变量）；多文件 ⇒ stdout 是一份**只含好文件**的合法 JSON，
 * **失败文件在载荷里彻底消失** ⇒ 机器消费者无法从 JSON 知道哪个文件失败。
 *
 * 修法（族 20 · 片 A）：per-root `catch` 在 `--json` 形态下**必须产 JSON body**
 * ⇒ 失败 root 进聚合结果的 `errors[]`（聚合层见 ）⇒ stdout 永不为空、
 * 载荷不缺项。
 */






let dir: string;
let good: string;
let broken: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string }[];
};

describe("contract --json 遇语法错文件：失败 root 必须进载荷", () => {
  it("单文件（语法错）+ --draft --json：stdout 非空 + 合法 JSON + errors[] + exit 1；目录（好文件 + 坏文件）+ --draft --json：坏文件**不再消失**（载荷不缺项）；print 形态（--json）+ 语法错：同样有 errors 条目（机器面统一）；人类面不变：stderr 仍点名失败文件 + exit 1", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors).toHaveLength(1);
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
    expect(docs[0].errors?.[0]?.message.length).toBeGreaterThan(0);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs.length).toBeGreaterThanOrEqual(2);
    // 好文件的文档在
    expect(docs.some((d) => d.file === "good.js" && typeof d.draftSource === "string")).toBe(true);
    // 坏文件的失败条目也在
    const failed = docs.find((d) => d.file === "syn.js");
    expect(failed).toBeDefined();
    expect(failed?.errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Error analyzing");
    expect(r.stderr).toContain("syn.js");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// nudo contract --json --emit · 机器面拿得到合法载荷
// ---------------------------------------------------------------------------
describe("nudo contract --json --emit · 机器面拿得到合法载荷", () => {
/**
 * `nudo contract --json --emit` **静默忽略 `--json`**。
 *
 * 改前（`runContractEmit`）：opts 类型里**没有** `json` 字段、函数体**不读**它，
 * action 的 emit 分支也**不传** ⇒ stdout 是**人类文本**、exit 0 ⇒ 机器面拿到
 * **非法 JSON** 且**无失败信号**。
 *
 * ⚠ 勘误（族 20 · 实测）：族 21 的 修好了 `--json`（无 `--draft`）那一支；
 * **本条只剩 `--json --emit` 一支**。且片 A 的 658/664 聚合层落地后，
 * 症状从「人类文本 + exit 0」变成「聚合信封里塞 `nudo:contract-json-payload-invalid`
 * 错误条目 + exit 1」⇒ **emit 结果仍然拿不到机器载荷**（退化成了 `output` 字符串）。
 *
 * 钉（族 20 · 片 C）：`--json --emit` ⇒ stdout 是**合法 JSON**、载荷是
 * **emit 的机器文档**（`file` / `sidecar` / `changed` / `written` / `skipped` /
 * `issues` / `diff`），与 print / draft 分支**同构**（聚合层的外壳 = 恒定数组）。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-667-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}

describe("nudo contract --json --emit · 机器面拿得到合法载荷", () => {
  it("--json --emit ⇒ stdout 是合法 JSON 且载荷是 emit 的机器文档；--json --emit --dry-run ⇒ 载荷里带 diff（与 draft 分支同构）", () => {
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--json", "--emit", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    // 机器面：stdout 恒为**一份**合法 JSON（聚合外壳 = 恒定数组）
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const doc = parsed[0];
    expect(doc.file).toBe("lib.js");
    expect(doc.sidecar).toBe("lib.nudo.js");
    expect(doc.changed).toBe(true);
    expect(doc.written).toEqual(["alpha", "beta"]);
    expect(doc.skipped).toEqual([]);
    expect(doc.issues).toEqual([]);
    // 不是「分支层没吐 JSON 文档」的错误条目
    expect(doc.errors).toBeUndefined();
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(
      ["contract", "--json", "--emit", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    const doc = parsed[0];
    expect(typeof doc.diff).toBe("string");
    expect(doc.diff as string).toContain("--- a/lib.nudo.js");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// [merged] from-dts-draft-invariants
// ---------------------------------------------------------------------------
describe("from-dts-draft-invariants", () => {
// MERGED (topic-related bug pins): from-dts-draft-invariants + from-dts-dry-run-diff + from-dts-write-path
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






describe("from-dts-draft-invariants", () => {
/**
 * `--from-dts --write` 的**草稿落点族**不变量（族 20 · 的
 * 收口回归；与 `from-dts-write-path` /
 * `nudojs--contract-cli-text.part.ts` 互补 —— 那两处钉的是
 * 「用例意图」，这里钉的是**规则本身**）。
 *
 * 钉：
 * ① 落点**贴着源 `.d.ts`**（`sidecarDraftPath` 口径）⇒ **不以 CWD 为基准**
 * ⇒ CWD 里的同名草稿不会被静默覆盖；
 * ② 落点名的 basename **不含 `.d.`**（`tmp/bug-report/sections/
 * .md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含
 * `.d.` ⇒ TypeScript 的 `getDeclarationFileExtension` 判它是**声明文件**
 * ⇒ 草稿与工具建议的复制落点都过不了 `tsc --strict`（TS1254）⇒
 * 「next」提示点名的侧车路径同样不得含 `.d.`；
 * ③ 既有草稿**存在且内容不同** ⇒ **拒绝覆盖**（exit 1）+ 提示，提示**同时**
 * 给出两个放行口子（CLI 旗标 `--force` **与** 环境变量 `NUDO_DRAFT_FORCE`）
 * 并说明「人工改过的草稿永不被覆盖」；
 * ④ 放行口子是真的：**机器原稿**（内容不同）+ `--force` / `NUDO_DRAFT_FORCE=1`
 * ⇒ 覆盖成功；**人工改过的草稿** ⇒ `--force` 也**不放行**（逐字不变）。
 */






const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：`types/index.d.ts`（源）+ CWD 里另一个文件的既有草稿 */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-inv-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  // CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖
  writeFileSync(join(dir, "index.nudo.draft.js"), "// @nudo:draft\n// 别的文件的草稿\n", "utf-8");
  return dir;
}

/** 落点（贴着源 `.d.ts`；basename 不含 `.d.`） */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}

describe("nudo contract --from-dts --write · 草稿落点族不变量", () => {
  it("落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）；「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）；既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子；内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）；机器原稿（内容不同）+ `--force` ⇒ 覆盖成功；机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1` ", () => {
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    const draft = draftPathOf(dir);
    expect(existsSync(draft)).toBe(true);
    // basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿过不了 tsc
    expect(basename(draft)).not.toContain(".d.");
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // 不以 CWD 为基准 ⇒ CWD 里**没有**同名新草稿，别的文件的草稿逐字不变
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(
      "// @nudo:draft\n// 别的文件的草稿\n",
    );
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
    // 旧名 `types/index.d.nudo.ts` 过不了 `tsc --strict`（TS1254）
    expect(r.stdout).not.toContain("types/index.d.nudo.ts");
  })();
(() => {

    const dir = makeFixture();
    const draft = draftPathOf(dir);
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draft, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 提示**点名**目标落点（用户知道该去哪儿看）
    expect(r.stderr).toContain("types/index.nudo.draft.ts");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变 + 没有谎报成功
    expect(readFileSync(draft, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  })();
(() => {

    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const written = readFileSync(draftPathOf(dir), "utf-8");

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("draft unchanged");
    expect(readFileSync(draftPathOf(dir), "utf-8")).toBe(written);
  })();
(() => {

    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ 可覆盖）
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  })();
(() => {

    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
      cwd: dir,
      env: { NUDO_DRAFT_FORCE: "1" },
    });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  })();
(() => {

    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = draftPathOf(dir);
    const machine = readFileSync(draft, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draft, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draft, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 1 个 CLI 子进程

  ; // 2 个顺序 CLI 子进程

  ; // 2 个顺序 CLI 子进程

  ; // 2 个顺序 CLI 子进程

  ; // 2 个顺序 CLI 子进程
});
});

describe("from-dts-dry-run-diff", () => {
/**
 * （续）—— `nudo contract --from-dts --write --dry-run` 的预览是
 * **整份草稿正文的 dump**，不是 unified diff；且「既有草稿不同 ⇒ 拒绝覆盖」
 * 那一关跑在 dry-run 分支**之前** ⇒ dry-run 遇到既有草稿**直接报错退出**，
 * **连 diff 都看不到**。
 *
 * 改后（同一片修）：
 * ① dry-run 打 **unified diff**（对照面 = 既有草稿文件的磁盘内容；文件不存在
 * ⇒ 对空串求 diff ⇒ 整份都是新增行），**不再**倾倒草稿全文；
 * ② 标签行 `[dry-run] would write <path>` 保留（用户仍看得到目标路径）；
 * ③ dry-run 的**退出码与真写盘同口径**：真写会被拒（既有草稿不同且无
 * `--force` / 人工改过的草稿即使有 `--force`）⇒ dry-run 也 exit 1，但
 * **预览照打**（diff 仍然可见）；会写成功 ⇒ exit 0；
 * ④ dry-run **绝不写盘**（既有草稿逐字不变、新草稿不被创建）。
 *
 * ⚠ 夹具全部写在临时目录里（cwd = 临时目录），`finally` 里清理；夹具里写
 * `writeSrcTsconfig`（CLI 子进程按 cwd 找 tsconfig，否则 `@nudojs/*` 落到
 * `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现）。夹具**不**依赖
 * `package.json`（`--from-dts` 的落点贴着源 `.d.ts`，不需要项目根）。
 */






const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 新的机器草稿里 `mul` 那一行（harvester 的 fn() DSL 口径） */
const MUL_LINE = "export const mul = fn({ a: number(), b: number() }, number());";

/** 既有草稿：与新生成的内容**不同**（无指纹 ⇒ 会被判成人工改过） */
const EXISTING_DRAFT = `// @nudo:draft
// 人工留存的既有草稿（与新生成的内容不同）
`;

/** 落盘路径（贴着源 `.d.ts`，`sidecarDraftPath` 口径） */
const DRAFT_REL = "types/index.nudo.draft.ts";

/** 夹具：`types/index.d.ts`；`fn` 在 try/finally 里跑（临时目录必定清理）。 */
function withFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-dry-run-"));
  try {
    writeSrcTsconfig(dir);
    mkdirSync(join(dir, "types"), { recursive: true });
    writeFileSync(join(dir, "types", "index.d.ts"), DTS, "utf-8");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** stdout 里所有含 `needle` 的行（用来判「是不是全文 dump」） */
function linesWith(stdout: string, needle: string): string[] {
  return stdout.split("\n").filter((l) => l.includes(needle));
}

describe("nudo contract --from-dts --write --dry-run · （续）· unified diff 预览", () => {
  it("无既有草稿 ⇒ exit 0，打 unified diff（不再是全文 dump），且**不建**草稿文件；既有草稿不同 + 无 --force ⇒ exit 1（与真写同口径），**仍**打 diff + 报拒绝 + 文件逐字不变；人工改过的草稿 + `--force` ⇒ exit 1（force 也放行不了），diff 照打、文件逐字不变；负控制：真写（无 --dry-run）遇既有不同草稿仍 exit 1、文件逐字不变，且**不打** diff", () => {
(() => {

    withFixture((dir) => {
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
      });

      expect(r.status).toBe(0);
      // 标签行保留：用户仍看得到目标路径
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      // diff 头与 `--emit --dry-run` / `--draft --write --dry-run` **同形**
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      // 真正的 hunk（文件不存在 ⇒ 对照面是空串 ⇒ 整份都是新增行）
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 改前：stdout 是整份草稿正文的 dump ⇒ 这些行**不带** diff 前缀也出现
      for (const needle of ["export const mul", 'from "@nudojs/core"', "// @nudo:draft"]) {
        const hits = linesWith(r.stdout, needle);
        expect(hits.length, `stdout 里应出现 ${needle}`).toBeGreaterThan(0);
        expect(
          hits.every((l) => l.startsWith("+")),
          `「${needle}」只能以新增行（+）出现 —— 不得出现无前缀的全文 dump`,
        ).toBe(true);
      }
      // dry-run **不写盘**
      expect(existsSync(join(dir, DRAFT_REL))).toBe(false);
    });
  })();
(() => {

    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 环境变量通道也算「force」⇒ 显式置空，免得开发机的 NUDO_DRAFT_FORCE=1
      // 把「无 --force ⇒ 拒绝」这一钉变成假绿（断言本身不变）。
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      // 退出码镜像真写：真写会拒绝 ⇒ dry-run 也 1（不得静默 0 谎报「会写」）
      expect(r.status).toBe(1);
      // 预览仍然可见：标签行 + diff 头 + 新增行
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 拒绝理由仍然报出来（与真写同一套文案）
      expect(r.stderr).toContain("refusing to overwrite");
      expect(r.stderr).toContain(DRAFT_REL);
      // dry-run 绝不写盘：既有草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
    });
  })();
(() => {

    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      // 先真写一次机器原稿，再人工改动正文 ⇒ 指纹失配
      const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
      expect(first.status).toBe(0);
      const machine = readFileSync(draftPath, "utf-8");
      expect(machine).toContain("@nudo:draft-fingerprint");
      const handEdited = `${machine}// 人工改动\n`;
      writeFileSync(draftPath, handEdited, "utf-8");

      const r = runCli(
        ["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run", "--force"],
        { cwd: dir },
      );

      // 真写会被拒（hand-edited 通道，force 放行不了）⇒ dry-run 也 1
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("hand-edited");
      // 预览照打：标签行 + diff（被删掉的人工行是 diff 的一部分）
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain("-// 人工改动");
      // 人工改过的草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);
    });
  })();
(() => {

    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 同上一钉：显式置空 NUDO_DRAFT_FORCE（环境变量也是 force 通道）
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      expect(r.status).toBe(1);
      expect(r.stderr).toContain("refusing to overwrite");
      // 既有草稿逐字不变（真写的保证）
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
      // 没有谎报成功，也没有把 diff 预览塞进真写面
      expect(r.stdout).not.toContain("wrote ");
      expect(r.stdout).not.toContain("--- a/");
    });
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 2 个顺序 CLI 子进程

  ; // 1 个 CLI 子进程
});
});

describe("from-dts-write-path", () => {
/**
 * `nudo contract --from-dts --write` 把草稿写进 **CWD**
 * （不是源 `.d.ts` 旁边）且**无条件覆盖** ⇒ 静默覆盖同基名的**另一个文件**的
 * 草稿，零告警、exit 0。
 *
 * 钉（族 20 · 片 C）：
 * ① 输出路径**贴着源 `.d.ts`**（`sidecarDraftPath` 口径，与 `--draft --write`
 * 同款）⇒ **不再**以 CWD 为基准 ⇒ CWD 里的同名草稿**逐字不变**；
 * ② 写盘前做**存在性检查**（已存在且内容不同 ⇒ **拒绝覆盖** + 提示、exit 1）;
 * ③ 写盘**复用** service 的写盘助手（五重保护）；
 * ④ 「next」提示**点名目标侧车路径**。
 *
 * ⚠ 落点名的 `.d.` 段按 ****（`tmp/bug-report/sections/.md`
 * + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
 * **不得含 `.d.`** —— basename 含 `.d.` ⇒ TypeScript 的
 * `getDeclarationFileExtension` 判它是**声明文件** ⇒ 草稿与工具建议的
 * 复制落点都过不了 `tsc --strict`（TS1254）⇒ `types/index.d.ts` 的草稿是
 * `types/index.nudo.draft.ts`、侧车是 `types/index.nudo.ts`
 * （**不是** `types/index.d.nudo.draft.ts` / `types/index.d.nudo.ts`）。
 */






/** CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖 */
const OTHER_DRAFT = `// @nudo:draft
// Generated by \`nudo contract --draft\` from index
//
// dts draft of index.js — 手工留存的既有草稿（不得被 --from-dts 静默覆盖）

import { fn, number } from "@nudojs/core";

// add — from analysis
export const add = fn({ a: number(), b: number() }, number());
`;

const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：index.js + 它的既有草稿 + types/index.d.ts（另一个基名的源） */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(
    join(dir, "index.js"),
    "export function add(a, b) {\n  return a + b;\n}\n",
    "utf-8",
  );
  writeFileSync(join(dir, "index.nudo.draft.js"), OTHER_DRAFT, "utf-8");
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  return dir;
}

describe("nudo contract --from-dts --write · 落盘位置与覆盖保护", () => {
  it("草稿落在**源 .d.ts 旁边**（不再是 CWD）⇒ CWD 里的同名草稿逐字不变；「next」提示**点名目标侧车路径**；目标已存在且内容不同 ⇒ **拒绝覆盖**（exit 1）+ 提示 + 既有草稿逐字不变", () => {
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    // 产物贴着源 .d.ts（落点名不含 `.d.` 段 —— ）
    const draft = join(dir, "types", "index.nudo.draft.ts");
    expect(existsSync(draft)).toBe(true);
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // CWD 里**不再**出现新草稿
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    // 另一个文件（index.js）的既有草稿**逐字不变**（改前被静默覆盖）
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(OTHER_DRAFT);
  })();
(() => {

    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
  })();
(() => {

    const dir = makeFixture();
    // 先写一次（产物落盘）
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = join(dir, "types", "index.nudo.draft.ts");
    const written = readFileSync(draft, "utf-8");
    // 源 .d.ts 变了 ⇒ 草稿内容会变
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    // 拒绝覆盖 ⇒ 非 0 退出 + 可诊断的理由
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("refusing to overwrite");
    expect(second.stderr).toContain("types/index.nudo.draft.ts");
    // 既有草稿逐字不变（没有静默丢内容）
    expect(readFileSync(draft, "utf-8")).toBe(written);
    // 没有谎报成功
    expect(second.stdout).not.toContain("wrote ");
  })();
});; // 1 个 CLI 子进程（tsx 冷启动）

  ; // 1 个 CLI 子进程

  ; // 2 个顺序 CLI 子进程
});
});
});
