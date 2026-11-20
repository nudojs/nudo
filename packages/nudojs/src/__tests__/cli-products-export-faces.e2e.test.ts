/**
 * 模块套件：cli-products-export-faces（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { createHash } from "node:crypto";


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
 * 修法：模块标识改为**不含绝对路径的稳定 id**（包内 ⇒ `<包名>/<相对包根路径>`；
 * 包外 ⇒ `<父目录名>/<stem>|<导出名集合>`），marker 里不再写绝对路径。
 *
 * 包外键带**父目录名**是 BUG-049 的另一半：旧的 `stem|导出集` 让两个不同源文件
 * （`a/util.js` 与 `b/util.js`，同名同导出）得到同一个标识 ⇒ `isSameModule` 判真
 * ⇒ 后导出的静默覆盖前者的四份产物（exit 0、零告警）。父目录名进键即可区分
 * 兄弟模块，且仍是**相对**的（不含构建机路径）。
 *
 * 「同一份源码 ⇒ 同一字节」的真正不变量因此收窄为「**同布局**的两个 checkout
 * ⇒ 同一字节」：树里相对布局相同（都叫 `a/clean.js`）的两个 checkout 得到同一个
 * 标识、同一份产物；而 `A/clean.js` 与 `B/clean.js` 是**两个模块**，各产一份。
 *
 * 钉：
 * - 同布局的两个 checkout 导出到同一 `--out` ⇒ 只有一份产物（原地覆盖），
 *   marker 与正文逐字相同；
 * - 不同目录下的同名模块 ⇒ 两份产物互不覆盖（BUG-049）；
 * - marker 行不含绝对路径（可复现构建）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function clean(x) {\n  return x + 1;\n}\nclean(1);\n";


  it("同布局的两个 checkout 导出到同一 out ⇒ 只有一份产物、marker 与正文逐字相同；不同目录的同名模块 ⇒ 两份产物互不覆盖；marker 不含绝对路径", () => {
  {
    // 唯一变量 = checkout 根不同，树里相对布局相同（都叫 `a/clean.js`）
    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-"));
    dirs.push(dir);
    for (const root of ["co1", "co2"]) {
      mkdirSync(join(dir, root, "a"), { recursive: true });
      writeFileSync(join(dir, root, "a", "clean.js"), SRC, "utf-8");
    }
    const out = join(dir, "out");

    const a = runCli(["export", join(dir, "co1", "a", "clean.js"), "--format", "dts", "--out", out]);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("wrote");
    const first = readFileSync(join(out, "clean.d.ts"), "utf-8");
    const b = runCli(["export", join(dir, "co2", "a", "clean.js"), "--format", "dts", "--out", out]);
    expect(b.status).toBe(0);

    const products = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 改前：clean.d.ts（co1 的遗留副本）+ clean.<hash>.d.ts（co2 的新副本）
    expect(products).toEqual(["clean.d.ts"]);
    const marker = readFileSync(join(out, "clean.d.ts"), "utf-8").split("\n")[0]!;
    // 相对布局相同 ⇒ 同一个模块标识（父目录名 `a`，不含 checkout 路径）
    expect(marker).toBe("// nudo-export-module: a/clean|clean");
    expect(marker).not.toContain(dir);
    expect(readFileSync(join(out, "clean.d.ts"), "utf-8")).toBe(first);
  }
  {
    // BUG-049：两个**不同的源文件**（同名同导出集合）不得被判成同一模块
    const dir = mkdtempSync(join(tmpdir(), "nudo-b049-"));
    dirs.push(dir);
    mkdirSync(join(dir, "A"), { recursive: true });
    mkdirSync(join(dir, "B"), { recursive: true });
    writeFileSync(join(dir, "A", "clean.js"), SRC, "utf-8");
    writeFileSync(join(dir, "B", "clean.js"), SRC, "utf-8");
    const out = join(dir, "out");

    expect(runCli(["export", join(dir, "A", "clean.js"), "--format", "dts", "--out", out]).status).toBe(0);
    expect(runCli(["export", join(dir, "B", "clean.js"), "--format", "dts", "--out", out]).status).toBe(0);

    const products = readdirSync(out).filter((f) => f.endsWith(".d.ts")).sort();
    expect(products).toHaveLength(2);
    expect(products).toContain("clean.d.ts");
    const unique = products.find((f) => f !== "clean.d.ts")!;
    expect(unique).toMatch(/^clean\.[0-9a-f]{8}\.d\.ts$/);
    // 规范名仍归 A（后导出的不得原地吃掉前一份），第二份带 B 的模块标识
    expect(readFileSync(join(out, "clean.d.ts"), "utf-8").split("\n")[0]!).toBe(
      "// nudo-export-module: A/clean|clean",
    );
    expect(readFileSync(join(out, unique), "utf-8").split("\n")[0]!).toBe(
      "// nudo-export-module: B/clean|clean",
    );
  }
  {
    // 同一路径重复导出 ⇒ 幂等（不新增 hash 副本、字节不变）
    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-idem-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    writeFileSync(join(dir, "a", "clean.js"), SRC, "utf-8");
    const out = join(dir, "out");
    expect(runCli(["export", join(dir, "a", "clean.js"), "--format", "dts", "--out", out]).status).toBe(0);
    const once = readFileSync(join(out, "clean.d.ts"), "utf-8");
    expect(runCli(["export", join(dir, "a", "clean.js"), "--format", "dts", "--out", out]).status).toBe(0);
    expect(readdirSync(out).filter((f) => f.endsWith(".d.ts"))).toEqual(["clean.d.ts"]);
    expect(readFileSync(join(out, "clean.d.ts"), "utf-8")).toBe(once);
  }
}, 120_000); // 6 个 CLI 子进程（tsx 冷启动）


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


  it("用户导出名在 stdout 的 dts 段保持原名（不出现 *Dts 后缀）；stdout 的 dts 段与 --out 落盘的 .d.ts 逐字相同（两条投递路径同一公开 API）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCli(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function fooInput(y: unknown): unknown;");
    expect(r.stdout).toContain("export declare function fooOutput(z: unknown): unknown;");
    expect(r.stdout).not.toContain("fooInputDts");
    expect(r.stdout).not.toContain("fooOutputDts");
    // 生成的校验器名让位（不是抢占用户导出名）
    expect(r.stdout).toContain("export const fooInputZod");
    expect(r.stdout).toContain("export const fooInputStandard");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-parity-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");

    const stdout = runCli(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(stdout.status).toBe(0);
    const written = runCli(["export", join(dir, "collide.js"), "--format", "all", "--out", out]);
    expect(written.status).toBe(0);

    const dtsName = readdirSync(out).find((f) => f.endsWith(".d.ts"));
    expect(dtsName).toBeDefined();
    const dts = readFileSync(join(out, dtsName!), "utf-8");

    const fromStdout = stdout.stdout.match(DTS_DECL) ?? [];
    const fromFile = dts.match(DTS_DECL) ?? [];
    expect(fromFile).toHaveLength(3);
    expect([...fromStdout].sort()).toEqual([...fromFile].sort());
  }
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


  it("只有再导出的模块：dts 产出再导出声明（不是「无函数」早退）；负控制：本地函数 + 再导出的模块两条面都在；负控制：真的没有导出面的模块仍如实说明（不静默零产物）", () => {
  {
    const dir = fixture();
    const r = runCli(["export", join(dir, "reexp.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
    expect(r.stdout).not.toContain("No analyzed functions found");
  }
  {
    const dir = fixture();
    const r = runCli(["export", join(dir, "mix.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function own(): number;");
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
  }
  {
    const dir = fixture();
    writeFileSync(join(dir, "empty.js"), "const x = 1;\nexport { };\n", "utf-8");
    const r = runCli(["export", join(dir, "empty.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("No ");
  }
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
  {
    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--fn", "renamed", "--", "lib.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("matched no export");
    expect(r.stdout).toContain("export const renamed = fn(");
    expect(r.stdout).toContain("(sidecar key: renamed)");
  }
  {
    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--write", "--fn", "totallyMissing", "--", "lib.js"], {
      cwd: dir,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("matched no export");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程
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


  it("名字写错 ⇒ 用法错误（exit 1）+ 列出可用导出名 + **不落盘**；--json 面：stdout 仍是**一份合法 JSON 文档**（usage-error 有条目）+ exit 1；对照组：名字正确 ⇒ exit 0 且草稿点名该导出；非导出的本地函数名 ⇒ 仍走**可见**的 not-an-export 条目（门禁不误伤）", () => {
  {
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
  }
  {
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
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "handwritten", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const handwritten = fn(");
    // 未点名的导出不出现在草稿里（过滤仍然生效）
    expect(r.stdout).not.toContain("export const caller = fn(");
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "helper", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not-an-export");
    expect(r.stderr).not.toContain("matched no export");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

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


  it("dts 面：返回位是真类型（不是 unknown），且与 dot 形态逐字一致；zod 面：Output 是联合（不是 `z.unknown()`），且与 dot 形态逐字一致；guard 面：校验器真的校验（不是 `return true;`），且与 dot 形态逐字一致", () => {
  {
    const { obj, dot } = fixture();
    const o = runCli(["export", "--format", "dts", obj]);
    const d = runCli(["export", "--format", "dts", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).toContain("export declare function h(x: unknown): number | string;");
    expect(o.stdout).not.toContain("): unknown;");
    expect(o.stdout).toBe(d.stdout);
  }
  {
    const { obj, dot } = fixture();
    const o = runCli(["export", "--format", "schema", obj]);
    const d = runCli(["export", "--format", "schema", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("hOutput = z.unknown()");
    expect(o.stdout).toContain("z.union([");
    expect(o.stdout).toBe(d.stdout);
  }
  {
    const { obj, dot } = fixture();
    const o = runCli(["export", "--format", "guard", obj]);
    const d = runCli(["export", "--format", "guard", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("return true;");
    expect(o.stdout).toContain('typeof data === "number" || typeof data === "string"');
    expect(o.stdout).toBe(d.stdout);
  }
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


  it("违约见证不写入；固化后 check 仍绿（旧行为：check FAILED + exit 1）；--freeze=update 不再重记违约见证（旧行为：原样重记同一条 ⇒ 永远红）", () => {
  {
    const { dir, lib, usage } = project();
    try {
      const before = runCli(["check", lib]);
      expect(before.status, before.stdout).toBe(0);

      const freeze = runCli(["test", lib, "--from", usage, "--freeze"]);
      // 退出码不是本条的判据：调用点上确实存在违反契约的实参 ⇒ 分析面如实报
      // `nudo:contract-domain-exceeds`（error 级，口径）⇒ exit 1 是**正确**的。
      // 的判据是「固化不得把该违约搬进被调方」。
      expect(freeze.stdout).toContain("freeze →");
      expect(freeze.stdout).toContain("nudo:contract-domain-exceeds");

      const after = readFileSync(lib, "utf-8");
      expect(after).toContain('@nudo:case "call@usage.js:L2" (5)');
      // 旧行为：`(-1)` 也被写进来 ⇒ 随后 `nudo:case-inconsistency` 判红
      expect(after).not.toContain("call@usage.js:L3");

      const check = runCli(["check", lib]);
      expect(check.stdout, check.stdout).not.toContain("case-inconsistency");
      expect(check.status, check.stdout).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, lib, usage } = project();
    try {
      const first = runCli(["test", lib, "--from", usage, "--freeze"]);
      expect(first.stdout).toContain("freeze →");
      const once = readFileSync(lib, "utf-8");
      const upd = runCli(["test", lib, "--from", usage, "--freeze=update"]);
      expect(upd.stdout).toContain("freeze: no changes.");
      expect(upd.stdout).not.toContain("freeze →");
      expect(readFileSync(lib, "utf-8")).toBe(once);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
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


  it("default 函数：declare function + `export { main as default }`；default 类：declare class + `export { Box as default }`；单独 --format dts 同样合法（存成 .ts 也可编译）；具名导出保持既有 `export declare function` 形态", () => {
  {
    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCli(["export", join(dir, "defexp.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
      // `export default function` 在普通模块里没有实现 ⇒ TS2391
      expect(out).not.toMatch(/^export default function /m);
    });
  }
  {
    withProject({ "defcls.js": DEFAULT_CLASS }, (dir) => {
      const out = runCli(["export", join(dir, "defcls.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare class Box {");
      expect(out).toContain("export { Box as default };");
      expect(out).not.toMatch(/^export default class /m);
    });
  }
  {
    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCli(["export", join(dir, "defexp.js"), "--format", "dts"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
    });
  }
  {
    withProject({ "named.js": NAMED }, (dir) => {
      const out = runCli(["export", join(dir, "named.js"), "--format", "all"]).stdout;
      expect(out).toContain("export declare function add(");
      expect(out).not.toContain("as default");
    });
  }
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


  it("--from-dts + --emit/--all/--dry-run/--exit-on-diff ⇒ 用法错误（exit 1）+ 不写侧车；--from-dts + --fn ⇒ 同样用法错误（过滤不许被吞）；对照组：--from-dts 单独跑 ⇒ 仍出草稿（exit 0）；机器面控制组：--from-dts + --emit + --json ⇒ 仍是合法 JSON + exit 1（绝不假绿）", () => {
  {
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
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--fn", "addOne", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from-dts cannot be combined with --fn");
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("addOne");
  }
  {
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
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

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
const SIDECAR_CONVERGED = `import { litC as lit } from "@nudojs/core"; // nudo:emit-builders

import { fn, number } from "@nudojs/core";

// 手写段（tag）：API 表面想强制的契约
export const tag = fn({ n: number().gt(0) }, string());

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:wrap
// derived-from: lib.js:tag
// evidence: local
export const wrap = fn({ text: lit(42) }, lit("(42)"));
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


  it("首次 --emit --all：标签行真落盘（Updated 与文件一致）；第二次逐字不变（幂等）；--dry-run --exit-on-diff：预览与落盘同源 —— 收敛前 exit 1，收敛后 exit 0；对照组：真有净漂移 ⇒ dry-run 打 diff 且 --exit-on-diff exit 1（门禁没被关掉）", () => {
  {
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
  }
  {
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
  }
  {
    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");
    const drifted = SIDECAR.replace("text: number()", "text: lit(9)");
    writeFileSync(sidecar, drifted, "utf-8");

    const r = runCli(["contract", "lib.js", "--emit", "--all", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });

    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[dry-run] would update lib.nudo.js:");
    expect(r.stdout).toContain('+export const wrap = fn({ text: lit(42) }, lit("(42)"));');
    // 手写段不被触碰
    expect(r.stdout).not.toContain("-export const tag");
    expect(readFileSync(sidecar, "utf-8")).toBe(drifted);
  }
}); // 2 个 CLI 子进程（tsx 冷启动）

  it("收敛侧车（@generated 段 = 调用点字面量）⇒ export dts 不得把快照当义务发布", () => {
    const dir = makeFixture();
    // 收敛态侧车：wrap 段是 `@generated`（`lit(42)` / `lit("(42)")`）
    writeFileSync(join(dir, "lib.nudo.js"), SIDECAR_CONVERGED, "utf-8");

    const r = runCli(["export", "lib.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    // 生成档是**事实快照**（不执法，只 drift；check 面只报 warning）⇒ 公开
    // dts 不得收窄到那次调用的字面量（`wrap("x")` 是合法调用，产物必须接受）
    expect(r.stdout).not.toContain("text: 42");
    expect(r.stdout).toContain("export declare function wrap(text: number): string;");
    expect(r.stdout).not.toContain('wrap(text: 42): "(42)"');
    // 手写段仍是义务（对照：不是一刀切丢契约）
    expect(r.stdout).toContain("export declare function tag(n: number): string;");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

   // 3 个 CLI 子进程

   // 1 个 CLI 子进程

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
 * （宽化只属于 draft 面；emit 两个分支都落**精确观测**：`fn({ a: lit(1) }, lit(2))`）
 * ⇒ 同一段两个写者。
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

/** 同一段：直写正文（BUG-113 的精确观测 `lit(1)` / `lit(2)`，不是宽化后的 `number()`）+ 派生分支并进来的溯源行 */
const EXPECTED_WRAP = `export const foo = fn({ a: lit(1) }, lit(2));`;

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


  it("两个分支都命中同一导出 ⇒ 直写正文优先 + `derived-from` 标签行真落盘；幂等：连跑两次 --emit --all ⇒ 第二次无 Updated 且 md5 不变；收敛后 --dry-run --exit-on-diff ⇒ exit 0，且不再打印永不落盘的 diff；预览 == 写盘（字节级）：dry-run 的新增行拼起来就是真实写盘内容", () => {
  {
    const { dir, sidecar } = makeFixture();

    const r = runCli(["contract", "lib.js", "--emit", "--all"], { cwd: dir });
    expect(r.status, r.stdout + r.stderr).toBe(0);

    const written = readFileSync(sidecar, "utf-8");
    // BUG-113：直写分支的精确观测与派生分支同域（`lit(1)` / `lit(2)`）
    expect(written).toContain(EXPECTED_WRAP);
    // 派生分支的溯源行**真的落盘**（旧实现被直写分支整段覆盖 ⇒ 永不出现）
    expect(written).toContain("// derived-from: lib.js:bar");
    // 台账与文件一致：内容真的变了 ⇒ 必须报 Updated
    expect(r.stdout).toContain("Updated");
    expect(r.stdout).toContain("written: foo");
  }
  {
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
  }
  {
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
  }
  {
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
  }
}); // 1 个 CLI 子进程

   // 2 个 CLI 子进程

   // 2 个 CLI 子进程

   // 2 个 CLI 子进程

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


  it("warning 级 nudo:contract-conflict ⇒ 阻断（诊断上屏 + exit 1）", () => {
    const dir = makeFixture();
    const r = runCli(["export", "lib.js", "--format", "all"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("contract-conflict");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

});

// ---------------------------------------------------------------------------
// 用户类遮蔽内建名 ⇒ 运行时产物面不得按全局构造器投影
// ---------------------------------------------------------------------------
describe("用户类遮蔽内建名 ⇒ 运行时产物面不得按全局构造器投影", () => {
/**
 * `class Date { constructor(){ this.v = 1 } }` + `return new Date()` ⇒
 * zod 产物 `z.instanceof(Date)`（产物模块里 `Date` 恒解析为**全局**）⇒
 * 校验器拒收函数**唯一**的返回形态（`expected Date, received Date`）；
 * standard 面同源。dts 面（`declare class Date`）与 guard 面（结构性子句）
 * 却放行 ⇒ 四面相反裁决。
 *
 * 根因是名字→身份：brand 的 Abs 只有 `{name}`，`isRuntimeGlobalCtorName`
 * 只看名字；两个运行时产物面是独立模块，无从解析源文件的本地类。
 *
 * 钉（e2e 层：装配是否真的把模块绑定表喂进投影）：
 * - 遮蔽模块：zod 面 `z.unknown()` + 台账点名，产物里没有 `z.instanceof(Date)`；
 * - 对照模块（同一个名字、无本地类）：仍是 `z.instanceof(Date)`（不过度降级）。
 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-brand-shadow-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  // 夹具 cwd 下 `@nudojs/*` 会落到各包 dist（陈旧构建）⇒ paths 钉到仓内 src
  writeSrcTsconfig(dir);
  writeFileSync(
    join(dir, "shadow.js"),
    `class Date { constructor() { this.v = 1; } }\nexport function makeTopDate() { return new Date(); }\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "plain.js"),
    `export function makeGlobalDate() { return new Date(); }\n`,
    "utf-8",
  );
  // `export default class Date` 与函数内的 `class Date`：两者都遮蔽同名全局，
  // 但都不在顶层 `result.bindings` 里（后者是块级绑定）。
  writeFileSync(
    join(dir, "shadow-nested.js"),
    `export default class Date { constructor() { this.v = 1; } }
export function makeDefaultDate() { return new Date(); }
export function makeLocalDate() {
  class Date { constructor() { this.v = 2; } }
  return new Date();
}
`,
    "utf-8",
  );
  return dir;
}

  it("遮蔽 ⇒ z.unknown() + 台账；对照 ⇒ 仍 z.instanceof(Date)", () => {
    const dir = makeFixture();
    dirs.push(dir);

    const a = runCli(["export", "shadow.js", "--format", "all", "--out", "out-a"], { cwd: dir });
    expect(a.status).toBe(0);
    const zodA = readFileSync(join(dir, "out-a", "shadow.nudo.schema.zod.ts"), "utf-8");
    expect(zodA).not.toContain("z.instanceof(Date)");
    expect(zodA).toContain("export const makeTopDateOutput = z.unknown();");
    expect(zodA).toContain("brand shadowed by a local binding");

    const b = runCli(["export", "plain.js", "--format", "all", "--out", "out-b"], { cwd: dir });
    expect(b.status).toBe(0);
    const zodB = readFileSync(join(dir, "out-b", "plain.nudo.schema.zod.ts"), "utf-8");
    expect(zodB).toContain("export const makeGlobalDateOutput = z.instanceof(Date);");
  }, 120000); // 2 个 CLI 子进程（tsx 冷启动）

  it("export default class / 函数内 class 同样遮蔽 ⇒ z.unknown()（不得按全局 Date 投影）", () => {
    const dir = makeFixture();
    dirs.push(dir);

    const r = runCli(["export", "shadow-nested.js", "--format", "all", "--out", "out-nested"], {
      cwd: dir,
    });
    expect(r.status).toBe(0);
    const zod = readFileSync(join(dir, "out-nested", "shadow-nested.nudo.schema.zod.ts"), "utf-8");
    expect(zod).not.toContain("z.instanceof(Date)");
    expect(zod).toContain("export const makeDefaultDateOutput = z.unknown();");
    expect(zod).toContain("export const makeLocalDateOutput = z.unknown();");
    expect(zod).toContain("brand shadowed by a local binding");
  }, 120000); // 1 个 CLI 子进程（tsx 冷启动）
});

// ---------------------------------------------------------------------------
// 契约写在解构形参上 ⇒ 四个产物面的返回面不得塌成空域
// ---------------------------------------------------------------------------
describe("契约写在解构形参上 ⇒ 返回面保持契约域", () => {
/**
 * `function g({ a, b })` + `@nudo:contract a pos` ⇒ 契约域种子重算按**契约
 * 参数名**建表、再拿**求值占位形参名**（`_p0`）去查 ⇒ 永不命中 ⇒ 播种全
 * `any` ⇒ 返回 Abs 是 any ⇒ 四个产物面把返回投影成空域：
 *
 * ```
 * export const gOutput = z.unknown();                                  // 任何值都放行
 * __nudoCheck({"k":"unknown"}, value, [], issues);                     // standard 同
 * export function isgOutput(value) { return true; }                    // guard 恒真
 * export declare function g(_p0: { a: number }): unknown;              // dts unknown
 * ```
 *
 * 而 `nudo check` 对同一函数是 `g({ a, b }: { a: number, b: unknown }) => number`，
 * 对照（同契约、形参改成标识符）四份产物都精确 ⇒ 同一知识在**解构形态**下被丢。
 *
 * 钉：四份产物同时精确（任一面塌成空域都会让这条挂）。
 */
const CTX = `import { number } from "@nudojs/core";
export const pos = number().gt(0);
`;

const SRC = `/// @nudo:import { pos } from "./shapes.nudo.js"
/** @nudo:contract a pos */
export function g({ a, b }) { return a; }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-destructure-contract-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "shapes.nudo.js"), CTX, "utf-8");
  writeFileSync(join(dir, "obj_pos.js"), SRC, "utf-8");
  writeSrcTsconfig(dir);
  return dir;
}

  it("zod / standard / guard / dts 四个面的返回面都是契约域（不再是空域）", () => {
    const dir = makeFixture();
    const r = runCli(["export", "obj_pos.js", "--format", "all"], { cwd: dir });
    expect(r.status).toBe(0);
    const out = r.stdout;

    // zod：精确到 gt(0)
    expect(out).toContain("export const gOutput = z.number().gt(0)");
    // standard：节点是 prim number + numBound（不是 unknown）
    expect(out).toContain(`__nudoCheck({"k":"prim","type":"number","refinements":[{"kind":"numBound","op":"gt","n":0}]}, value, [], issues);`);
    // guard：真的校验（不是 return true）
    expect(out).toContain("return (typeof data === \"number\") && (data > 0);");
    // dts：返回 number（不是 unknown）
    expect(out).toContain("export declare function g(_p0: { a: number }): number;");
  }, 60000); // 1 个 CLI 子进程

  it("解构里契约未申报的绑定不得被折成 exact undefined 发布（返回面 / 产物面）", () => {
    const dir = makeFixture();
    // 契约只申报 grade；`extra` 是解构绑定但没申报 ⇒ 种子对象**开放**
    // ⇒ `extra` 读 unknown（不是 exact undefined）。旧口径下契约种子对象是
    // 闭合 obj ⇒ `return { grade, extra }` 的 extra 被折成 undefined 并发布
    // （zod `extra: z.undefined()` / dts `extra: undefined`）⇒ 校验器只接受
    // `extra: undefined`，而实现允许任意 `extra`。
    writeFileSync(
      join(dir, "obj_extra.js"),
      `/// @nudo:import { pos } from "./shapes.nudo.js"
/** @nudo:contract grade pos */
export function pick({ grade, extra }) { return { grade, extra }; }
`,
      "utf-8",
    );
    const r = runCli(["export", "obj_extra.js", "--format", "all"], { cwd: dir });
    expect(r.status).toBe(0);
    const out = r.stdout;
    // 产物不得声称 extra 是 undefined（合法的 extra: 7 会被拒收）
    expect(out).not.toContain("z.undefined()");
    expect(out).not.toContain("extra: undefined");
    // 契约申报的键仍精确；未申报的绑定读 unknown（放行）
    expect(out).toContain("grade: z.number().gt(0)");
    expect(out).toContain("extra: z.unknown()");
    expect(out).toContain("extra: unknown");
  }, 60000); // 1 个 CLI 子进程
});

// ---------------------------------------------------------------------------
// 同 basename 的两个依赖 ⇒ 两个说明符各绑各的落盘声明
// ---------------------------------------------------------------------------
describe("export --out · 同名依赖的说明符不得塌成同一个", () => {
/**
 * dts 说明符重基时把路径压平成 `./<basename>`（`./a/util.js` 与 `./b/util.js`
 * ⇒ 都变 `./util.js`），而落盘侧早已给重名的第二份声明换成
 * `util.<hash>.d.ts` ⇒ 两个 import 都指向**未换名**的那份：
 *
 * ```ts
 * import type { AU } from "./util.js";   // 其实指向 a/util 的声明
 * import type { BU } from "./util.js";   // 同一个 —— 但声明里没有 BU ⇒ TS2305
 * ```
 *
 * 钉：`app.d.ts` 的两个说明符**不同**，且各自解析到**对应类**的声明。
 * 旧实现下两个 `expect(specFor("AU")).not.toBe(specFor("BU"))` 直接挂。
 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-spec-collision-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeSrcTsconfig(dir);
  mkdirSync(join(dir, "a"), { recursive: true });
  mkdirSync(join(dir, "b"), { recursive: true });
  writeFileSync(join(dir, "a", "util.ts"), "export class AU { a = 1; }\n", "utf-8");
  writeFileSync(join(dir, "b", "util.ts"), "export class BU { b = 1; }\n", "utf-8");
  writeFileSync(
    join(dir, "app.ts"),
    `import { AU } from "./a/util.js";\nimport { BU } from "./b/util.js";\nexport function f(x: AU, y: BU): number { return 1; }\n`,
    "utf-8",
  );
  return dir;
}

  it("两个同名依赖 ⇒ 两个不同说明符，各绑各的类", () => {
    const dir = makeFixture();
    const out = join(dir, "out");
    for (const rel of ["a/util.ts", "b/util.ts", "app.ts"]) {
      const r = runCli(["export", "--format", "dts", "--out", out, rel], { cwd: dir });
      expect(r.status).toBe(0);
    }
    const app = readFileSync(join(out, "app.d.ts"), "utf-8");
    const specFor = (name: string): string => {
      const m = app.match(new RegExp(`import type \\{ ${name} \\} from "([^"]+)";`));
      expect(m).not.toBeNull();
      return m![1]!;
    };
    const declFor = (spec: string): string =>
      readFileSync(join(out, spec.replace(/\.js$/, ".d.ts")), "utf-8");

    expect(specFor("AU")).not.toBe(specFor("BU"));
    expect(declFor(specFor("AU"))).toContain("export declare class AU");
    expect(declFor(specFor("BU"))).toContain("export declare class BU");
  }, 180000); // 3 个 CLI 子进程（tsx 冷启动）
});

// ---------------------------------------------------------------------------
// 表达式超类 / CJS 导出函数对象上的附加成员
// ---------------------------------------------------------------------------
describe("表达式超类与 CJS 函数对象附加成员进声明面", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "nudo-r1-emit-forms-"));
    dirs.push(d);
    return d;
  };

  it("extends mixin(Base) ⇒ 发开放构造基类 + 台账（继承成员不再 TS2339）", () => {
    const d = tmp();
    writeFileSync(
      join(d, "m.js"),
      `const mixin = (B) => class extends B { m() { return 1; } };
class Base { b() { return 2; } }
export class C extends mixin(Base) { c() { return 3; } }
`,
      "utf-8",
    );
    const r = runCli(["export", "--format", "dts", "--out", join(d, "out"), join(d, "m.js")]);
    expect(r.status, r.stderr).toBe(0);
    const dts = readFileSync(join(d, "out", "m.d.ts"), "utf-8");
    expect(dts).toContain("nudo:unresolved-superclass C");
    expect(dts).toContain("extends mixin(Base)");
    expect(dts).toMatch(/declare const __nudo_base_C: \{ new \(\): any; \[key: string\]: any \};/);
    expect(dts).toContain("extends __nudo_base_C");
  }, 120000);

  it("module.exports = f + f.version / f.helper ⇒ namespace 合并声明", () => {
    const d = tmp();
    writeFileSync(
      join(d, "f.cjs"),
      `function f(x) { return x + 1; }
f.version = "1.0";
f.helper = function (y) { return y * 2; };
module.exports = f;
`,
      "utf-8",
    );
    const r = runCli(["export", "--format", "dts", "--out", join(d, "out"), join(d, "f.cjs")]);
    expect(r.status, r.stderr).toBe(0);
    const dts = readFileSync(join(d, "out", "f.d.cts"), "utf-8");
    expect(dts).toContain("declare function f(");
    expect(dts).toContain("export = f;");
    expect(dts).toContain("declare namespace f {");
    expect(dts).toContain("const version: string;");
    expect(dts).toContain("function helper(y: unknown): unknown;");
  }, 120000);
});

// ---------------------------------------------------------------------------
// TS `export = <local>` 的出口面与 CJS `module.exports = <local>` 同口径
// ---------------------------------------------------------------------------
describe("TS `export = <local>` 的出口面与 CJS `module.exports = <local>` 同口径", () => {
/**
 * `.ts` 的 `export = f` 在运行期就是 `module.exports = f`（tsc 的 CJS emit
 * 逐字如此），但解析期的 strip 会把这条 TS-only 语句整条删掉 ⇒ 导出面扫描
 * （check 的 L1/L2、`export --format dts`、`contract --draft`）对同一函数体
 * 的两种写法给出**相反**结论：`.cjs` 判红、`.ts` 判绿且产物为空。
 *
 * 修法是**分析视图 / 发射视图分开**：分析面把语句降级成等价的 CJS 出口，
 * 发射面（migrate strip 的产物）仍整条删除。本钉是导出面的回归钉。
 */
  const TS_EXPORT_ASSIGN = `function f(x: any) { return x.nope.deeper; }\nexport = f;\n`;
  const CJS_EXPORT_ASSIGN = `function f(x) { return x.nope.deeper; }\nmodule.exports = f;\n`;

  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function pair(): { ts: string; cjs: string } {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-assign-parity-"));
    dirs.push(dir);
    const ts = join(dir, "t.ts");
    const cjs = join(dir, "t.cjs");
    writeFileSync(ts, TS_EXPORT_ASSIGN, "utf-8");
    writeFileSync(cjs, CJS_EXPORT_ASSIGN, "utf-8");
    return { ts, cjs };
  }

  it("check：`export = f` 是入口（失败结论同 `.cjs`，不再判绿）；export dts：产出 `declare function f` + `export = f`（不再无产物）；contract --draft：为 f 出草稿（不再报 no draftable exports）", () => {
  {
    const { ts, cjs } = pair();
    const a = runCli(["check", ts]);
    const b = runCli(["check", cjs]);
    expect(a.status, a.stdout + a.stderr).toBe(b.status);
    expect(a.status).toBe(1);
    expect(a.stdout).toContain("nudo:entry-may-throw");
    expect(b.stdout).toContain("nudo:entry-may-throw");
  }
  {
    const { ts, cjs } = pair();
    const a = runCli(["export", "--format", "dts", "--out", join(ts, "..", "out"), ts]);
    const b = runCli(["export", "--format", "dts", "--out", join(cjs, "..", "out"), cjs]);
    expect(a.status, a.stdout + a.stderr).toBe(0);
    expect(a.stdout).not.toContain("No exported declarations found");
    const dts = readFileSync(join(ts, "..", "out", "t.d.ts"), "utf-8");
    expect(dts).toContain("declare function f(x: any): unknown;");
    expect(dts).toContain("export = f;");
    expect(b.status, b.stdout + b.stderr).toBe(0);
    const cts = readFileSync(join(cjs, "..", "out", "t.d.cts"), "utf-8");
    expect(cts).toContain("export = f;");
  }
  {
    const { ts } = pair();
    const r = runCli(["contract", "--draft", ts]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("export const f = fn(");
    expect(r.stdout).not.toContain("no draftable exports");
  }
});
});

// ---------------------------------------------------------------------------
// 单点调用观测不是函数域（BUG-213）
// ---------------------------------------------------------------------------
describe("单点调用观测不发布成校验器域", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function fixture(source: string): string {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b213-"));
    dirs.push(dir);
    const lib = join(dir, "lib.ts");
    writeFileSync(lib, source, "utf-8");
    return lib;
  }

  it("BUG-213 一个调用点也让 guard/zod 按基类型拓宽（不锁死字面量）", () => {
    const lib = fixture(
      `export function f(s: string): number { return s.length; }
export function u1() { return f("a"); }
export function u2() { return f("bb"); }
`,
    );
    const g = runCli(["export", "--format", "guard", lib]);
    expect(g.status, g.stdout + g.stderr).toBe(0);
    expect(g.stdout).toContain('typeof data === "number"');
    expect(g.stdout).not.toContain("data === 1");
    const s = runCli(["export", "--format", "schema", lib]);
    expect(s.status, s.stdout + s.stderr).toBe(0);
    expect(s.stdout).toContain("fInput = z.object({ s: z.string() })");
    expect(s.stdout).not.toContain('z.literal("a")');
    expect(s.stdout).not.toContain("z.union([z.string(), z.string()])");
  });

});
