/**
 * 模块套件：cli-config-env-and-envelope（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, runCliNode as runCli } from "./helpers/run-cli.ts";
import { findProjectConfig } from "@nudojs/service";
import { runInit } from "../commands/init.ts";
import { attachPathErrors } from "../check-json-map.ts";


// ---------------------------------------------------------------------------
// 信封 summary.errors = Σreports[] = 人类面计数
// ---------------------------------------------------------------------------
describe("信封 summary.errors = Σreports[] = 人类面计数", () => {
/**
 * 多文件信封的 `summary.errors` 把 `--from` 的**路径错误**也算成
 * 分析 error ⇒ 信封聚合数 ≠ Σ`reports[].summary.errors` ≠ 人类面计数。
 *
 * 口径（core 自己的契约断言）：`summary.errors` = **诊断条数之和** ——
 * core 侧 `serializeCheckJsonMulti` 逐文件求和，core 测试断言
 * `multi.summary.errors === Σ reports[].summary.errors`。路径错误不是分析
 * 诊断（没有对应 report），只落在 `pathErrors[]`（非空 ⇒ ok:false ⇒ exit 1）。
 */







/** 三个未约束 entry ⇒ 3 条 L2 entry-may-throw（分析 error） */
const SRC_A = `export function f1(x) {
  return x.toFixed(2);
}
export function f2(x) {
  return x.toFixed(2);
}
export function f3(x) {
  return x.toFixed(2);
}
`;
/** 一个未约束 entry ⇒ 1 条 L2 entry-may-throw */
const SRC_B = `export function g1(x) {
  return x.toFixed(2);
}
`;

function makeProject(): { cwd: string; files: string[]; missing: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-695-envelope-"));
  const a = join(dir, "a.js");
  const b = join(dir, "b.js");
  writeFileSync(a, SRC_A, "utf-8");
  writeFileSync(b, SRC_B, "utf-8");
  return { cwd: dir, files: [a, b], missing: join(dir, "nope.js") };
}

/** 人类面计数：每个文件一段「 N error · M warning · …」，求和 */
function humanErrorCount(stdout: string): number {
  const all = [...stdout.matchAll(/^\s*(\d+) error · /gm)].map((m) => Number(m[1]));
  expect(all.length).toBeGreaterThan(0);
  return all.reduce((a, b) => a + b, 0);
}


  it("单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）；CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]；CLI：无路径错误时信封计数 = 人类面计数（未回归）；CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）", () => {
  {
    const envelope: {
      ok: boolean;
      summary: { errors: number; warnings: number; infos: number; functions: number; files: number };
      pathErrors?: Array<{ path: string; code: string; message: string }>;
      reports: unknown[];
    } = {
      ok: true,
      summary: { errors: 3, warnings: 0, infos: 3, functions: 3, files: 1 },
      reports: [],
    };
    const out = attachPathErrors(envelope, [
      { path: "/x/nope.js", code: "nudo:path-missing-callsite", message: "missing" },
    ]);
    expect(out.summary.errors).toBe(3);
    expect(out.ok).toBe(false);
    expect(out.pathErrors).toHaveLength(1);
  }
  {
    const { cwd, files, missing } = makeProject();
    try {
      const json = runCliTsx(["check", ...files, "--from", missing, "--json"], { cwd });
      expect(json.status).toBe(1);
      const env = JSON.parse(json.stdout) as {
        ok: boolean;
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
        pathErrors?: Array<{ code: string }>;
      };
      const sumReports = env.reports.reduce((acc, r) => acc + r.summary.errors, 0);

      const human = runCliTsx(["check", ...files, "--from", missing], { cwd });
      const humanCount = humanErrorCount(human.stdout);

      // 三处一致
      expect(env.summary.errors).toBe(sumReports);
      expect(env.summary.errors).toBe(humanCount);
      expect(sumReports).toBe(4);
      // 路径错误不是分析诊断：单独落在 pathErrors[]，信封 ok:false（⇒ exit 1）
      expect(env.pathErrors).toHaveLength(1);
      expect(env.ok).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, files } = makeProject();
    try {
      const json = runCliTsx(["check", ...files, "--json"], { cwd });
      const env = JSON.parse(json.stdout) as {
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
      };
      const human = runCliTsx(["check", ...files], { cwd });
      expect(env.summary.errors).toBe(
        env.reports.reduce((acc, r) => acc + r.summary.errors, 0),
      );
      expect(env.summary.errors).toBe(humanErrorCount(human.stdout));
      expect(env.summary.errors).toBe(4);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-695-syntax-"));
    const broken = join(dir, "broken.js");
    const clean = join(dir, "clean.js");
    writeFileSync(broken, "export function broken( {\n", "utf-8");
    writeFileSync(clean, "export function id(x) { return x; }\n", "utf-8");
    try {
      const json = runCliTsx(["check", broken, clean, "--json"], { cwd: dir });
      expect(json.status).toBe(1);
      const env = JSON.parse(json.stdout) as {
        ok: boolean;
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
        pathErrors: Array<{ code: string }>;
      };
      const sumReports = env.reports.reduce((acc, r) => acc + r.summary.errors, 0);
      // 语法错不是分析诊断（没有对应 report）⇒ 不进 summary.errors
      expect(env.pathErrors).toHaveLength(1);
      expect(env.pathErrors[0].code).toBe("syntax-error");
      expect(env.summary.errors).toBe(sumReports);
      expect(env.summary.errors).toBe(0);
      expect(env.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});




});


// ---------------------------------------------------------------------------
// migrate strip --json 的失败面（stdout 永不为空 + 结果不丢）
// ---------------------------------------------------------------------------
describe("migrate strip --json 的失败面（stdout 永不为空 + 结果不丢）", () => {
/**
 * `nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节
 * （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果
 * 一并丢失；且 stderr 不含文件名。
 *
 * 族 16（commit e5b3f388）已修好「失败时 stdout 是合法 JSON」的一半（Bug
 * 1006 的信封），但**已成功目标的结果仍会丢**（库面 `migrateStrip` 整批
 * throw ⇒ 命令层拿不到任何结果）。
 *
 * 本片（命令层）修法：**逐目标调用** ⇒ 一个目标失败不再吞掉其它目标的
 * 成功结果；失败也出**合法 JSON 信封**（`ok:false` + `results` + 带文件名
 * 的 `pathErrors`）；stderr 带**文件名**。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「信封含成功目标的 results」断言**必红**
 * （HEAD 的信封没有 `results` 字段）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = "export const a: number = 1;\n";
const BAD = "export function oops( {\n";

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-696-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: Array<{ file: string; outFile: string }>;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};


  it("语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名；一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢；全成功 ⇒ stdout 仍是顶��数组（形状不变）；非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout", () => {
  {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    // `--json` 顶层形状**恒为数组**（失败信封是单元素数组）
    const envelope = JSON.parse(r.stdout) as StripEnvelope[];
    expect(Array.isArray(envelope)).toBe(true);
    expect(envelope).toHaveLength(1);
    const parsed = envelope[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(r.stderr).toContain("bad.ts");
  }
  {
    const bad = dirWith({ "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", bad, good]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    const envelope = JSON.parse(r.stdout) as StripEnvelope[];
    expect(Array.isArray(envelope)).toBe(true);
    const parsed = envelope[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toContain("good.ts");
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
  }
  {
    const dir = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  }
  {
    const bad = dirWith({ "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", bad, good]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("good.ts");
    expect(r.stderr).toContain("bad.ts");
  }
});




});


// ---------------------------------------------------------------------------
// package.json#nudo.env 非数组：原生报告而非裸崩
// ---------------------------------------------------------------------------
describe("package.json#nudo.env 非数组：原生报告而非裸崩", () => {
/**
 * `package.json#nudo.env` 的值**不是数组**时的处理。
 *
 * 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health /
 * contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。
 *
 * 现状（HEAD）：配置层已回落默认（[]）并给一条 stderr 提示（族 14 的 935），
 * 裸崩已消失——但**报告面**仍看不到这件事（用户只看到「env 没生效」的现象），
 * 且消费点没有显式守卫。本测试钉住：
 * - 消费点守卫：非数组 ⇒ 回落默认，门禁照跑（不裸崩）；
 * - 报告面可见：人类面与 `--json` 面都有一条**带文件名 + 诊断码**
 * （`config-shape`，与既有的 nudo 键形状诊断同口径）的告警。
 */






const SRC = `export function b() {
  return 1 + 1;
}
`;

function makeProject(envJson: string): { cwd: string; file: string; pkg: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-934-envshape-"));
  const file = join(dir, "t.js");
  writeFileSync(file, SRC, "utf-8");
  const pkg = join(dir, "package.json");
  writeFileSync(
    pkg,
    `{"name":"env-proj","version":"0.0.0","type":"module","nudo":{"env":${envJson}}}\n`,
    "utf-8",
  );
  return { cwd: dir, file, pkg };
}


  it("人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape；机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）；其它形状（布尔 / 对象）同样不裸崩 + 报告面可见；合法 env 数组：无 config-shape 告警（未回归）", () => {
  {
    const { cwd, file, pkg } = makeProject("42");
    try {
      const r = runCliTsx(["check", file], { cwd });
      // 不裸崩
      expect(r.stderr).not.toContain("is not iterable");
      expect(r.status).toBe(0);
      // 报告面：文件名 + 诊断码（与 468/936 的 config-shape 同口径）
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain(pkg);
      expect(r.stdout).toContain('"nudo.env"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file, pkg } = makeProject("42");
    try {
      const r = runCliTsx(["check", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout) as {
        ok: boolean;
        issues: Array<{ severity: string; code: string; message: string }>;
      };
      const shape = j.issues.find((i) => i.code === "config-shape");
      expect(shape).toBeDefined();
      expect(shape!.severity).toBe("warning");
      expect(shape!.message).toContain(pkg);
      expect(shape!.message).toContain("42");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    for (const envJson of ["true", '{"a":1}']) {
      const { cwd, file, pkg } = makeProject(envJson);
      try {
        const r = runCliTsx(["check", file], { cwd });
        expect(r.stderr).not.toContain("is not iterable");
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("config-shape");
        expect(r.stdout).toContain(pkg);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  }
  {
    const { cwd, file } = makeProject('["node"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("config-shape");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});




});


// ---------------------------------------------------------------------------
// env 模块合并须走 mergeHarvestUnderEnv（harvest 填空位）
// ---------------------------------------------------------------------------
describe("env 模块合并须走 mergeHarvestUnderEnv（harvest 填空位）", () => {
/**
 * `nudo check` 的 env 模块装配用**对象展开**代替
 * `mergeHarvestUnderEnv` ⇒ 手写 env 与 harvest **同名模块**时，harvest 的
 * **非冲突导出被整体丢弃** ⇒ check 面报 `unknown` + 误导诊断
 * （`nudo:unknown-inference`），而 test 面报**精确值** ⇒ 两个产品面互相矛盾。
 *
 * 修法（族 18 片 4）：check 面的模块图合并走 `mergeHarvestUnderEnv`
 * （与 test/service 面同口径）：env 赢**同名槽**，harvest 填 env 的**空位**
 * （B8）。
 *
 * oracle（改前 → 改后）：
 * 改前 `nudo check lib.js` ⇒ `harvested(a: any) => unknown` + unknown-inference 告警
 * 改后 `nudo check lib.js` ⇒ `harvested(a: any) => string` + 无 unknown-inference 告警
 * （`nudo test lib.js` 两边都是 `(any) => string` ⇒ 两面一致）
 */






/**
 * 夹具：`util` 同时被**手写 env**（`@nudo:env node` 提供 `format`）与
 * **harvest**（node_modules/util/index.d.ts 提供 `onlyHarvest`）覆盖。
 * 合并口径：env 赢同名槽、harvest 填空位 ⇒ 两个导出都可用。
 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b1037-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b1037", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  mkdirSync(join(dir, "node_modules", "util"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "util", "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(
    join(dir, "node_modules", "util", "index.d.ts"),
    `export declare function onlyHarvest(a: string): string;
export declare function format(...args: unknown[]): string;
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "node_modules", "util", "index.js"),
    `module.exports = { onlyHarvest: (a) => a };
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:env node
import { onlyHarvest, format } from "util";

export function harvested(a) {
  return onlyHarvest(a);
}
export function key(dir, name) {
  return format(dir, name);
}
`,
    "utf-8",
  );
  return dir;
}


  it("check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）；check 面与 test 面结论一致（同一文件、同一个精确签名）", () => {
  {
    const dir = project();
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("harvested(a: any) => string");
    expect(out).not.toContain("harvested(a: any) => unknown");
    // 误导诊断（真 unknown）必须消失
    expect(out).not.toContain("nudo:unknown-inference");
  }
  {
    const dir = project();
    const file = join(dir, "lib.js");
    const c = runCli(["check", file]);
    const t = runCli(["test", file]);
    // check 面签名表：harvested(a: any) => string（改前是 => unknown）
    expect(c.stdout + c.stderr).toContain("harvested(a: any) => string");
    // test 面 case 表：(any) => string
    expect(t.stdout + t.stderr).toContain("(any) => string");
    expect(c.stdout + c.stderr).not.toContain("=> unknown");
  }
});


});


// ---------------------------------------------------------------------------
// check — env-harvest-conflict 上屏（）
// ---------------------------------------------------------------------------
describe("check — env-harvest-conflict 上屏（）", () => {
/**
 * 文档明确列为 **check 面告警**的 `nudo:env-harvest-conflict`
 * 在 `nudo check` **永不出现**：analyzer 已经产出这条 warning，check 面的
 * 诊断白名单把它整条丢掉 ⇒ 文档承诺 vs 实现冲突。
 *
 * 根因：`domainIssuesFromDiagnostics` 的白名单只留 contract 家族两码
 * ⇒ service `pushBModuleIssues` 产出的 `nudo:env-harvest-conflict`
 * （handwritten `@nudo:env` 胜出 / harvest 冲突）被静默丢弃 ⇒ 用户看不到
 * 「我手写的 @nudo:env 盖掉了 harvest」这个事实。
 *
 * 钉：`nudo check` 人面 + `--json` 面都上屏 `nudo:env-harvest-conflict`，
 * 且 severity = **warning**（告警不挡门禁 ⇒ exit 0）。
 *
 * 回归方向：把 `CHECK_FACE_DIAG_CODES` 里的 `DIAG.envHarvestConflict` 去掉
 * ⇒ 本钉大面积失败。
 */






/**
 * 夹具：手写 `@nudo:env node` + 一个自带 @types 形态 d.ts 的 node_modules 包
 * ⇒ harvest 与手写 env 在 `format` 槽位上冲突 ⇒ 分析器产出
 * `nudo:env-harvest-conflict`（warning）。
 */
function writeHarvestConflictFixture(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b1038", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
  const nm = join(dir, "node_modules", "util");
  mkdirSync(nm, { recursive: true });
  writeFileSync(
    join(nm, "package.json"),
    `{ "name": "util", "version": "1.0.0", "types": "index.d.ts" }`,
    "utf-8",
  );
  writeFileSync(
    join(nm, "index.d.ts"),
    `export declare function onlyHarvest(a: string): string;\nexport declare function format(...args: unknown[]): string;\n`,
    "utf-8",
  );
  writeFileSync(
    join(nm, "index.js"),
    `module.exports = { onlyHarvest: (a) => a };\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:env node\nimport { onlyHarvest, format } from "util";\n\nexport function harvested(a) {\n  return onlyHarvest(a);\n}\nexport function key(dir, name) {\n  return format(dir, name);\n}\n`,
    "utf-8",
  );
}


  it("人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）；--json 面同码同 severity（warning）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:env-harvest-conflict)");
    // 告警级 ⇒ 门禁不红（exit 0）
    expect(r.status).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-json-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js"), "--json"]);
    const parsed = JSON.parse(r.stdout) as {
      issues?: Array<{ severity: string; code: string }>;
    };
    const hit = (parsed.issues ?? []).find((i) => i.code === "nudo:env-harvest-conflict");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
  }
});


});


// ---------------------------------------------------------------------------
// init 的祖先继承口径 = 加载器口径（不得死锁）
// ---------------------------------------------------------------------------
describe("init 的祖先继承口径 = 加载器口径（不得死锁）", () => {
/**
 * `nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致，
 * 且不得死锁。
 *
 * 加载器真源（`packages/service/src/evaluator/config.ts` 的
 * `findProjectConfig`）：从目标目录向上找**最近的、含 `nudo` 键**的
 * package.json；键存在即**截断**祖先搜索（#936）——
 * - 键存在且形状**有效** ⇒ 用它（= 继承成功）；
 * - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按
 * 「无配置」处理，并**不继承**祖先配置（fail-closed）。
 *
 * 旧行为（`packages/nudojs/src/commands/init.ts` 的 `runInit`）：**无论**本包
 * 有没有 `nudo` 键，都调用 `findInheritableAncestorConfig`；祖先有**有效**
 * `nudo` 配置时一律以「it inherits a nudo config from …」拒绝写盘。
 * ⇒ 本包的 `nudo` 值**形状非法** + 祖先有有效配置时：
 * - 加载器**不继承**祖先（假话：「it inherits」）；
 * - init 又以「遮蔽祖先」为由拒绝写盘 ⇒ **死锁**：文档承诺
 * 「无效值以基线替换并告警」，实现却拒绝 ⇒ 用户无法自行修复该值。
 *
 * 新行为：只有「本包**没有** `nudo` 键」（= 祖先配置真的会被继承）时，
 * 才用「it inherits」当拒绝理由；本包已有 `nudo` 键但形状非法 ⇒ 按文档
 * **以基线替换并告警**（加载器本来就不继承祖先，不存在遮蔽）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 祖先（容器根）有**有效** nudo 配置；子包的 nudo 值形状非法 */
function ancestorWithInvalidChild(): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-"));
  dirs.push(root);
  const sub = join(root, "pkg");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{ "name": "root", "nudo": { "check": { "profile": "strict" } } }\n',
    "utf-8",
  );
  writeFileSync(join(sub, "package.json"), '{ "name": "pkg", "nudo": "oops" }\n', "utf-8");
  return { root, sub };
}


  it("加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）；死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）；死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）；反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）；显式 init <容器根>：写盘 + 作用域告警（不越界）；从容器根的子目录 init：拒绝越界写盘（exit 1）", () => {
  {
    const { sub } = ancestorWithInvalidChild();
    // 加载器：本包的 nudo 键存在 ⇒ 截断祖先搜索 ⇒ 无配置
    expect(findProjectConfig(sub)).toBeNull();
  }
  {
    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(sub, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
    expect(errors.join("\n")).toContain("replaced with the adoption baseline");
  }
  {
    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(errors.join("\n")).not.toContain("it inherits a nudo config from");
  }
  {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-shadow-"));
    dirs.push(root);
    const sub = join(root, "pkg");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      '{ "name": "root", "nudo": { "check": { "profile": "strict" } } }\n',
      "utf-8",
    );
    writeFileSync(join(sub, "package.json"), '{ "name": "pkg" }\n', "utf-8");
    // 加载器口径：本包无 nudo 键 ⇒ 向上找 ⇒ 继承祖先
    expect(findProjectConfig(sub)?.config?.check?.profile).toBe("strict");
    const before = readFileSync(join(sub, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(sub, "package.json"), "utf-8")).toBe(before);
    // 拒绝理由与加载器口径一致（确实继承）
    expect(errors.join("\n")).toContain("it inherits a nudo config from");
  }
  {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-container-"));
    dirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
    const pkg = join(root, "packages", "foo");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{ "name": "foo" }\n', "utf-8");
    const errors: string[] = [];
    const code = runInit(root, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
    // 作用域必须说清（nudo 键对下层所有包生效）
    expect(errors.join("\n")).toContain("workspace / container root");
  }
  {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-cross-"));
    dirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
    const pkg = join(root, "packages", "foo");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{ "name": "foo" }\n', "utf-8");
    const before = readFileSync(join(root, "package.json"), "utf-8");
    const errors: string[] = [];
    // 从容器根的**子目录**发起 ⇒ 最近 package.json 是容器根 ⇒ 越界 ⇒ 拒绝
    const code = runInit(join(root, "packages"), { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("workspace / container root");
  }
});






});


// ---------------------------------------------------------------------------
// CLI：nudo:mock-invalid 严重度对齐文档（warning）
// ---------------------------------------------------------------------------
describe("CLI：nudo:mock-invalid 严重度对齐文档（warning）", () => {
/**
 * 回归（CLI 面）：`nudo:mock-invalid` 的严重度在 **CLI 映射面**被
 * 无条件提到 error —— 与文档（reference/diagnostics.md#nudo-mock-invalid
 * 「**Warning**」、guides/check.md「nudo:mock-invalid | engine | warning」）
 * 和 service 侧（analyzer-orchestrate-uncached.ts 的 `isExpr ? "warning" : "error"`）
 * 都相反。
 *
 * 本文件锁三件事：
 * ① `@nudo:mock` **表达式**解析失败 ⇒ warning（不再红门禁）；
 * ② `@nudo:mock` **文件**缺失/加载失败仍是 error（不引入假绿）；
 * ③ 负控制：同一文件里两条通道严重度一致（不再一 warning 一 error）。
 */






/** mock 表达式不是已知形态 ⇒ 指令被忽略（mock 不生效） */
const MOCK_EXPR = `// @nudo:mock fs = foo(1)
export function useFs() {
  return 1;
}
`;

/** mock 文件缺失 ⇒ 依赖不可用 ⇒ error */
const MOCK_MISSING_FILE = `// @nudo:mock fs from "./definitely-missing-mock-file.js"
export function useFs() {
  return 1;
}
`;

function fixture(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-460-cli-"));
  writeFileSync(join(dir, "probe.js"), src, "utf-8");
  return dir;
}

type Json = {
  ok: boolean;
  summary: { errors: number; warnings: number };
  issues: { code: string; severity: string }[];
};


  it("mock 表达式解析失败 ⇒ warning（不红门禁）；mock 文件缺失仍是 error（不引入假绿）；负控制：文件面只出现一条 mock-invalid（无重复报告）", () => {
  {
    const dir = fixture(MOCK_EXPR);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      const mockInvalid = json.issues.filter((i) => i.code === "nudo:mock-invalid");
      expect(mockInvalid.length).toBeGreaterThan(0);
      for (const i of mockInvalid) expect(i.severity).toBe("warning");
      // warning 不挡门禁：exit 0、ok:true
      expect(json.summary.errors).toBe(0);
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture(MOCK_MISSING_FILE);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      expect(json.summary.errors).toBeGreaterThan(0);
      expect(json.ok).toBe(false);
      expect(r.status).toBe(1);
      const missing = json.issues.filter((i) => i.code === "nudo:module-missing");
      expect(missing.length).toBeGreaterThan(0);
      for (const i of missing) expect(i.severity).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture(MOCK_EXPR);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      const mockInvalid = json.issues.filter((i) => i.code === "nudo:mock-invalid");
      expect(mockInvalid).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// CLI：nudo 键形状非法 ⇒ 报告面可见（不静默）
// ---------------------------------------------------------------------------
describe("CLI：nudo 键形状非法 ⇒ 报告面可见（不静默）", () => {
/**
 * 回归（CLI 报告面）：package.json#nudo 键的**形状**问题
 * （值不是对象 / 是假值）必须**在报告面可见**——service 侧只给 stderr 一行，
 * check / health 的报告面看不到 ⇒ 用户不知道自己写错了。
 *
 * 另锁 onboarding 条件对齐：形状写坏时**不得**打「本项目还没有 nudo 配置」
 * 的 onboarding 块（那个前提不成立，且「nudo init」是错 advice）。
 */






const SRC = `export function f() {
  return 1;
}
`;

/** 468：`nudo` 键的值不是对象 */
function projectWithNudo(nudo: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-468-cli-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "p", version: "1.0.0", type: "module", nudo }),
    "utf-8",
  );
  writeFileSync(join(dir, "probe.js"), SRC, "utf-8");
  return dir;
}


  it("check --json：config-shape warning 进 issues 段；check 人类面：issues 段看得见 config-shape；health 人类面：config 提示行可见；health --json：configShape 字段可见；936：假值 nudo 键（false）同样可见（且措辞说 falsy）；负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断", () => {
  {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as {
        issues: { code: string; severity: string; message: string }[];
      };
      const shape = json.issues.filter((i) => i.code === "config-shape");
      expect(shape).toHaveLength(1);
      expect(shape[0].severity).toBe("warning");
      expect(shape[0].message).toContain("invalid");
      expect(shape[0].message).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["health", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config:");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["health", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as {
        files: { configShape?: { pkgPath: string; message: string } }[];
      };
      expect(json.files[0].configShape).toBeDefined();
      expect(json.files[0].configShape?.message).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo(false);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("falsy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo({ check: { ignoreThrows: ["RangeError"] } });
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as { issues: { code: string }[] };
      expect(json.issues.filter((i) => i.code === "config-shape")).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});







describe("CLI：配置形状诊断是 live 事实（磁盘缓存不得留痕/重复）", () => {
  it("缓存命中轮：config-shape 仍恰 1 条（不重复）；键被改好后：陈旧的 config-shape 告警不得留在缓存里", () => {
  {
    const dir = projectWithNudo(true);
    try {
      const env = { NUDO_CACHE_DIR: join(dir, ".cache") };
      const first = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      const second = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      const a = JSON.parse(first.stdout) as { issues: { code: string }[] };
      const b = JSON.parse(second.stdout) as { issues: { code: string }[] };
      expect(a.issues.filter((i) => i.code === "config-shape")).toHaveLength(1);
      expect(b.issues.filter((i) => i.code === "config-shape")).toHaveLength(1);
      // 落盘的缓存条目**不得**含 config-shape（live 事实不持久化）——
      // 否则命中轮 live merge 会与缓存条目重复。
      const cacheFiles = collectCacheFiles(join(dir, ".cache"));
      expect(cacheFiles.length).toBeGreaterThan(0);
      for (const f of cacheFiles) {
        expect(readFileSync(f, "utf-8")).not.toContain("config-shape");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = projectWithNudo(true);
    try {
      const env = { NUDO_CACHE_DIR: join(dir, ".cache") };
      const first = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      expect(
        (JSON.parse(first.stdout) as { issues: { code: string }[] }).issues.filter(
          (i) => i.code === "config-shape",
        ),
      ).toHaveLength(1);
      // 用户把写坏的键改好
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "p", version: "1.0.0", type: "module", nudo: {} }),
        "utf-8",
      );
      const second = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      expect(
        (JSON.parse(second.stdout) as { issues: { code: string }[] }).issues.filter(
          (i) => i.code === "config-shape",
        ),
      ).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

});

/** 递归收集缓存条目文件 */
function collectCacheFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}
});


// ---------------------------------------------------------------------------
// nudo.env 写成字符串：不展成逐字符 env 名列表（反向守护钉）
// ---------------------------------------------------------------------------
describe("nudo.env 写成字符串：不展成逐字符 env 名列表（反向守护钉）", () => {
/**
 * （**反向守护钉** · 报告说法的假阳性）：`package.json#nudo.env` 写成
 * **字符串**时，`nudo check` **不得**把它展成逐字符的 env 名列表。
 *
 * 报告原始描述：`packages/nudojs/src/commands/check.ts` 把 `package.json#nudo.env`
 * 直接当数组展开 ⇒ `"node"` 被展成 `["n","o","d","e"]` ⇒ env 静默不生效 +
 * 假 `nudo:unknown-inference`。
 *
 * **实测（HEAD）：报告说的现象已不成立** ⇒ 本条是**假阳性**，只写守护钉、
 * **零实现改动**（在 HEAD 上必须通过）。
 *
 * HEAD 上的真实链路（两段守卫，缺一不可）：
 * 1. **配置层**（`packages/service/src/evaluator/config.ts` 的 `sanitizeProjectEnv`）：
 * `nudo.env` 的值不是数组 ⇒ **整项丢弃**（回落空列表）+ 一条 stderr 提示
 * （`has an invalid "nudo.env" value ("node"; expected an array of strings); ignoring it`）；
 * 2. **消费层**（`packages/nudojs/src/commands/check.ts` 的 `projectEnvShapeIssue` +
 * `Array.isArray(rawProjectEnv) ? rawProjectEnv : []`）：形状问题在**报告面**
 * 可见（诊断码 `config-shape`，与 468/936 的 `nudo` 键形状诊断同口径），
 * 消费点另有显式守卫 ⇒ 旧实现的 `projectEnvNames is not iterable` 裸崩
 * （五个 verb 全崩）也已消失。
 *
 * **为什么这条钉不是空转**（两头夹逼）：
 * - 若真被展成字符（`["n","o","d","e"]`），env 装载面会为**每个字符名**报一条
 * `nudo:env-unresolved`（`unknown env name "n"` …，共 **4** 条）——
 * 本钉用「字符串 env ⇒ **0** 条」与「字符数组 env ⇒ 恰 **4** 条」夹逼，
 * 把「env 名列表**不是**逐字符」钉死；
 * - 用「`env: ["node"]` ⇒ `Buffer` 可用」与「`env: "node"` ⇒ `Buffer` **不可用**
 * （列表被忽略，env 侧不生效）」夹逼，把「env 列表被忽略」钉死；
 * - env **无关**型代码在字符串 env 下**不得**产生 `nudo:unknown-inference`
 * （被忽略的 env 不得制造假的推断失败告警）。
 */






/** 需要 env 全局（`Buffer`）的代码：env 生效与否在这里看得见 */
const SRC_ENV_DEPENDENT = `export function toBuf(s){ return Buffer.from(s); }
`;

/** 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference` */
const SRC_ENV_INDEPENDENT = `export function answer() { return 42; }
`;

/** 造一个带 `nudo.env` 的临时项目（`envJson` 是 env 值的 **JSON 文本**） */
function makeProject(envJson: string, src: string): { cwd: string; pkg: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug-638-envstr-"));
  writeFileSync(join(cwd, "a.js"), src, "utf-8");
  writeFileSync(
    join(cwd, "package.json"),
    `{"name":"env-str-proj","version":"0.0.0","type":"module","nudo":{"env":${envJson}}}\n`,
    "utf-8",
  );
  return { cwd, pkg: join(cwd, "package.json") };
}

/** 出现次数（人类面里 `nudo:env-unresolved` 既有 issue 行也有 docs 行 ⇒ 按词计数） */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}


  it("字符串 env：不裸崩 + 人类面产出 config-shape 形状告警；字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved；env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条；env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:[\"node\"] ⇒ Buffer 可用；env 无关型代码：", () => {
  {
    const { cwd, pkg } = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd });
      // 不裸崩（旧实现：projectEnvNames is not iterable ⇒ 五个 verb 全崩）
      expect(r.stderr).not.toContain("is not iterable");
      expect(r.stderr).not.toContain("TypeError");
      expect(r.status).toBe(0);
      // 形状告警上屏（诊断码 config-shape，与 468/936 同口径）
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain('"nudo.env"');
      expect(r.stdout).toContain('("node"; expected an array of strings)');
      expect(r.stdout).toContain(pkg);
      // 配置面提示（stderr 一行）
      expect(r.stderr).toContain(
        'has an invalid "nudo.env" value ("node"; expected an array of strings); ignoring it',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd } = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js", "--json"], { cwd });
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout) as {
        ok: boolean;
        issues: Array<{ severity: string; code: string; message: string }>;
      };
      const shape = j.issues.filter((i) => i.code === "config-shape");
      expect(shape).toHaveLength(1);
      expect(shape[0].severity).toBe("warning");
      expect(shape[0].message).toContain('"nudo.env"');
      expect(shape[0].message).toContain('"node"');
      // 展成字符的痕迹：一个都不许有
      expect(j.issues.filter((i) => i.code === "nudo:env-unresolved")).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    // 被钉住的行为：字符串 env **不**产生任何逐字符 env 名
    const str = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: str.cwd });
      expect(count(r.stdout, "unknown env name")).toBe(0);
      expect(count(r.stdout, "nudo:env-unresolved")).toBe(0);
    } finally {
      rmSync(str.cwd, { recursive: true, force: true });
    }
    // 对照：若真被展成字符（["n","o","d","e"]），env 装载面会逐个报 unknown env name
    // ⇒ 上面的断言是**活的**判别（不是恒真的空转）
    const chars = makeProject('["n","o","d","e"]', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: chars.cwd });
      expect(count(r.stdout, "unknown env name")).toBe(4);
      expect(count(r.stdout, "nudo:env-unresolved")).toBeGreaterThanOrEqual(4);
      for (const ch of ["n", "o", "d", "e"]) {
        expect(r.stdout).toContain(`unknown env name "${ch}"`);
      }
    } finally {
      rmSync(chars.cwd, { recursive: true, force: true });
    }
  }
  {
    const str = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: str.cwd });
      // env 侧不生效 ⇒ Buffer 全局不可得 ⇒ 返回值塌成 unknown
      expect(r.stdout).toContain("toBuf(s: any) => unknown");
      expect(r.stdout).not.toContain("toBuf(s: any) => Buffer");
      // 且这是**已知原因**（形状告警在场），不是无声的推断失败
      expect(r.stdout).toContain("config-shape");
    } finally {
      rmSync(str.cwd, { recursive: true, force: true });
    }
    // 对照：合法 env 数组 ⇒ env 生效（Buffer 可得），且无形状告警
    const arr = makeProject('["node"]', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: arr.cwd });
      expect(r.stdout).toContain("toBuf(s: any) => Buffer");
      expect(r.stdout).not.toContain("config-shape");
      expect(r.stdout).not.toContain("nudo:unknown-inference");
    } finally {
      rmSync(arr.cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd } = makeProject('"node"', SRC_ENV_INDEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd });
      expect(r.status).toBe(0);
      // 推断本身成功 ⇒ 不得有 unknown-inference
      expect(r.stdout).toContain("answer() => 42");
      expect(r.stdout).not.toContain("nudo:unknown-inference");
      // 但「env 列表被忽略」这件事仍然可见
      expect(r.stdout).toContain("config-shape");
      expect(count(r.stdout, "unknown env name")).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});





});


// ---------------------------------------------------------------------------
// 项目级 path env 按项目根解析（子目录文件也拿得到）
// ---------------------------------------------------------------------------
describe("项目级 path env 按项目根解析（子目录文件也拿得到）", () => {
/**
 * `package.json#nudo.env` 的**路径型**条目按**被分析文件所在目录**
 * 解析（不是项目根）⇒ **子目录**里的文件永远拿不到 env ⇒ **假红**
 * （`never` + `nudo:env-unresolved`）+ 误导诊断。
 *
 * 修法（族 18 片 4）：env 名装配**分层**（`assembleEnvs`）——
 * - **项目级**（package.json#nudo.env）按**项目根**解析（相对说明符先绝对化：
 * 收集期的查表基准是「最后一次 preload 的目录」，不绝对化则子目录文件必然
 * 查空）；
 * - **文件级**（`/// @nudo:env <path>`）按**本文件目录**解析；
 * - env 加载失败诊断按**各自**的基准过滤 ⇒ 不再报 check 面从未请求过的路径。
 *
 * oracle（改前 → 改后）：
 * 改前 `nudo check src/lib.js` ⇒ FAILED / `magic() => never` / env-unresolved
 * 改后 `nudo check src/lib.js` ⇒ OK / `magic() => 42` / 无 env 告警
 */






/** 项目级 path env（按项目根解析）+ 一个子目录里的被检查文件 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b647-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b647",
      version: "1.0.0",
      type: "module",
      nudo: { env: ["./env/web.ts"] },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, "env"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "env", "web.ts"),
    `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "src", "lib.js"),
    `export function magic() { return MAGIC; }
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "rootlib.js"),
    `export function magic() { return MAGIC; }
`,
    "utf-8",
  );
  return dir;
}


  it("子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0；根目录文件：口径不变（magic() => 42、exit 0）；项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）", () => {
  {
    const dir = project();
    const r = runCli(["check", join(dir, "src", "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("never");
    // 不得报 check 面从未请求过的路径（分析器通道按文件目录解析的旧记录）
    expect(out).not.toContain("env-unresolved");
  }
  {
    const dir = project();
    const r = runCli(["check", join(dir, "rootlib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("env-unresolved");
  }
  {
    const dir = project();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b647",
        version: "1.0.0",
        type: "module",
        nudo: { env: ["./env/missing.ts"] },
      }),
      "utf-8",
    );
    const r = runCli(["check", join(dir, "src", "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("nudo:env-unresolved");
  }
});



});


// ---------------------------------------------------------------------------
// --json 下用法错误也有机器可读信封（stdout 不得为空）
// ---------------------------------------------------------------------------
describe("--json 下用法错误也有机器可读信封（stdout 不得为空）", () => {
/**
 * `nudo check --json` 下的**用法错误** ⇒ stdout 空 + exit 1
 * （机器面 `JSON.parse(stdout)` 直接炸；且违反「exit 只由打印出的 ok 决定 /
 * 绝不出现空 stdout + 非零 exit」的机器面契约）。
 *
 * 症状：用法错误（无路径 / --json+--abs / --profile 非法 / --entry-throws 非法 /
 * variadic 吞路径 / --fix+--json）此前只往 stderr 写文案 ⇒ stdout 空、exit 1。
 * 修复：`--json` 面下用法错误也落一份机器可读信封（ok:false + pathErrors[]
 * 带 `nudo:usage-error`），exit 只由信封的 ok 决定；非 `--json` 面文案不变。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-954-"));
  const file = join(dir, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("-json 下用法错误也有机器可读信封（stdout 不得为空）", () => {
  const cases: Array<{ name: string; args: (file: string) => string[] }> = [
    { name: "无路径", args: () => ["check", "--json"] },
    { name: "--json + --abs", args: (f) => ["check", f, "--json", "--abs"] },
    { name: "--profile 非法", args: (f) => ["check", f, "--json", "--profile", "bogus"] },
    {
      name: "--entry-throws 非法",
      args: (f) => ["check", f, "--json", "--entry-throws", "bogus"],
    },
    { name: "variadic 吞路径", args: (f) => ["check", "--json", "--from", f] },
    { name: "--fix + --json", args: (f) => ["check", f, "--json", "--fix"] },
  ];

  for (const c of cases) {
    it(`CLI：${c.name} ⇒ stdout 是信封（ok:false + nudo:usage-error）+ exit 1`, () => {
      const { cwd, file } = makeProject();
      try {
        const r = runCliTsx(c.args(file), { cwd });
        expect(r.status).toBe(1);
        // 旧症状：stdout 空 ⇒ 机器面 JSON.parse 炸
        expect(r.stdout.trim().length).toBeGreaterThan(0);
        const doc = JSON.parse(r.stdout);
        expect(doc.kind).toBe("multi");
        expect(doc.ok).toBe(false);
        expect(doc.pathErrors.length).toBeGreaterThan(0);
        expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
        expect(doc.pathErrors[0].message.length).toBeGreaterThan(0);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }

  it("CLI：非 --json 面仍是 stderr 文案 + exit 1（旧口径不回归）；CLI：非 --json 面的组合拒绝仍是 stderr 文案（--fix + --watch）", () => {
  {
    const { cwd } = makeProject();
    try {
      const r = runCliTsx(["check"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo check` needs at least one path.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--watch"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--fix cannot be combined with");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

});
});

describe("test --json 路径错误计数（BUG-373）", () => {
  it("单个缺失目标只计一次，并带 summary.pathErrors", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-test-json-373-"));
    try {
      const r = runCliTsx(["test", "--json", join(dir, "missing.ts")], { cwd: dir });
      expect(r.status).toBe(1);
      const env = JSON.parse(r.stdout) as {
        summary: { errors: number; pathErrors: number };
        pathErrors: unknown[];
      };
      expect(env.summary.errors).toBe(1);
      expect(env.summary.pathErrors).toBe(1);
      expect(env.pathErrors).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
