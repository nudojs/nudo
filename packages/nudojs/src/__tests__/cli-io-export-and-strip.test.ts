/**
 * 模块套件：cli-io-export-and-strip（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, runCliTsx as runCli } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { migrateRetireMany, migrateStrip, migrateVerify } from "../migrate.ts";
import { abs } from "@nudojs/core";
import { zodInputSlots } from "../commands/export/zod-face.ts";


// ---------------------------------------------------------------------------
// CLI：可选槽吸收 undefined
// ---------------------------------------------------------------------------
describe("CLI：可选槽吸收 undefined", () => {
/**
 * （CLI e2e）：可选槽吸收 `undefined` —— TS 默认
 * `exactOptionalPropertyTypes: false` 下 `{ a?: string }` 的槽类型是
 * `string | undefined` ⇒ `f({ a: undefined })` 合法。
 *
 * 修前三道门各自判红（`leqAbs` 槽规则 / L1 调用点通道
 * `scan/literal-shapes.ts` / `@nudo:case` 见证通道 `check-case-scan.ts`），
 * 且 `nudo check` 的诊断（`typeof o.a = "string"`）与签名面（`a?: string`）
 * 自相矛盾，而 tsc 判绿。
 *
 * 这里走**真子进程**（`runCliTsx` + 绝对路径，`cwd` 保持 repo 根——CLI 的
 * `@nudojs/service/emit` 解析依赖 cwd，指向夹具目录会落进陈旧 dist）。
 * required 对照必须仍然 exit 1。
 */






const dir = mkdtempSync(join(tmpdir(), "nudo-bug-246-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OPTIONAL_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const f = fn({ o: shape({ a: string().optional() }) });
`;

/** required 对照侧车（函数名参与导出名，逐个夹具显式给）。 */
function requiredSidecar(name: string): string {
  return `import { fn, shape, string } from "@nudojs/core";

export const ${name} = fn({ o: shape({ a: string() }) });
`;
}

/** 落一对 `<name>.js` + `<name>.nudo.js` 侧车，返回主文件的**绝对路径**。 */
function fixture(name: string, sidecar: string, calls: string): string {
  writeFileSync(
    join(dir, `${name}.js`),
    `export function ${name}(o) {\n  return o.a;\n}\n\n${calls}\n`,
    "utf-8",
  );
  writeFileSync(join(dir, `${name}.nudo.js`), sidecar, "utf-8");
  return join(dir, `${name}.js`);
}

interface CliIssue {
  code: string;
  expected?: string;
}


  it("optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` ⇒ exit 0、无 constraint-violated；required 对照 + `{ a: undefined }` ⇒ exit 1 且报 nudo:constraint-violated；required 对照 + `{ a: 'x' }` ⇒ exit 0（对照组正例）", () => {
  {
    const file = fixture(
      "f",
      OPTIONAL_SIDECAR,
      `f({ a: undefined });\nf({});\nf({ a: "x" });`,
    );
    const r = runCli(["check", file, "--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      issues: CliIssue[];
      signatures: { name: string; paramTypes?: string[] }[];
    };
    expect(json.ok).toBe(true);
    expect(json.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
    // 签名面同样是可选位（引擎内部不再两面矛盾）
    expect(json.signatures[0]?.paramTypes).toEqual(["{ a?: string }"]);
  }
  {
    const file = fixture("g", requiredSidecar("g"), `g({ a: undefined });`);
    const r = runCli(["check", file, "--json"]);
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as { ok: boolean; issues: CliIssue[] };
    expect(json.ok).toBe(false);
    const vs = json.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(vs).toHaveLength(1);
    expect(vs[0]!.expected).toBe('typeof o.a = "string"');
  }
  {
    const file = fixture("g2", requiredSidecar("g2"), `g2({ a: "x" });`);
    const r = runCli(["check", file, "--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as { issues: CliIssue[] };
    expect(json.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  }
});



});


// ---------------------------------------------------------------------------
// rest 入参槽不得多包一层数组
// ---------------------------------------------------------------------------
describe("rest 入参槽不得多包一层数组", () => {
/**
 * `nudo export` 的 zod / standard 产物把**剩余参数**（`...args`）
 * 的入参槽**多包一层数组** ⇒ 导出的入参 schema 拒绝该函数自己的合法调用。
 *
 * 严格单变量：A 组（无调用点证据，只有 `entry@`）坏、B 组（同一函数 + 一行
 * 调用点）好 —— 两组的差别只在**见证的编码**：入口见证把剩余参数编码成**一个
 * 数组实参**（`entry@L1 (any[])`），调用点见证是「每个实参一个槽」。
 *
 * 钉：
 * - A 组 zod 槽 = `z.array(z.unknown())`（一层）；standard 节点同形；
 * - A 组 standard 校验器（Standard Schema 真跑）**接受** `{ args: [1, 2] }`；
 * - 对照组 B 组仍是**一层**数组，且接受同样的调用（同一函数的两个证据来源
 * 给出同一接受集）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NO_CALLSITE = "export function restOne(...args) {\n  return args.length;\n}\n";
const WITH_CALLSITE = `${NO_CALLSITE}restOne(1, 2, 3);\n`;

function fixture(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b279-"));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.js"), src, "utf-8");
  return dir;
}


  it("A 组（无调用点）：zod / standard 槽是一层数组，dts 同形；A 组 standard 校验器**接受**该函数自己的合法调用 `{args:[1,2]}`；对照组（有调用点证据）：同样是**一层**数组，接受集与 A 组一致", () => {
  {
    const dir = fixture(NO_CALLSITE);
    const schema = runCli(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    // rest 槽恒可选（zod 面 .optional()），仍是一层数组
    expect(schema.stdout).toContain("export const restOneInput = z.object({ args: z.array(z.unknown()).optional() })");
    expect(schema.stdout).not.toContain("z.array(z.array(");

    const std = runCli(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(std.status).toBe(0);
    expect(std.stdout).toContain('{"key":"args","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(std.stdout).not.toContain('{"key":"args","node":{"k":"arr","element":{"k":"arr"');

    const dts = runCli(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.stdout).toContain("...args: unknown[]");
  }
  {
    const dir = fixture(NO_CALLSITE);
    const out = join(dir, "out");
    expect(runCli(["export", join(dir, "lib.js"), "--format", "standard", "--out", out]).status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    // artifact 自带类型标注 ⇒ 复制成 .mts 交给 node 的 strip-types 求值
    writeFileSync(join(dir, "artifact.mts"), readFileSync(join(out, name!), "utf-8"), "utf-8");
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(join(dir, "artifact.mts"))});`,
        'const v = m.restOneInput["~standard"];',
        'console.log("one", "issues" in v.validate({ args: [1] }));',
        'console.log("two", "issues" in v.validate({ args: [1, 2] }));',
        'console.log("empty", "issues" in v.validate({ args: [] }));',
        "",
      ].join("\n"),
      "utf-8",
    );
    const run = spawnSync(process.execPath, ["--experimental-strip-types", probe], { encoding: "utf8" });
    const outText = `${run.stdout}${run.stderr}`;
    // 改前：one/two 都报「expected array, received number」
    expect(outText).toContain("one false");
    expect(outText).toContain("two false");
    expect(outText).toContain("empty false");
  }
  {
    const dir = fixture(WITH_CALLSITE);
    const schema = runCli(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    expect(schema.stdout).not.toContain("z.array(z.array(");
    expect(schema.stdout).toMatch(/export const restOneInput = z\.object\(\{ args: z\.array\(z\.(union|unknown)/);
  }
});



});


// ---------------------------------------------------------------------------
// --gha --gitlab 两个通道都不丢
// ---------------------------------------------------------------------------
describe("--gha --gitlab 两个通道都不丢", () => {
/**
 * `check --gha --gitlab`（**非** `--json`）⇒ GHA 注解整段丢弃
 * （`::error` 计数 0），而同一语义只多一个无关的 `--json` 就恢复 ⇒
 * 「同一语义两种写法两个结论」。
 *
 * 现在：非 `--json` 面遇 `--gitlab`（stdout 被 Code Quality 数组占住）时
 * GHA 注解**改走 stderr**（与 `--json` 分支同形），一个通道都不丢。
 */






/** 真实 L1 错误：侧车要求 n > 0，调用点传 -1 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const boom = fn({ n: number().gt(0) });
`;
const SRC = `boom(-1);
export function boom(n) {
  return n;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug285-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b285", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "err.nudo.js"), SIDECAR, "utf-8");
  writeFileSync(join(cwd, "err.js"), SRC, "utf-8");
  return cwd;
}

const annCount = (r: { stdout: string; stderr: string }): number =>
  `${r.stdout}${r.stderr}`.split("::error").length - 1;

describe("-gha --gitlab 两个通道都不丢", () => {
  it("--gha 单独 ⇒ 注解在 stdout（不回归）；--gha --gitlab ⇒ stdout 仍是 GitLab 数组、stderr 有 ::error（不被丢弃）；单变量对照：加 --json 后 GHA 计数不变（不再取决于无关旗标）", () => {
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "--gha", "err.js"], { cwd });
      expect(r.status).toBe(1);
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(r.stdout).toContain("::error");
      expect(r.stderr).not.toContain("::error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "--gha", "--gitlab", "err.js"], { cwd });
      expect(r.status).toBe(1);
      // stdout 契约：恰好一份 Code Quality 数组
      const rows = JSON.parse(r.stdout) as Array<{ check_name: string }>;
      expect(Array.isArray(rows)).toBe(true);
      // 用户点名的 GHA 通道不得静默消失
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(r.stderr).toContain("::error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const both = runCli(["check", "--gha", "--gitlab", "err.js"], { cwd });
      const withJson = runCli(
        ["check", "--json", "--gha", "--gitlab", "err.js"],
        { cwd },
      );
      expect(annCount(withJson)).toBeGreaterThanOrEqual(1);
      expect(annCount(both)).toBe(annCount(withJson));
      expect(withJson.stdout.trimStart().startsWith("{")).toBe(true);
      expect(both.stdout.trimStart().startsWith("[")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});


});
});


// ---------------------------------------------------------------------------
// --from 的跨文件调用点证据必须进入 drift 判定
// ---------------------------------------------------------------------------
describe("--from 的跨文件调用点证据必须进入 drift 判定", () => {
/**
 * `nudo check --from <使用现场文件>` 必须能判出**跨文件**调用点
 * 带来的生成段陈旧（`nudo:contract-drift`）。
 *
 * 症状（改前）：drift 的「今日域」证据**只**来自 checkSource 评估**被检查
 * 文件自身**时产生的 AbsCallRecord ⇒ 调用点在别的文件里时，`--from` 写出的
 * 生成段**永远判不出陈旧**（落盘契约静默陈旧，0 warning 假绿）。
 *
 * 修法（族 07 · S5）：core 的 `CheckOptions.from`（可选字段
 * `from?: readonly AbsCallRecord[]`）接进同一条 drift 判定通道；service 侧
 * `externalAbsCallRecords` 负责**归因**（只收指向本文件的记录 ⇒ 别的模块里
 * 的同名函数不污染本文件的判定）；nudojs 侧把 `--from` 采集的记录接进
 * `checkSource`。
 *
 * runner 注：spawn 型 CLI 子进程对 @nudojs/* 的解析不经 vitest 别名 ⇒ 子进程
 * cwd 下的 tsconfig.json paths（绝对路径指向 src）保证测试面与本仓 src 一致。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程 tsx 用 tsconfig：@nudojs/* → 仓内 src（vitest 别名的子进程面） */
const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [`${repoRoot}packages/core/src`],
        "@nudojs/core/exec": [`${repoRoot}packages/core/src/algebra/exec/index.ts`],
        "@nudojs/core/internal": [`${repoRoot}packages/core/src/internal.ts`],
        "@nudojs/parser": [`${repoRoot}packages/parser/src`],
        "@nudojs/service": [`${repoRoot}packages/service/src`],
        "@nudojs/service/emit": [`${repoRoot}packages/service/src/emit/index.ts`],
        "@nudojs/service/evaluator": [
          `${repoRoot}packages/service/src/evaluator/evaluator-api.ts`,
        ],
        "@nudojs/env/es": [`${repoRoot}packages/env/src/es.ts`],
        "@nudojs/env/web": [`${repoRoot}packages/env/src/web.ts`],
        "@nudojs/env/node": [`${repoRoot}packages/env/src/node.ts`],
        "@nudojs/harvester": [`${repoRoot}packages/harvester/src`],
      },
    },
  },
  null,
  2,
)}\n`;

/**
 * 夹具：`lib.js` 的实现已漂移（number → string），而固化生成段 `lib.nudo.js`
 * 仍是 `fn({ x: lit(5) }, lit(6))`；调用点在**另一个文件** `usage.js` 里。
 */
const FILES = {
  "lib.js": [
    "export function addOne(x) {",
    '  return String(x) + "!";',
    "}",
    "",
  ].join("\n"),
  "lib.nudo.js": [
    "// @generated by nudo - do not edit",
    "// source: lib.js:addOne",
    "export const addOne = fn({ x: lit(5) }, lit(6));",
    "",
  ].join("\n"),
  "usage.js": [
    'import { addOne } from "./lib.js";',
    "addOne(5);",
    "",
  ].join("\n"),
};

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-366-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("-from 的跨文件调用点证据必须进入 drift 判定", () => {
  it("check --from <使用现场> -- <被检查文件> ⇒ 报 nudo:contract-drift（改前 0 条）；控制组：没有跨文件证据 ⇒ 不报 drift（无证据不判）；归因闸：别的模块的同名调用点证据不得污染本文件的判定", () => {
  {
    const dir = fixtureDir(FILES);
    const r = runCli(
      ["check", "--json", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nudo:contract-drift");
    expect(r.stdout).toContain("addOne[return]");
  }
  {
    const dir = fixtureDir(FILES);
    const r = runCli(["check", "--json", "lib.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("nudo:contract-drift");
  }
  {
    const dir = fixtureDir({
      ...FILES,
      "other.js": [
        "export function addOne(x) {",
        '  return String(x) + "!";',
        "}",
        "",
      ].join("\n"),
      "other.nudo.js": [
        "// @generated by nudo - do not edit",
        "// source: other.js:addOne",
        "export const addOne = fn({ x: lit(5) }, lit(6));",
        "",
      ].join("\n"),
    });
    const r = runCli(
      ["check", "--json", "--from", "usage.js", "--", "other.js"],
      { cwd: dir },
    );
    expect(r.stdout).not.toContain("nudo:contract-drift");
  }
});


});
});


// ---------------------------------------------------------------------------
// export — 数组解构形参的输入面（族 08 · S5 · ）
// ---------------------------------------------------------------------------
describe("export — 数组解构形参的输入面（族 08 · S5 · ）", () => {
/**
 * （**nudojs 侧**，zod / standard 产物面）：**数组解构**形参的字段级
 * 侧车契约被摊成**对象槽** ⇒ 产物的输入面与真实形参形态**完全颠倒**。
 *
 * 症状（改前）：`export function f7([a, b])` + 侧车契约 `fn({ a: number() })`
 * ⇒ zod 给出 `f7Input = z.object({ a: z.number()… })`
 * —— 校验器要求一个**键名叫 `a`** 的属性，而真实调用传的是**数组**
 * ⇒ 合法的数组调用被判红、非法的对象调用被放行（与真实形参形态完全颠倒）。
 *
 * 根因：统一参数面（`export/contract-face.ts`）按**绑定名**收侧车契约，
 * 而数组解构的绑定名是**元素下标**（`[a, b]` 的 `a` 是下标 0 的元素）⇒
 * 必须**按下标**合成**元组槽**，不能摊成对象槽。
 *
 * 修法（产物面兜底，`packages/nudojs/src/commands/export.ts`）：把该形参的
 * 字段级槽合成**一个元组槽**（元素位按下标寻址，未契约的位置留 `any`）。
 *
 * 钉：
 * - zod 入参面是**元组**（改前是对象槽）；
 * - standard 面的槽节点是**元组**；
 * - 负控制：**对象解构**的字段级契约仍摊成对象槽（既有口径不变）；
 * - 负控制：无契约的数组解构仍是观测元组（既有口径不变）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b394-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const ARRAY_SRC = `export function f7([a, b]) { return a; }
f7([1, 2]);
`;

const ARRAY_SIDECAR = `import { fn, number } from "@nudojs/core";
export const f7 = fn({ a: number() }, number());
`;

const OBJECT_SRC = `export function f7({ a, b }) { return a; }
f7({ a: 1, b: 2 });
`;

const OBJECT_SIDECAR = `import { fn, number } from "@nudojs/core";
export const f7 = fn({ a: number() }, number());
`;


  it("zod 入参面：数组解构 + 字段级契约 ⇒ 元组槽（改前是对象槽 `a`）；standard 面：数组解构形参的槽节点是元组；负控制：对象解构 + 字段级契约仍摊成对象槽（既有口径不变）；负控制：无契约的数组解构仍是观测元组（既有口径不变）", () => {
  {
    const dir = fixture({ "m394.js": ARRAY_SRC, "m394.nudo.js": ARRAY_SIDECAR });
    const r = runCli(["export", join(dir, "m394.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    // 改前的形态：对象槽按绑定名摊开
    expect(r.stdout).not.toContain("z.object({ a:");
  }
  {
    const dir = fixture({ "m394s.js": ARRAY_SRC, "m394s.nudo.js": ARRAY_SIDECAR });
    const r = runCli(["export", join(dir, "m394s.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"k":"tuple"');
    expect(r.stdout).not.toContain('"key":"a"');
  }
  {
    const dir = fixture({ "m394o.js": OBJECT_SRC, "m394o.nudo.js": OBJECT_SIDECAR });
    const r = runCli(["export", join(dir, "m394o.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.object({ a:");
  }
  {
    const dir = fixture({ "m394n.js": ARRAY_SRC });
    const r = runCli(["export", join(dir, "m394n.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    expect(r.stdout).not.toContain("z.object({ a:");
  }
});




});


// ---------------------------------------------------------------------------
// --what-if --target 指向函数时不再打出 `?`
// ---------------------------------------------------------------------------
describe("--what-if --target 指向函数时不再打出 `?`", () => {
/**
 * `nudo check --what-if --target <函数名>` 把函数的**返回域**渲染成
 * 占位符 `?`（`() => ? #exact`）。
 *
 * 症状（改前）：
 * ```
 * $ nudo check c.js --what-if raw:string --target useRaw
 * Type of "useRaw": () => ? #exact
 * ```
 * 而**同一份文件**的签名表里写着 `useRaw() => 3` ⇒ 两条面互相矛盾；`?` 既不是
 * 合法 TS 类型也不是 Nudo 的类型记号（对 AI/agent 消费者等于「返回域未知」）。
 *
 * 根因：`--target` 走 `result.bindings`（顶层绑定 Abs，其 fn 形状**没有**
 * `returnType`）⇒ `formatAbs` 走 fn 臂的 `?` 兜底；签名表走的是**另一条面**
 * （`result.functions` / `combinedAbs`）⇒ 同一个函数被两条面取成两个 Abs。
 *
 * 修法（族 09 · S1 · 路线 ①）：`--target` 命中**函数名** ⇒ 改从
 * `result.functions` 取该函数的 `combinedAbs`（真实返回域）补进绑定 fn 形状
 * 缺失的 `returnType` 再渲染；取不到（非函数 / 无 `combinedAbs`）才回落到
 * `result.bindings`。**不动** `formatShape` 的 `?` 兜底（`?` 是 Nudo 内部
 * 占位符，既有产物依赖它）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-405-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SRC = [
  `const raw = "abc";`,
  ``,
  `export const useRaw = () => raw.length;`,
  ``,
].join("\n");

describe("-what-if --target 指向函数时不再打出 `?`", () => {
  it("--target 指向函数名：返回域取自函数面（不再是 `() => ?`）；两条面不再互相矛盾：--target 的返回域与签名表一致；控制：--target 指向非函数绑定时行为不变；控制：--target 指向不存在的名字时仍是 unknown", () => {
  {
    const dir = fixture({ "w405.js": SRC });
    const r = runCli([
      "check",
      join(dir, "w405.js"),
      "--what-if",
      "raw:string",
      "--target",
      "useRaw",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "useRaw":');
    // 改前：`Type of "useRaw": () => ? #exact`
    expect(r.stdout).not.toContain("=> ?");
    expect(r.stdout).toContain("() => number");
  }
  {
    const dir = fixture({ "w405b.js": SRC });
    const whatIf = runCli([
      "check",
      join(dir, "w405b.js"),
      "--what-if",
      "raw:string",
      "--target",
      "useRaw",
    ]);
    const table = runCli(["check", join(dir, "w405b.js")]);
    expect(whatIf.status).toBe(0);
    expect(table.status).toBe(0);
    // 签名表：`useRaw() => 3`（字面量视图）
    expect(table.stdout).toContain("useRaw() =>");
    expect(table.stdout).not.toContain("=> ?");
    // --target：返回域视图（number），与签名表同属一个返回域
    expect(whatIf.stdout).toContain("() => number");
  }
  {
    const dir = fixture({ "w405c.js": SRC });
    const r = runCli([
      "check",
      join(dir, "w405c.js"),
      "--what-if",
      "raw:string",
      "--target",
      "raw",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "raw": string');
    expect(r.stdout).not.toContain("=> ?");
  }
  {
    const dir = fixture({ "w405d.js": SRC });
    const r = runCli([
      "check",
      join(dir, "w405d.js"),
      "--what-if",
      "raw:string",
      "--target",
      "nope",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "nope": unknown');
  }
});



});
});


// ---------------------------------------------------------------------------
// strip 产物不得残留「值位置的类型专用导入」（产物可加载）
// ---------------------------------------------------------------------------
describe("strip 产物不得残留「值位置的类型专用导入」（产物可加载）", () => {
/**
 * 值位置的「类型专用导入」未消除 ⇒ 产物 Node **加载不了**
 * （ESM 链接期 `SyntaxError: does not provide an export named 'Foo'`），
 * 而 `migrate strip` / `migrate verify` 双双绿灯。
 *
 * **真源**：`packages/core/src/strip-types.ts`（值位置引用收集 ⇒ 与 tsc 的
 * import elision 同口径）。本钉是**产物面**的回归钉：产物必须能被 Node
 * **真实加载**（`node --check` 只验语法、抓不到本条的链接失败）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TYPES_TS = `export interface Foo { id: string; }
`;
const USE_TS = `import { Foo } from "./types.js";
export function use(f: Foo): string { return "ok"; }
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 真 ESM 加载（链接期检查 —— `node --check` 抓不到这一层） */
function esmLoad(path: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(`file://${path}`)}).then(()=>console.log("LOAD OK")).catch(e=>{console.log("LOAD ERROR:", e.constructor.name+":", e.message); process.exitCode=1;});`,
    ],
    { encoding: "utf-8" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}


  it("类型专用的值位置 import 被消掉 ⇒ 产物 `node --check` 过且真 import() 成功；产物里的 import 不得指向「没有该运行时导出」的模块（链接面）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "use.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // 类型专用的绑定不得留在产物里（tsc 的 import elision 同口径）
    expect(code).not.toContain("Foo");
    expect(code).not.toContain("types.js");

    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);

    // 核心证据：**真加载**（被 import 的模块被剥成空模块 ⇒ 链接期 SyntaxError）
    const load = esmLoad(product);
    expect(load.status, `${load.stdout}\n${load.stderr}`).toBe(0);
    expect(load.stdout).toContain("LOAD OK");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    // 被 import 的模块剥成空模块 ⇒ 任何残留的具名 import 都会链接失败
    const types = readFileSync(join(dir, "types.js"), "utf-8");
    expect(types.trim()).toBe("");
    const use = readFileSync(join(dir, "use.js"), "utf-8");
    expect(use).not.toMatch(/import\s/);
  }
});


});


// ---------------------------------------------------------------------------
// 类成员的 `x!` / `y?` / `m?()` 必须被剥除（产物是合法 JS）
// ---------------------------------------------------------------------------
describe("类成员的 `x!` / `y?` / `m?()` 必须被剥除（产物是合法 JS）", () => {
/**
 * 类成员的 `x!`（确定赋值断言）与 `y?` / `m?()`（可选成员）未剥
 * ⇒ 产物**不是合法 JS**（`node --check` 报 `SyntaxError: Unexpected token
 * '!'` / `'?'`）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（类成员节点族上的 `definite`
 * 与 `optional` 删除）。本钉是**产物面**的回归钉：产物必须 `node --check`
 * 过，且不得残留 `x!` / `y?` / `m?()`。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const FIELDS_TS = `export class A {
  x!: number;
  y?: string;
}
`;
const OPTIONAL_METHOD_TS = `export class A {
  m?(): void {}
}
export const z = 1;
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}


  it("字段的 `x!` / `y?` 被剥 ⇒ 产物 `node --check` 过；可选方法 `m?()` 被剥 ⇒ 产物 `node --check` 过", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447-"));
    dirs.push(dir);
    writeFileSync(join(dir, "f3.ts"), FIELDS_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "f3.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "f3.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("x!");
    expect(code).not.toContain("y?");
    expect(code).toContain("x;");
    expect(code).toContain("y;");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "om.ts"), OPTIONAL_METHOD_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "om.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "om.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("m?()");
    expect(code).toContain("m() {}");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
});


});


// ---------------------------------------------------------------------------
// TS 的 `this` 形参必须被剥除（产物可加载）
// ---------------------------------------------------------------------------
describe("TS 的 `this` 形参必须被剥除（产物可加载）", () => {
/**
 * TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` **Node 根本
 * 加载不了**（strict 与 sloppy 都不允许 `this` 作形参名），而 `migrate strip`
 * 报「wrote」/ exit 0。
 *
 * **真源**：`packages/core/src/strip-types.ts`（把 `this` 形参从**形参数组**
 * 里删掉，与 tsc 的 emitter 同口径）。本钉是**产物面**的回归钉：产物必须
 * `node --check` 过，且形参表里不得再有 `this`。
 *
 * ⚠ 验收口径是「**strip 不产出坏产物**」——`migrate verify` 的契约是「跑
 * `nudo check`」，**不在**族 12 的改动范围（跨族增强须先改文档）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const THIS_PARAM_TS = `export function f(this: { x: number }, a: number): number {
  return a + 1;
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}


  it("`this` 形参被剥 ⇒ 产物 `node --check` 过且形参表只剩 `a`；函数体里的 `this` **表达式**必须保留（只有形参位被删）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448-"));
    dirs.push(dir);
    writeFileSync(join(dir, "thisparam.ts"), THIS_PARAM_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "thisparam.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "thisparam.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("export function f(a)");
    expect(code).not.toContain("f(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448b-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "body.ts"),
      `export function g(this: { x: number }) { return this.x; }\n`,
      "utf-8",
    );

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "body.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "body.js");
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("this.x");
    expect(code).not.toContain("g(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
});


});


// ---------------------------------------------------------------------------
// 族 56 · CLI 面 3 条
// ---------------------------------------------------------------------------
describe("CLI 面 3 条", () => {
/**
 * 族 56 · nudojs **CLI 面** 3 条（机器消费者能看见的问题）：
 *
 * | # | 项 | 断言要点 |
 * |---|---|---|
 * | 1 | **排除清单未上 stdout** | 排除清单（pnpm 负向模式命中的包）此前**只在 stderr** ⇒ 机器消费者看不到「哪些包被排除了」。现在它在 **stdout 的机器面**（`--json`）可解析：`excluded` 字段（相对扫描根的 posix 路径，与 stderr 那行逐字一致）。**无排除 ⇒ JSON 逐字不变**（负控）。 |
 * | 2 | **M5 的 `migrateRetireMany` 原子性** | 原子性（任一失败 ⇒ 整批零写盘）**不变**；但错误消息此前**只带第一个失败目标** ⇒ 其余失败目标丢失。现在消息**列出全部失败目标**（人读消息 + `--json` 的 `failedTargets`）。 |
 * | 3 | **verify 的扫描面不含 `.jsx`**〔跨族〕 | `migrate verify` 此前复用 service 的 `isNudoTargetPath`（排除 `.jsx`）⇒ **JSX 产物对 verify 不可见** ⇒ 迁移闸门对不可加载的产物发绿灯。verify 现在**自己算扫描面**（含 `.jsx` / `.tsx` / `.cjs`），**service 侧仍是根因**（本片只做 CLI 侧兜底）。 |
 *
 * 反向闸（断言非永真）：
 * - 排除清单：无排除的 workspace ⇒ `--json` 里**不出现** `excluded` 键（stdout 逐字不变）。
 * - 失败清单：单个失败 ⇒ 消息与旧实现**逐字同形**（`<原因> (target: <目标>)`）。
 * - 扫描面：`.d.ts` 声明 / `*.nudo.js` 侧车**仍不是** verify 的目标（同口径不变）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** pnpm workspace：`packages/*` + 负向模式 `!packages/legacy` */
function workspaceFixture(): { dir: string; app: string; legacy: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-ws-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', '  - "!packages/legacy"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-56", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  const legacy = join(dir, "packages", "legacy");
  mkdirSync(app, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  const pkg = JSON.stringify({
    name: "app-56",
    version: "1.0.0",
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: { typescript: "^5.0.0" },
  });
  writeFileSync(join(app, "package.json"), pkg, "utf-8");
  writeFileSync(join(legacy, "package.json"), pkg, "utf-8");
  return { dir, app, legacy };
}

/** 无任何排除模式的 workspace（负控：stdout 逐字不变） */
function cleanWorkspaceFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-clean-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "clean-56", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "app-56-clean",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

/** 无 tsc/typescript 的包（退役时报「nothing to retire」） */
function plainPkg(name: string): { dir: string; before: string } {
  const dir = mkdtempSync(join(tmpdir(), `nudo-cli-56-${name}-`));
  dirs.push(dir);
  const before = `${JSON.stringify({ name, version: "1.0.0" }, null, 2)}\n`;
  writeFileSync(join(dir, "package.json"), before, "utf-8");
  return { dir, before };
}

/** 畸形清单（真错误，不是「无可退役」） */
function brokenPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-cli-56-${name}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"${name}", broken json`, "utf-8");
  return dir;
}

/** verify 的扫描面 fixture：`.jsx` 产物 + 声明 + 侧车 */
function verifyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-verify-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "Comp.jsx"),
    "export function Comp(props) {\n  return <div className=\"x\">{props.name}</div>;\n}\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "types.d.ts"),
    "export declare function foo(x: number): string;\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "sidecar.nudo.js"),
    "export const fooContract = {};\n",
    "utf-8",
  );
  return dir;
}


  it("排除清单上 stdout（--json 面可解析；文本面 stdout 不含被排除的包）；retire --all --json 同样带排除清单（机器面统一口径）；负控：无排除的 workspace ⇒ --json 逐字不变（不出现 excluded 键）；多个目标失败 ⇒ 消息列出**全部**失败目标，且整批零写盘；CLI 面 —— 失败目标全部可见（文本面 + --json 的 failedTargets）", () => {
  {
    const { dir, legacy } = workspaceFixture();
    const r = runCli(["migrate", "status", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string; excluded?: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    // 机器面：每行都带**同一份**排除清单（相对扫描根的 posix 路径）
    for (const row of parsed) {
      expect(row.excluded).toEqual(["packages/legacy"]);
    }
    // 被排除的包**不**进 status（排除 ≠ 审计对象）
    expect(parsed.map((row) => row.root).join(" ")).not.toContain("legacy");

    // 文本面：stdout 逐字**不含**被排除的包（人读提示仍在 stderr）
    const text = runCli(["migrate", "status", dir]);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).not.toContain("packages/legacy");
    expect(text.stderr).toContain("skipped (pnpm excluded)");
    // 反向闸：被排除的包真的在工作区里（否则上面的断言是永真）
    expect(existsSync(join(legacy, "package.json"))).toBe(true);
  }
  {
    const { dir } = workspaceFixture();
    const r = runCli(["migrate", "retire", "--all", "--dry-run", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string; excluded?: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(row.excluded).toEqual(["packages/legacy"]);
    }
  }
  {
    const dir = cleanWorkspaceFixture();
    const r = runCli(["migrate", "status", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("excluded");
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(Object.keys(row)).not.toContain("excluded");
    }
  }
  {
    const a = plainPkg("plain-a");
    const b = plainPkg("plain-b");
    let err: Error | undefined;
    try {
      migrateRetireMany([a.dir, b.dir], { workflows: false });
    } catch (e) {
      err = e as Error;
    }
    expect(err, "两个目标都无可退役 ⇒ 必须抛错").toBeDefined();
    // 全部失败目标都在消息里（改前：只带第一个 ⇒ 另一个丢失）
    expect(err!.message).toContain(a.dir);
    expect(err!.message).toContain(b.dir);
    // 原子性**不变**：整批零写盘
    expect(readFileSync(join(a.dir, "package.json"), "utf-8")).toBe(a.before);
    expect(readFileSync(join(b.dir, "package.json"), "utf-8")).toBe(b.before);
    expect(existsSync(join(a.dir, ".nudo"))).toBe(false);
    expect(existsSync(join(b.dir, ".nudo"))).toBe(false);
  }
  {
    const a = plainPkg("cli-plain-a");
    const b = plainPkg("cli-plain-b");
    const r = runCli(["migrate", "retire", a.dir, b.dir]);
    expect(r.status).toBe(0); // 「无可退役」是正常结果（口径不变）
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(a.dir);
    expect(all).toContain(b.dir);

    const j = runCli(["migrate", "retire", a.dir, b.dir, "--json"]);
    expect(j.status).toBe(0);
    // `--json` 顶层形状**恒为数组**（成功信封也是单元素数组）
    const envelope = JSON.parse(j.stdout) as Array<{
      ok: boolean;
      failedTargets?: Array<{ target: string; message: string }>;
    }>;
    expect(Array.isArray(envelope)).toBe(true);
    const parsed = envelope[0]!;
    expect(parsed.ok).toBe(true);
    expect(parsed.failedTargets).toHaveLength(2);
    expect(parsed.failedTargets!.map((f) => f.target)).toEqual([a.dir, b.dir]);
  }
  {
    const plain = plainPkg("mix-plain");
    const broken = brokenPkg("mix-broken");
    const r = runCli(["migrate", "retire", plain.dir, broken]);
    expect(r.status).toBe(1);
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(plain.dir);
    expect(all).toContain(broken);
    expect(all).toContain("package.json parse failed");
    // 原子性：整批零写盘
    expect(readFileSync(join(plain.dir, "package.json"), "utf-8")).toBe(plain.before);
  }
  {
    const plain = plainPkg("single-plain");
    let err: Error | undefined;
    try {
      migrateRetireMany([plain.dir], { workflows: false });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toBe(
      `nothing to retire (no tsc/typescript in scope) (target: ${plain.dir})`,
    );
  }
  {
    const dir = verifyFixture();
    const r = runCli(["migrate", "verify", dir]);
    // 改前：`.jsx` 不可见 ⇒ verify 只看到 .js 目标（本 fixture 里一个都没有 ⇒
    // 走「空集 ⇒ 判红」分支），JSX 产物从未被验过。
    expect(r.stdout).toContain("Comp.jsx");
    expect(r.stdout).not.toContain("Not an analysis target");

    // 显式点名的 `.jsx` 目标也不再被拒（改前：not-a-target）
    const one = runCli(["migrate", "verify", join(dir, "Comp.jsx")]);
    expect(one.stdout).toContain("Comp.jsx");
    expect(one.stdout).not.toContain("Not an analysis target");
  }
  {
    const dir = verifyFixture();
    const r = runCli(["migrate", "verify", dir]);
    expect(r.stdout).not.toContain("types.d.ts");
    expect(r.stdout).not.toContain("sidecar.nudo.js");
    // 显式点名的声明文件仍被拒（消息口径不变）
    const decl = runCli(["migrate", "verify", join(dir, "types.d.ts")]);
    expect(decl.status).toBe(1);
    expect(`${decl.stdout}${decl.stderr}`).toContain("Not an analysis target");
  }
});









});


// ---------------------------------------------------------------------------
// 族 56b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）
// ---------------------------------------------------------------------------
describe("b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）", () => {
/**
 * 族 56b · 的**库面半边** —— `migrateStrip` 的**逐文件错误隔离**。
 *
 * 背景（台账原描述「`migrate verify` 库面整批 abort」经 W4 取证**已不成立**）：
 * `migrateVerify` 早已逐文件隔离（同目标内部分文件语法错 ⇒ 失败文件记
 * `analysis-error`、成功文件照常返回）；仍整批 abort 的是同族的 `migrateStrip`
 * ——`planStrip` → `makeStripPlan` 遇解析错即 `throw` ⇒ 同目标内其它文件的
 * 成功结果**全丢**（且与 verify 的口径不一致）。
 *
 * 本片修法：解析失败**降级成一行错误**（结构与 `migrateVerify` 的逐文件错误行
 * **同款**：`code` + `error`，`error` 带文件名）⇒ 库面与 verify 同口径。
 *
 * 必须保持的不变量：
 * 1. **整批零写盘的原子性不变**（任一文件失败 ⇒ 不写任何产物）——正确形态是
 * 「**先算完全部结果（含错误行）⇒ 再决定写不写**」，**不是**部分写盘。
 * 2. **CLI 面的既有行为与 stdout 逐字不变**（既有金标钉了 `migrate strip` 的
 * 输出）⇒ CLI 侧把失败行映射回**旧版逐字同形**的失败条目。
 *
 * 反向闸（断言非永真）：
 * - 混合目录（好文件 + 语法错文件）⇒ 库面**不 throw**、好文件的行**仍返回**；
 * - 同一目录**零写盘**（连好文件也不落盘）；
 * - 失败行**带文件名** + 失败码与 `migrateVerify` **同码**；
 * - 负控：**全部成功**时，返回行的字段**逐字不变**（无 `code` / `error` 键）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-56b-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}


  it("同目标内一个文件语法错 ⇒ 库面不 throw + 成功文件的结果仍返回；原子性仍成立 ⇒ 有失败时一个字节都不落盘（含好文件）；失败行带文件名 + 失败码与 migrateVerify 同码（同款结构）；负控：全部成功 ⇒ 返回行的字段逐字不变（无 code / error 键）；CLI 面：失败目标的 stdout/stderr 与旧版逐字同形（失败详情带文件名）", async () => {
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    const rows = await migrateStrip([dir], { write: true, draft: false });

    // 好文件的行**仍返回**（改前：整批 throw ⇒ 全丢）
    const good = rows.filter((r) => r.file.endsWith("a-good.ts"));
    expect(good).toHaveLength(1);
    expect(good[0]!.outFile.endsWith("a-good.js")).toBe(true);
    // 成功行不带失败字段
    expect(good[0]!.code).toBeUndefined();
    expect(good[0]!.error).toBeUndefined();
    // 失败文件记一行错误（不抛）
    const bad = rows.filter((r) => r.file.endsWith("z-bad.ts"));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.code).toBeTruthy();
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    await migrateStrip([dir], { write: true, draft: false });

    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    const stripRows = await migrateStrip([dir], { write: false, draft: false });
    const stripFail = stripRows.find((r) => r.code !== undefined);
    expect(stripFail).toBeDefined();
    // 文件名：错误行自带文件名（定位用）
    expect(String(stripFail!.error)).toContain("z-bad.ts");
    expect(stripFail!.file.endsWith("z-bad.ts")).toBe(true);
    // 结构与 migrateVerify 的逐文件错误行同款：`code` + `error` 两个可选字段
    expect(typeof stripFail!.code).toBe("string");
    expect(typeof stripFail!.error).toBe("string");

    // 同码：verify 对同一个语法错文件发的失败码与 strip **一致**
    const verifyRows = await migrateVerify([join(dir, "z-bad.ts")]);
    const verifyFail = verifyRows.find((r) => r.nudoOk === false);
    expect(verifyFail).toBeDefined();
    expect(stripFail!.code).toBe(verifyFail!.code);
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD });

    const rows = await migrateStrip([dir], { write: false, draft: false });

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["file", "notes", "outFile"]);
    expect(rows[0]!.notes).toEqual([]);
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", dir]);
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{
      ok?: boolean;
      action?: string;
      results?: unknown[];
      pathErrors?: Array<{ path: string; code: string; message: string }>;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 失败详情带**文件名**（机器面）
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0]?.message).toContain("z-bad.ts");
    expect(parsed.pathErrors?.[0]?.code).toBe("nudo:migrate-strip-failed");
    expect(r.stderr).toContain("z-bad.ts");
  }
});





});


// ---------------------------------------------------------------------------
// export --format standard 的 helper 只声明一次
// ---------------------------------------------------------------------------
describe("export --format standard 的 helper 只声明一次", () => {
/**
 * `nudo export --format standard` 到 stdout 时产出**重复的 helper 声明**
 * （TS2393 / TS2300 ⇒ 产物不可用）。
 *
 * 机制（AGENT-CONTEXT §4 已裁决）：产物头**没有** helper；helper 是 service 侧
 * `absToStandardSchemaFunction` 的模块装配在**每个 per-function 模块**里内联的
 * 一份（`__nudoCheck` / `__nudoTypeOf` / `NudoSchemaNode` …）⇒ stdout 平铺 N 份
 * = N 次同名声明。
 *
 * 修法（stdout 面，S5）：standard 各块的**公共前导**（banner + helper）只发一次。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：两个导出函数（standard 面 ⇒ 两块 ⇒ 两份 helper）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-601-"));
  dirs.push(dir);
  const file = join(dir, "two.js");
  writeFileSync(
    file,
    "export function alpha(x) { return x + 1; }\nexport function beta(x) { return x + 2; }\n",
    "utf-8",
  );
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}


  it("stdout 里 helper / 类型别名各只出现一次（两个函数 ⇒ 两块）；剥前导不丢内容：两个函数的导出体都在；--out 落盘不变（每函数一份文件，各带一份 helper ⇒ 互不冲突）", () => {
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^function __nudoTypeOf/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoCheck/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoDescribe/gm)).toBe(1);
    expect(count(r.stdout, /^type NudoSchemaNode =/gm)).toBe(1);
    expect(count(r.stdout, /^const __nudoBrandCtors =/gm)).toBe(1);
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const alpha_x");
    expect(r.stdout).toContain("export const beta_x");
    expect(r.stdout).toContain("export const alphaInput");
    expect(r.stdout).toContain("export const betaInput");
    expect(r.stdout).toContain("// === alpha Standard Schema ===");
    expect(r.stdout).toContain("// === beta Standard Schema ===");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-601-out-"));
    dirs.push(dir);
    const file = join(dir, "two.js");
    writeFileSync(
      file,
      "export function alpha(x) { return x + 1; }\nexport function beta(x) { return x + 2; }\n",
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    // 产物文件名由 S4 决定 ⇒ 只断言「每个 standard 产物自带一份 helper」
    const files = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    expect(files.length).toBe(2);
    for (const name of files) {
      const body = readFileSync(join(out, name), "utf-8");
      expect(count(body, /^function __nudoCheck/gm)).toBe(1);
      expect(count(body, /^type NudoSchemaNode =/gm)).toBe(1);
    }
  }
});



});


// ---------------------------------------------------------------------------
// export --format all 到 stdout：`<fn>Output` 不跨段撞名
// ---------------------------------------------------------------------------
describe("export --format all 到 stdout：`<fn>Output` 不跨段撞名", () => {
/**
 * `nudo export --format all` 到 stdout：zod 段与 standard 段的
 * `<fn>Output` **同名** ⇒ 同一模块作用域里 TS2451 ⇒ 产物不可用。
 *
 * 机制：stdout 把四个方言**平铺**进同一模块作用域，导出名无前缀 / 无去重 ⇒
 * zod 段（`<fn>Output`）与 standard 段（`<fn>Output`）必然撞名。
 *
 * 修法（stdout 面，S5）：跨段顶层标识符去重——先到先得，后段改名
 * （`<fn>Output` → `<fn>OutputStandard`）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：一个导出函数（zod 段 + standard 段各有 `<fn>Output` ⇒ 单函数即触发）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-602-"));
  dirs.push(dir);
  const file = join(dir, "one.js");
  writeFileSync(file, "export function foo() { return 1; }\n", "utf-8");
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * stdout 流里的**重复顶层声明**（导出名 + 非导出声明）。
 *
 * 一个 TS 模块作用域里同名声明只能出现一次 ⇒ 重复即产物不可用。
 */
function duplicateTopLevelNames(text: string): string[] {
  const decl =
    /^(?:export\s+(?:declare\s+)?)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const line of text.split("\n")) {
    const m = decl.exec(line);
    if (m === null) continue;
    const name = m[1]!;
    if (seen.has(name)) dup.add(name);
    seen.add(name);
  }
  return [...dup];
}


  it("stdout 里 `fooOutput` 只声明一次（standard 段改名）；stdout 流里没有重复的顶层声明（产物可编译）；--out 落盘不变（各方言各占一个文件 ⇒ 产品名不漂移）", () => {
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 段保留产品名；standard 段改名（不再是同名第二份）
    expect(count(r.stdout, /^export const fooOutput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooOutputStandard");
    expect(r.stdout).toContain('import { z } from "zod"');
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(duplicateTopLevelNames(r.stdout)).toEqual([]);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-602-out-"));
    dirs.push(dir);
    const file = join(dir, "one.js");
    writeFileSync(file, "export function foo() { return 1; }\n", "utf-8");
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    // 产物文件名由 S4 决定 ⇒ 按后缀找文件，只断言「导出名不漂移」
    const names = readdirSync(out);
    const zodName = names.find((n) => n.includes(".nudo.schema."));
    const stdName = names.find((n) => n.endsWith(".nudo.standard.ts"));
    expect(zodName).toBeDefined();
    expect(stdName).toBeDefined();
    const zod = readFileSync(join(out, zodName!), "utf-8");
    expect(zod).toContain("export const fooOutput");
    expect(zod).not.toContain("fooOutputStandard");
    const std = readFileSync(join(out, stdName!), "utf-8");
    expect(std).toContain("export const fooOutput");
    expect(std).not.toContain("fooOutputStandard");
  }
});



});


// ---------------------------------------------------------------------------
// export --format all 到 stdout：`<fn>Input` 不跨段撞名
// ---------------------------------------------------------------------------
describe("export --format all 到 stdout：`<fn>Input` 不跨段撞名", () => {
/**
 * 同一 stdout 产物里 zod 段的 `<fn>Input` 与另一段的 `<fn>Input`
 * **标识符冲突**（TS2300 / TS2451）⇒ 产物不可用。
 *
 * ⚠ 勘误（AGENT-CONTEXT §4）：报告说的「dts 段 `export declare function
 * <fn>Input`」**不存在**（dts 生成器全文件无 `Input` 字样）⇒ 真实撞名对是
 * **zod 段 vs standard 段**（两段各自自洽，合进同一作用域即冲突）。
 *
 * 修法（stdout 面，S5）：跨段顶层标识符去重——先到先得，后段改名
 * （`<fn>Input` → `<fn>InputStandard`）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：一个带形参的导出函数（zod 段 + standard 段各有 `<fn>Input`）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-603-"));
  dirs.push(dir);
  const file = join(dir, "one.js");
  writeFileSync(file, "export function foo(x) { return x; }\n", "utf-8");
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}


  it("stdout 里 `fooInput` 只声明一次（standard 段改名）；dts 段不产 `<fn>Input`（报告的撞名对不存在 ⇒ 治的是 zod ↔ standard）；--format standard 单方言时导出名不漂移（无冲突 ⇒ 不改名）", () => {
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^export const fooInput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooInputStandard");
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("fooInput");
    expect(r.stdout).toContain("export declare function foo");
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const fooInput");
    expect(r.stdout).not.toContain("fooInputStandard");
  }
});



});


// ---------------------------------------------------------------------------
// export — 剩余参数位（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 剩余参数位（族 17 · S1 · ）", () => {
/**
 * 剩余参数（`...rest`）在产物面里被当成普通形参位：槽名原样带
 * `...rest`、槽值是**单个实参**、槽数取观测实参个数 ⇒ 凭空多出 `argN` 槽。
 *
 * 症状（改前）：`export function sumAll(first, ...rest)` 在 `sumAll(1, 2, 3)`
 * 的调用点上产出
 * `z.object({ first: z.literal(1), "...rest": z.literal(2), arg2: z.literal(3) })`
 * —— 三个槽：剩余参数被拆成「`...rest` 一个槽 + `arg2` 一个槽」，而调用面里
 * 剩余参数**是一个数组**。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面以**观测实参个数**
 * 为槽数、以 `fn.paramNames[i]` 为槽名 ⇒ 剩余参数与多出来的实参各自成槽。
 *
 * 修法（族 17 · S1）：槽位表改以**声明形参表**为骨架——剩余参数位取裸名
 * （`rest`，不带 `...`）、槽值是**数组** Abs（rest 之后的实参合成）、槽数取
 * 声明形参个数（不凭空造 `argN`）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-604-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}


  it("zod 入参面：槽名取裸名、槽值是数组、不凭空造 argN 槽；standard 面：剩余参数位导出名取裸名，节点是数组", () => {
  {
    const dir = fixture({
      "rest604.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "rest604.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 剩余参数位：裸名 + 数组值
    expect(r.stdout).toContain("rest: z.array(");
    // 槽名不带 `...`
    expect(r.stdout).not.toContain('"...rest"');
    // 槽数取声明形参表（2 个）⇒ 没有凭空造出来的 `arg2`
    expect(r.stdout).not.toContain("arg2");
  }
  {
    const dir = fixture({
      "rest604b.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "rest604b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("sumAll_rest");
    expect(r.stdout).not.toContain("sumAll____rest");
    expect(r.stdout).not.toContain("sumAll_arg2");
  }
});


});


// ---------------------------------------------------------------------------
// zod 槽表保留 `__proto__` 形参（无原型对象 ⇒ 不触发原型 setter）
// ---------------------------------------------------------------------------
describe("zod 槽表保留 `__proto__` 形参（无原型对象 ⇒ 不触发原型 setter）", () => {
/**
 * 形参名 `__proto__` 在 **zod Input 装配**时被普通对象吞掉 ⇒ zod 面丢形参。
 *
 * 症状（改前）：`export function f(__proto__, normal)` ⇒ zod 产物
 * `fInput = z.object({ normal: z.literal(3) })`（`__proto__` 形参**消失**），
 * 而 dts 面是对的（`f(__proto__: number, normal: number)`）⇒ 跨产物面自相矛盾。
 *
 * 根因（nudojs 层，本片修）：`export/zod-face.ts` 的 `zodInputSlots` 用**普通
 * 对象**存槽表 ⇒ 形参名 `__proto__` 的赋值命中 `Object.prototype.__proto__`
 * 的 **setter**（原型 setter）⇒ 该键**永不成自有属性** ⇒ `Object.entries()`
 * 看不到它 ⇒ `obj(slots)` 拿不到该槽。
 *
 * 修法（族 17 · S2）：槽表改用**无原型对象**（`Object.create(null)`）⇒ 没有原型
 * setter ⇒ `__proto__` 落为普通自有键（`constructor` / `toString` 等继承键同理）。
 *
 * ✅ **core 层缺口已闭合**（族 17 主 agent 接线）：core 的 `absToConstraint`
 * （`algebra/projection.ts` 的 `projectObj`）把槽位抄进**无原型对象** `fields`
 * （`Object.create(null)`），且 `algebra/codegen-escape.ts` 的 `formatObjectKey`
 * 把 `__proto__` 写成**计算键** `["__proto__"]`（裸 `__proto__: v` 在 JS 对象
 * 字面量里是原型 setter ⇒ 运行时该键不是自有属性）⇒ 产品面 zod 模块不再丢
 * 该形参（本钉第三段断言已从 `it.fails` 旗标**转正**为真断言）。
 *
 * runner 注：spawn 型 CLI 子进程对 @nudojs/* 的解析不经 vitest 别名 ⇒ 子进程
 * cwd 下的 tsconfig.json paths（绝对路径指向 src）保证测试面与本仓 src 一致。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程 tsx 用 tsconfig：@nudojs/* → 仓内 src（vitest 别名的子进程面） */
const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [`${repoRoot}packages/core/src`],
        "@nudojs/core/exec": [`${repoRoot}packages/core/src/algebra/exec/index.ts`],
        "@nudojs/core/internal": [`${repoRoot}packages/core/src/internal.ts`],
        "@nudojs/parser": [`${repoRoot}packages/parser/src`],
        "@nudojs/service": [`${repoRoot}packages/service/src`],
        "@nudojs/service/emit": [`${repoRoot}packages/service/src/emit/index.ts`],
        "@nudojs/service/evaluator": [`${repoRoot}packages/service/src/evaluator/evaluator-api.ts`],
        "@nudojs/env/es": [`${repoRoot}packages/env/src/es.ts`],
        "@nudojs/env/web": [`${repoRoot}packages/env/src/web.ts`],
        "@nudojs/env/node": [`${repoRoot}packages/env/src/node.ts`],
        "@nudojs/harvester": [`${repoRoot}packages/harvester/src`],
      },
    },
  },
  null,
  2,
)}\n`;

/** 建夹具目录（tsconfig.json + 源文件），返回目录路径 */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-606-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");


  it("槽表把 `__proto__` 落为自有键（改前：普通对象 ⇒ 被原型 setter 吞掉）；继承键（constructor / toString）同样不被原型吞掉；产品面 zod Input 含 `__proto__` 形参（core 两处补丁后：projection 字段表无原型 + 键走计算键）", () => {
  {
    const slots = zodInputSlots([
      { name: "__proto__", abs: numAbs },
      { name: "normal", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["__proto__", "normal"]);
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
    expect(slots["__proto__"]?.value).toBe(numAbs);
    expect(slots["normal"]?.value).toBe(numAbs);
  }
  {
    const slots = zodInputSlots([
      { name: "constructor", abs: numAbs },
      { name: "toString", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["constructor", "toString"]);
    // 无原型 ⇒ 槽表不挂 Object.prototype（改前：挂原型 ⇒ 继承键可被误读）
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(slots["constructor"]?.value).toBe(numAbs);
    expect(slots["toString"]?.value).toBe(numAbs);
  }
  {
      const dir = fixtureDir({
        "lib.js": [
          `/**`,
          ` * @nudo:case "c" (2, 3) => 3`,
          ` */`,
          `export function f(__proto__, normal) {`,
          `  return normal;`,
          `}`,
          ``,
        ].join("\n"),
      });
      const r = runCli(["export", "lib.js", "--format", "schema"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("__proto__");
  }
});



});


// ---------------------------------------------------------------------------
// nudo export --out · standard 产物名不撞名
// ---------------------------------------------------------------------------
describe("nudo export --out · standard 产物名不撞名", () => {
/**
 * `nudo export --out` 的 standard 产物按**函数名**命名 ⇒ 两个不同
 * 模块里的同名函数落到同一路径 ⇒ 后写覆盖先写（先导出的那份静默丢失）。
 *
 * 钉：两个不同源文件、同名导出函数 ⇒ out 目录里**两份产物都在**（规范名 +
 * 带模块键后缀的唯一名），先导出的那份内容不被覆盖。
 */







  it("同名函数在两个模块里 ⇒ 两份 standard 产物都在（先导出的不被覆盖）；同名函数的第二份产物名带模块键后缀（不是同一个路径）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-609-"));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "export function handler(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(b, "export function handler(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");

    const r1 = runCli(["export", a, "--format", "standard", "--out", out]);
    expect(r1.status).toBe(0);
    const first = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    expect(first).toHaveLength(1);
    const firstBody = readFileSync(join(out, first[0]!), "utf-8");

    const r2 = runCli(["export", b, "--format", "standard", "--out", out]);
    expect(r2.status).toBe(0);
    const all = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    // 两份都在 ⇒ 没有互相覆盖
    expect(all).toHaveLength(2);
    // 先导出的那份内容不变（仍带第一次的产物标记）
    expect(readFileSync(join(out, first[0]!), "utf-8")).toBe(firstBody);
    // 第二份落在**另一个**文件里
    const second = all.find((f) => f !== first[0]!)!;
    expect(readFileSync(join(out, second), "utf-8")).not.toBe(firstBody);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-609b-"));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "export function handler(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(b, "export function handler(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    const r1 = runCli(["export", a, "--format", "standard", "--out", out]);
    expect(r1.status).toBe(0);
    const firstPath = r1.stdout.split("\n").find((l) => l.startsWith("wrote "))!;
    const r2 = runCli(["export", b, "--format", "standard", "--out", out]);
    expect(r2.status).toBe(0);
    const secondPath = r2.stdout.split("\n").find((l) => l.startsWith("wrote "))!;
    // 第二次导出落到**另一个**路径（不是覆盖同一个文件）
    expect(secondPath).not.toBe(firstPath);
    expect(secondPath).toContain("handler.");
  }
}); // 2 个顺序 CLI 子进程（tsx 冷启动）


});


// ---------------------------------------------------------------------------
// export — 声明级默认值的可选性（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 声明级默认值的可选性（族 17 · S1 · ）", () => {
/**
 * 声明级默认值（`b = 2`）在产物面里**不参与槽位可选性** ⇒ 带默认值的
 * 形参被渲染成必填槽。
 *
 * 症状（改前）：`export function f(a, b = 2)` 的 zod 入参面产出
 * `z.object({ a: z.literal(1), b: z.literal(2) })`
 * 而同一函数的 dts 面是 `f(a: number, b?: number)` ⇒ 两个产物面自相矛盾
 * （dts 的可选性三来源口径是对的：契约级 → 声明级默认值 → 观测级最短元数）。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面在**观测回退分支**
 * 不产 `optional`（只有契约级的 `isOptional` 会带过来）⇒ 声明级默认值从未参与。
 *
 * 修法（族 17 · S1）：可选性按**三来源口径**（与 dts 面逐位同）产出：契约覆盖
 * 该位 ⇒ 契约级 `isOptional`；否则 ⇒ 声明级默认值 / 观测级最短元数。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-611-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}


  it("zod 入参面：带默认值的形参位是可选槽（与 dts 面同口径）；dts 面仍声明可选位 `b?`（两面的可选性口径一致）", () => {
  {
    const dir = fixture({
      "d611.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "d611.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("b: z.literal(2).optional()");
  }
  {
    const dir = fixture({
      "d611b.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "d611b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(a: number, b?: number): number;");
  }
});


});


// ---------------------------------------------------------------------------
// nudo export --out · 写失败回放已落盘清单
// ---------------------------------------------------------------------------
describe("nudo export --out · 写失败回放已落盘清单", () => {
/**
 * `nudo export --out` **写失败**时：产物已经部分落盘，但 stdout
 * 一行「wrote」都没有 ⇒ 用户以为「什么都没写」，实际磁盘上多了半个产物集；
 * 错误文案也不带**是哪个文件**失败。
 *
 * 钉：写盘失败 ⇒ stdout 如实回放**已落盘清单**（每行 `wrote <path>`），
 * stderr 点名失败的那个文件。
 */







  it("写失败 ⇒ stdout 回放已落盘产物 + stderr 点名失败文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-616-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    // 让 dts 产物的目标路径是一个目录 ⇒ 写到它时失败（前面几份已落盘）
    mkdirSync(join(out, "lib.d.ts"), { recursive: true });

    const r = runCli(["export", file, "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    // 已落盘清单如实回放（stdout）
    const wrote = r.stdout.split("\n").filter((l) => l.startsWith("wrote "));
    expect(wrote.length).toBeGreaterThan(0);
    expect(r.stdout).toContain("lib.nudo.schema.zod.ts");
    expect(r.stdout).toContain("lib.nudo.guard.ts");
    // 错误点名失败的那个文件（不是只说目录）
    expect(r.stderr).toContain("export --out write failed");
    expect(r.stderr).toContain("lib.d.ts");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

});
