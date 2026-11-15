/**
 * migrate verify 面（批量隔离/基线/注入/tsc 版本与路径一致性）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateVerify, migrateStatus, migrateRetire, listWorkflowTscLines, rewriteTscCommand, formatStatusTable, migrateStrip } from "../migrate.ts";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

// ---------------------------------------------------------------------------
// Bug 015: verify 与 check 必须共用 ignoreThrows 解析器
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 015: verify 与 check 必须共用 ignoreThrows 解析器", () => {
/**
 * BUG-015 —— `nudo migrate verify` 与 `nudo check` 用**不同的 `ignoreThrows`
 * 解析器** ⇒ 同一文件同一配置两个结论（verify 假失败，迁移门禁永远转不绿）。
 *
 * 根因：verify 走 service `checkConfig()` 的**严格** `Array.isArray` 变体
 * （裸字符串 `"TypeError"` 与 `["TypeError,RangeError"]` 元素内逗号都不认），
 * 而 `nudo check` 走 `configIgnoreThrows`（宽松：裸字符串 + 逗号切分）。
 *
 * 修复：verify 改用同一个宽松解析器。
 *
 * 反向闸：**没配** ignoreThrows 时 verify 仍判红（不得把闸门整体放松）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BOOM = "export function boom(x) {\n  return x.toUpperCase();\n}\n";

function project(ignoreThrows?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-015-"));
  dirs.push(dir);
  const pkg: Record<string, unknown> = { name: "f2", version: "1.0.0", type: "module" };
  if (ignoreThrows !== undefined) pkg.nudo = { check: { ignoreThrows } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
  writeFileSync(join(dir, "boom.js"), BOOM, "utf-8");
  return dir;
}

describe("Bug 015: verify 与 check 必须共用 ignoreThrows 解析器", () => {
  it("裸字符串 \"TypeError\" ⇒ verify 判绿（与 check 同结论）", async () => {
    const dir = project("TypeError");
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("数组元素内含逗号 [\"TypeError,RangeError\"] ⇒ verify 判绿", async () => {
    const dir = project(["TypeError,RangeError"]);
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：没配 ignoreThrows ⇒ verify 仍判红", async () => {
    const dir = project();
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 061: verify 必须对模块级求值失败 fail-closed（与 check 同结论）
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 061: verify 必须对模块级求值失败 fail-closed（与 check 同结论）", () => {
/**
 * BUG-061 —— `nudo migrate verify` 对**模块级求值失败**放绿（`nudo check` 判红
 * `nudo:internal`）⇒ 迁移闸门假绿。
 *
 * 根因：`migrateVerify` 调 `checkSource` 时**没有装求值回落 collector**
 * （分析器通道装过一次又在自己的收尾处摘掉）⇒ 引擎 internal 回落被静默吞掉
 * ⇒ 模块的全部导出丢失、零诊断、`nudoOk: true`。而 `nudo check` 同路径装了
 * collector ⇒ error 级 `nudo:internal` ⇒ exit 1。
 *
 * 期望：verify 与 check **同结论**（这正是迁移闸门的语义：「任一文件
 * `nudo check` 不 ok ⇒ exit 1」）。
 *
 * 反向闸：模块级求值正常的文件仍是 OK（不得把闸门全打红）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dirWith(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-061-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b061", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  writeFileSync(join(dir, "boom.js"), source, "utf-8");
  return dir;
}

describe("Bug 061: verify 必须对模块级求值失败 fail-closed（与 check 同结论）", () => {
  it("模块顶层抛（undefined is not a function）⇒ nudoOk: false", async () => {
    const dir = dirWith(`export const boom = undefined();\n\nexport function add(a, b) {\n  return a + b;\n}\n`);
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(false);
  });

  it("同目录的干净文件仍是 OK（反向闸：不得整批打红）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-061-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "b061ok", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    writeFileSync(join(dir, "ok.js"), 'export function pick() {\n  return "s";\n}\n', "utf-8");
    const rows = await migrateVerify([join(dir, "ok.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 064: 项目级 path env 必须按项目根解析（与 nudo check 同口径）
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 064: 项目级 path env 必须按项目根解析（与 nudo check 同口径）", () => {
/**
 * BUG-064 —— `nudo migrate verify` 把**项目级** `package.json#nudo.env` 的相对
 * 路径按「被检文件所在目录」解析 ⇒ 子目录里的文件**永远拿不到**项目级 env
 * ⇒ 误报红（`may throw ReferenceError`），而 `nudo check` 判绿。
 *
 * 既定契约（Bug 647）：**项目级** path env 按**项目根**解析；**文件级**
 * `@nudo:env` 才按被分析文件所在目录解析。
 *
 * 修复：verify 侧照抄 check 的分层口径（项目级按 `proj.projectDir` 绝对化 +
 * 文件级按 `dirname(file)`），并把 env 加载失败并入报告（`nudo:env-unresolved`）。
 *
 * 反向闸：文件级 `@nudo:env` 仍按文件目录解析（Bug 593 口径不变）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENV_SRC = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

function project(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-064-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "envp",
      version: "1.0.0",
      type: "module",
      nudo: { env: ["./env/web.ts"] },
    }),
    "utf-8",
  );
  mkdirSync(join(root, "env"), { recursive: true });
  writeFileSync(join(root, "env", "web.ts"), ENV_SRC, "utf-8");
  mkdirSync(join(root, "src"), { recursive: true });
  const file = join(root, "src", "lib.js");
  writeFileSync(file, "export function magic() {\n  return MAGIC;\n}\n", "utf-8");
  return { root, file };
}

describe("Bug 064: 项目级 path env 必须按项目根解析（与 nudo check 同口径）", () => {
  it("子目录文件拿得到项目级 env 全局 ⇒ verify 判绿", async () => {
    const { file } = project();
    const rows = await migrateVerify([file], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：文件级 @nudo:env 仍按**文件目录**解析", async () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-064-file-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "envpf", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    mkdirSync(join(root, "src", "env"), { recursive: true });
    writeFileSync(join(root, "src", "env", "web.ts"), ENV_SRC, "utf-8");
    const file = join(root, "src", "lib.js");
    writeFileSync(
      file,
      '/// @nudo:env ./env/web.ts\nexport function magic() {\n  return MAGIC;\n}\n',
      "utf-8",
    );
    const rows = await migrateVerify([file], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 114: .js 里的 TS-only 语法必须与 nudo check 同结论（判红）
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 114: .js 里的 TS-only 语法必须与 nudo check 同结论（判红）", () => {
/**
 * BUG-114 —— `nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与
 * `nudo check` 相反 ⇒ 迁移闸门假绿。
 *
 * 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`：
 * `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1），
 * verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。
 *
 * 影响链（与 BUG-050 串联）：`migrate strip` 写坏的产物（`export namespace …` /
 * `import x = require(…)`）在 verify 面**也是绿的** ⇒ 「strip 写坏 ⇒ verify 放绿
 * ⇒ retire 摘掉 TS」完整失效链。
 *
 * 修复：verify 的逐文件通道先做 check 同款**严格解析**；不通过 ⇒ 该文件
 * `code: "syntax-error"` + `nudoOk: false`。
 *
 * 反向闸：普通 `.js` 与合法的 `.ts` 仍判绿（不得把闸门全打红）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-114-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "f114", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("Bug 114: .js 里的 TS-only 语法必须与 nudo check 同结论（判红）", () => {
  it("`.js` 里的类型标注 ⇒ code: syntax-error + nudoOk: false", async () => {
    const dir = project({ "ts-in-js.js": "export function f(a: number): number {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ts-in-js.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(false);
    expect(rows[0]!.code).toBe("syntax-error");
  });

  it("`migrate strip` 的 namespace 产物在 verify 面同样是红的", async () => {
    const dir = project({
      "ns.js": "export namespace Helpers {\n  export const twice = 2;\n}\n",
    });
    const rows = await migrateVerify([join(dir, "ns.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(false);
    expect(rows[0]!.code).toBe("syntax-error");
  });

  it("反向闸：普通 `.js` 仍判绿", async () => {
    const dir = project({ "ok.js": "export function f(a) {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ok.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：`.ts` 里的类型标注照常判绿（严格解析按扩展名选插件）", async () => {
    const dir = project({ "ok.ts": "export function f(a: number): number {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ok.ts")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 226: verify 的 env/harvest 合并必须走 B8（harvest 填空位）
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 226: verify 的 env/harvest 合并必须走 B8（harvest 填空位）", () => {
/**
 * BUG-226 —— `nudo migrate verify` 的注入装配器仍用**对象展开**合并 env 模块
 * （而非 `mergeHarvestUnderEnv`）⇒ 手工 env 与 harvest **同名模块**时，harvest
 * 独有的导出被**整体丢弃** ⇒ 同一文件同一配置，verify 报 `unknown` + 误导性
 * `nudo:unknown-inference`，而 `nudo check` 报精确类型。
 *
 * 引擎自己的策略（两个面都打印同一条诊断）：
 * 「handwritten @nudo:env wins over harvest on module "util" — export(s) format;
 *  **harvest only fills missing slots (B8)**」——`onlyHarvest` 正是那个空位。
 *
 * 修复：改用 `mergeHarvestUnderEnv(graph.modules, envMods)`（与
 * `commands/check.ts` 的 Bug 1037 同源）。
 *
 * 判据 = **跨动词一致性**（报告自述：「同一文件 `nudo check` 与
 * `nudo migrate verify` 的诊断码集合必须相同、签名文本必须相同」）。
 *
 * 反向闸：`nudo check` 自己的签名必须是精确的 `harvested() => string`
 * （否则「两面一致」可能只是两面都错）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-226-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "p12", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  // harvest 来源：一个**自带 .d.ts** 的假包，模块名与 node env 的 `util` 同名
  const mod = join(root, "node_modules", "util");
  mkdirSync(mod, { recursive: true });
  writeFileSync(
    join(mod, "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(
    join(mod, "index.d.ts"),
    "export declare function onlyHarvest(a: string): string;\nexport declare function format(...args: unknown[]): string;\n",
    "utf-8",
  );
  writeFileSync(join(mod, "index.js"), "module.exports = { onlyHarvest: (a) => a };\n", "utf-8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "app.js"),
    [
      "/// @nudo:env node",
      'import { onlyHarvest } from "util";',
      "",
      "export function harvested() {",
      '  return onlyHarvest("x");',
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  return root;
}

/**
 * 从人类面输出里取「error / warning / fn」三元组（check 面会多一段 `N info`
 * ——统计口径只比这三项，与 `migrateVerify` 的 `nudoSummary` 同量纲）。
 */
function summaryOf(stdout: string): string | undefined {
  const m = /(\d+) error · (\d+) warning ·(?:\s*\d+ info ·)?\s*(\d+) fn/.exec(stdout);
  return m ? `${m[1]} error · ${m[2]} warning · ${m[3]} fn` : undefined;
}

describe("Bug 226: verify 的 env/harvest 合并必须走 B8（harvest 填空位）", () => {
  it("nudo check 的签名是精确类型（反向闸：前提成立）", () => {
    const root = project();
    const check = runCliTsx(["check", join(root, "src", "app.js")]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("harvested() => string");
    expect(summaryOf(check.stdout)).toBe("0 error · 1 warning · 1 fn");
    // 反向闸：check 面的签名里不得出现 `unknown`（那才是「harvest 空位被丢」的症状）
    expect(check.stdout).not.toContain("harvested() => unknown");
  });

  it("verify 与 check 的诊断统计一致（不再多出 unknown-inference）", async () => {
    const root = project();
    const check = runCliTsx(["check", join(root, "src", "app.js")]);
    const rows = await migrateVerify([join(root, "src", "app.js")], { json: true, root });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
    expect(rows[0]!.nudoSummary).toBe(summaryOf(check.stdout));
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify — 文件发现与 nudo check 同口径（Bug 566）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify — 文件发现与 nudo check 同口径（Bug 566）", () => {
/**
 * Bug 566 — `nudo migrate verify` 把 sidecar 与 `.d.ts` 当源码分析，与 `nudo check` 判定分叉。
 *
 * 根因：verify 自行按扩展名收文件（.js/.mjs/.cjs/.ts/.tsx），没走 `nudo check` 的
 * `isNudoTargetPath`（`packages/service/src/target-path.ts`）——后者显式排除
 * `.d.ts`（声明文件，不是可求值实现）与 `*.nudo.js`（侧车契约模块）。
 * ⇒ 同一棵源码树：check 绿（exit 0），verify 红（exit 1），红的原因是一行
 * `.d.ts` 声明或一个侧车。
 *
 * 判据（闸②）：`migrate verify` 与 `nudo check` 对同一份代码给出**同一结论**。
 */






const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-566-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法实现（check 面绿） */
writeFileSync(join(dir, "foo.js"), "export function foo(x) {\n  return x;\n}\n", "utf-8");
/** 侧车契约模块：不是分析目标 */
writeFileSync(join(dir, "foo.nudo.js"), "export const fooContract = {};\n", "utf-8");
/** 类型声明 + 一条真错误（旧实现下让 verify 判红） */
writeFileSync(
  join(dir, "types.d.ts"),
  "export declare function foo(x: number): string;\nexport function broken(u) {\n  return u.name;\n}\n",
  "utf-8",
);

describe("migrate verify — 文件发现与 nudo check 同口径（Bug 566）", () => {
  it("目录扫描不把 sidecar / .d.ts 当源码：verify 与 check 同绿", { timeout: 120_000 }, () => {
    const check = runCliTsx(["check", dir]);
    expect(check.status).toBe(0);

    const verify = runCliTsx(["migrate", "verify", dir]);
    // 旧行为：verify 扫到 types.d.ts → 判红 exit 1（比 check 更严）
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("foo.js");
    expect(verify.stdout).not.toContain("foo.nudo.js");
    expect(verify.stdout).not.toContain("types.d.ts");
  });

  it("显式 .d.ts 目标与 check 一样被拒（不当源码分析）", { timeout: 120_000 }, () => {
    const decl = join(dir, "types.d.ts");
    const check = runCliTsx(["check", decl]);
    expect(check.status).toBe(1);

    const verify = runCliTsx(["migrate", "verify", decl]);
    expect(verify.status).toBe(1);
    expect(verify.stdout + verify.stderr).toContain("Not an analysis target");
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify --json — stdout 是纯 JSON（Bug 568）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify --json — stdout 是纯 JSON（Bug 568）", () => {
/**
 * Bug 568 — `migrate verify --json` 把**人工报告混进 stdout**：stdout 不是合法 JSON。
 *
 * 根因：`migrateVerify` 在 per-file 循环里无条件 `console.log(formatCheckReport(report))`
 * （人工面打到 stdout），随后 CLI 再把结果数组 `JSON.stringify` 后打到 stdout ⇒
 * stdout = 「整段人工报告 + JSON 数组」拼接 ⇒ `JSON.parse(stdout)` 抛 SyntaxError。
 * 污染恰好发生在**门禁判红**时（判绿时 stdout 是纯 JSON）⇒ 机器契约在最需要解析
 * 失败详情时崩。
 *
 * 判据：`--json` 时 stdout 必须是**单一 JSON 文档**；人工报告走 stderr。
 */






const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-568-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** L2 entry may-throw（未约束形参上的属性读）→ 门禁判红 */
const RED = join(dir, "red.js");
writeFileSync(RED, "export function getName(user) {\n  return user.name;\n}\n", "utf-8");
/** 干净文件 → 门禁判绿 */
const GREEN = join(dir, "green.js");
writeFileSync(GREEN, "export function id(x) {\n  return x;\n}\n", "utf-8");

describe("migrate verify --json — stdout 是纯 JSON（Bug 568）", () => {
  it("判红文件：stdout 可 JSON.parse；人工报告在 stderr", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", RED, "--json"]);
    expect(r.status).toBe(1);

    // stdout 必须是单一 JSON 文档（旧行为：人工面在前 ⇒ parse 抛错）
    const parsed = JSON.parse(r.stdout) as Array<{ file: string; nudoOk: boolean }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.file).toContain("red.js");
    expect(parsed[0]!.nudoOk).toBe(false);

    // 人工面走 stderr（stdout 不得混入）
    expect(r.stderr).toContain("FAILED");
    expect(r.stdout).not.toContain("FAILED");
    expect(r.stdout).not.toContain("nudo check");
  });

  it("判绿文件：stdout 仍是纯 JSON（人类面不出现）", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", GREEN, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ file: string; nudoOk: boolean }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.nudoOk).toBe(true);
  });

  it("无 --json 时人工报告仍在 stdout（人类面不被误伤）", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", RED]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAILED");
    expect(r.stdout).toContain("FAIL");
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify — 批量目标的 per-file 隔离（Bug 569）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify — 批量目标的 per-file 隔离（Bug 569）", () => {
/**
 * Bug 569 — `migrate verify`（批量目标）遇**第一个**语法错文件即整批中止。
 *
 * 根因：per-file 循环没有 try/catch ⇒ 一个语法错文件抛出的异常一路冒泡到命令层
 * 唯一的 catch ⇒ 整批结果（连同已算好的行）全部丢弃：stdout **0 字节**、
 * 错误消息不带文件名（用户拿不到「哪些文件通过了」，也拿不到「哪个文件有语法错」）。
 *
 * 判据：per-file 隔离——单个文件失败**不**中止整批；失败项带**文件名**进结果；
 * `--json` 下 stdout 永不为空。
 */






const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-569-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法文件 */
writeFileSync(join(dir, "good.js"), "export function good(x) {\n  return x;\n}\n", "utf-8");
/** 语法错文件 */
writeFileSync(join(dir, "syn.js"), "export function broken( {\n  return 1;\n}\n", "utf-8");
/** 第二个合法文件（证明「不是只报第一个」） */
writeFileSync(join(dir, "good2.js"), "export function good2(x) {\n  return x;\n}\n", "utf-8");

describe("migrate verify — 批量目标的 per-file 隔离（Bug 569）", () => {
  it("文本面：合法文件仍被逐行报告，语法错文件带文件名", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir]);
    expect(r.status).toBe(1);
    // 旧行为：stdout 空（整批中止）
    expect(r.stdout).toContain("good.js");
    expect(r.stdout).toContain("good2.js");
    expect(r.stdout).toContain("syn.js");
    // 失败行必须带文件名（用户能定位是哪个文件）
    expect(r.stdout).toMatch(/error:.*syn\.js/);
  });

  it("--json 面：stdout 非空且可解析，失败项进结果数组", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir, "--json"]);
    expect(r.status).toBe(1);
    // 旧行为：stdout 0 字节（JSON.parse 抛错）
    const parsed = JSON.parse(r.stdout) as Array<{
      file: string;
      nudoOk: boolean;
      error?: string;
    }>;
    expect(parsed).toHaveLength(3);
    const good = parsed.filter((p) => p.file.includes("good"));
    expect(good).toHaveLength(2);
    expect(good.every((g) => g.nudoOk)).toBe(true);
    const bad = parsed.find((p) => p.file.includes("syn.js"));
    expect(bad).toBeDefined();
    expect(bad!.nudoOk).toBe(false);
    expect(bad!.error).toContain("syn.js");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 570 — 版本钉住的 tsc 逃过退役（检测口径 ≠ 改写口径）
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 570 — 版本钉住的 tsc 逃过退役（检测口径 ≠ 改写口径）", () => {
/**
 * Bug 570 — `migrate` 的 tsc 调用形态「检测口径与改写口径分裂」：
 * 版本钉住的 `npx tsc@5.4.5` 被 status 计入、却不被 retire 改写
 * ⇒ 假绿（tsc 门禁原样留在 CI 里，工具却报「已退役」）。
 *
 * 契约：**检测口径 = 改写口径**（同一个匹配器）——「被计入 ⇒ 必被改写」。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-570-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b570",
        version: "1.0.0",
        scripts: {
          typecheck: "npx tsc@5.4.5 --noEmit",
          typecheck2: "npx tsc --noEmit",
        },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npx tsc@5.4.5 --noEmit",
      "      - run: npx tsc --noEmit",
      "      - run: pnpm exec tsc --noEmit",
      "      - run: npx tsc -p tsconfig.json --noEmit",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("Bug 570 — 版本钉住的 tsc 逃过退役（检测口径 ≠ 改写口径）", () => {
  it("rewriteTscCommand 认得版本钉住形态 npx tsc@5.4.5", () => {
    expect(rewriteTscCommand("npx tsc@5.4.5 --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("npx tsc@5.4.5 --noEmit").changed).toBe(true);
  });

  it("status 计入的每个 tsc 脚本都被 retire 改写（脚本面）", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    // 检测口径：版本钉住那条也算 tsc
    expect(rows[0]!.tscScripts).toContain("typecheck");
    expect(rows[0]!.tscScripts).toContain("typecheck2");

    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    // 改写口径：两个脚本都被改写，仓库里不再残留 tsc 调用
    expect(pkg.scripts.typecheck).not.toContain("tsc");
    expect(pkg.scripts.typecheck2).not.toContain("tsc");
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(pkg.scripts.typecheck2).toContain("nudo check");
    // 退役后 status 不再自相矛盾地报「tsc still in scripts」
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual([]);
  });

  it("workflow 面的版本钉住行同样被计入并改写（CI 行数不多计）", () => {
    const dir = fixture();
    // 4 条 tsc 行（含版本钉住那条）
    expect(listWorkflowTscLines(dir).length).toBe(4);

    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc@5.4.5");
    expect(wf).not.toContain("tsc --noEmit");
    expect(wf).not.toContain("tsc -p");
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(4);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 577: tsc 脚本阻塞不依赖 tsFiles > 0
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 577: tsc 脚本阻塞不依赖 tsFiles > 0", () => {
/**
 * Bug 577 — `nudo migrate status` 的「tsc still in scripts」阻塞被 `tsFiles > 0` 包住：
 * 有 tsc 脚本、**0 个 .ts** 的包（恰恰是最该退役的场景）blockers 为空。
 *
 * 期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, scripts: Record<string, string>, withTs: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-577-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts }),
    "utf-8",
  );
  if (withTs) writeFileSync(join(dir, "a.ts"), "export const x = 1;\n", "utf-8");
  return dir;
}

describe("Bug 577: tsc 脚本阻塞不依赖 tsFiles > 0", () => {
  it("0 个 .ts + tsc 脚本 ⇒ 必须报「tsc still in scripts」", () => {
    const dir = pkg("r16-lc-m2", { typecheck: "tsc --noEmit", build: "tsc -p ." }, false);
    const rows = migrateStatus(dir);
    expect(rows[0]!.tsFiles).toBe(0);
    expect(rows[0]!.tscScripts).toEqual(["typecheck", "build"]);
    expect(rows[0]!.blockers).toContain("tsc still in scripts");
  });

  it("文本面同样出现该阻塞", () => {
    const dir = pkg("r16-lc-m2-text", { typecheck: "tsc --noEmit" }, false);
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("blockers: tsc still in scripts");
  });

  it("有 .ts + tsc 脚本 ⇒ 仍然报（口径不回退）", () => {
    const dir = pkg("with-ts", { typecheck: "tsc --noEmit" }, true);
    expect(migrateStatus(dir)[0]!.blockers).toContain("tsc still in scripts");
  });

  it("反向闸：没有 tsc 脚本 ⇒ 不得报该阻塞", () => {
    const dir = pkg("no-tsc", { build: "node build.js" }, true);
    expect(migrateStatus(dir)[0]!.blockers).not.toContain("tsc still in scripts");
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify --with-tsc — tsc 基线带信号（Bug 582）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify --with-tsc — tsc 基线带信号（Bug 582）", () => {
/**
 * Bug 582 — `nudo migrate verify --with-tsc` 的 tsc 基线**不带任何信号**。
 *
 * 根因：源文件被当**位置参数**传给 tsc ⇒ 现代 TS 见到「命令行给了文件 + 目录里
 * 有 tsconfig.json」直接拒绝（TS5112）⇒ 干净文件与有错文件的基线**逐字相同**；
 * 且 `opts.root` 从未由 CLI 传入 ⇒ cwd 是**进程 cwd** ⇒ 连 tsconfig 都定位不对。
 *
 * 判据：基线必须**真的加载 tsconfig**（`-p`）并携带**与被检文件相关**的诊断 ⇒
 * 干净文件与有错文件的基线必须不同。
 *
 * 夹具放在仓库的 tmp/ 下（gitignored）：`pnpm exec tsc` 需要能解析到
 * node_modules/.bin/tsc（仓库根已装 typescript）。
 */





const dir = join(repoRoot, "tmp", `nudo-migrate-582-${process.pid}`);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
    },
    include: ["*.ts"],
  }),
  "utf-8",
);
/** 干净文件 */
writeFileSync(
  join(dir, "clean.ts"),
  "export function addOne(x: number): number {\n  return x + 1;\n}\n",
  "utf-8",
);
/** 真实类型错误（strict 下 `x` 可能 undefined） */
writeFileSync(
  join(dir, "bad.ts"),
  "export function maybeStr(x: string | undefined): string {\n  return x.toUpperCase();\n}\n",
  "utf-8",
);

type Row = {
  file: string;
  nudoOk: boolean;
  tsc?: { ok: boolean; output: string };
};

describe("migrate verify --with-tsc — tsc 基线带信号（Bug 582）", () => {
  it("基线加载 tsconfig：干净文件与有错文件的诊断不同", { timeout: 300_000 }, () => {
    const r = runCliTsx(["migrate", "verify", "--with-tsc", dir, "--json"]);
    const rows = JSON.parse(r.stdout) as Row[];
    const clean = rows.find((x) => x.file.endsWith("clean.ts"));
    const bad = rows.find((x) => x.file.endsWith("bad.ts"));
    expect(clean).toBeDefined();
    expect(bad).toBeDefined();
    expect(clean!.tsc).toBeDefined();
    expect(bad!.tsc).toBeDefined();

    // 旧行为：两条基线逐字相同（都是 TS5112「tsconfig 不会被加载」）
    expect(clean!.tsc!.output).not.toContain("TS5112");
    expect(bad!.tsc!.output).not.toContain("TS5112");

    // 有错文件：基线带**该文件**的真实诊断
    expect(bad!.tsc!.ok).toBe(false);
    expect(bad!.tsc!.output).toContain("TS18048");
    expect(bad!.tsc!.output).toContain("bad.ts");

    // 干净文件：基线无诊断 ⇒ 与有错文件的基线**必然不同**
    expect(clean!.tsc!.ok).toBe(true);
    expect(clean!.tsc!.output).not.toBe(bad!.tsc!.output);
  });

  it("文本面：干净文件显示 tsc: ok，有错文件显示 tsc: diagnostics", { timeout: 300_000 }, () => {
    const r = runCliTsx(["migrate", "verify", "--with-tsc", dir]);
    expect(r.stdout).toContain("tsc: diagnostics");
    expect(r.stdout).toContain("tsc: ok");
    expect(r.stdout).toContain("TS18048");
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify — 空目录不是绿灯通行证（Bug 589）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify — 空目录不是绿灯通行证（Bug 589）", () => {
/**
 * Bug 589 — `nudo migrate verify <空目录>` **静默 exit 0**（零输出、零文件）。
 *
 * 根因：verify 的文件收集为空时没有「空 ⇒ 失败/警告」的判定 ⇒ 迁移闸门
 * （status → strip → verify → retire）里，verify 是唯一用来证明「产物已经能用」
 * 的步骤，对着空目录拿到 exit 0 等于给出一条**无意义但绿色**的通行证。
 * 而 `nudo check` 对**同一个目录**报「No nudo files found」并 exit 1 ⇒ 两个面
 * 对「这里没有任何可分析的文件」给出相反结论。
 *
 * 判据（闸②）：verify 与 check 对**空输入**给出同一结论（红 + 引导）。
 */






const root = join(tmpdir(), `nudo-migrate-589-${process.pid}`);
const dir = join(root, "empty");
mkdirSync(dir, { recursive: true });
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("migrate verify — 空目录不是绿灯通行证（Bug 589）", () => {
  it("文本面：空目录判红并给出引导（与 check 同口径）", { timeout: 120_000 }, () => {
    const check = runCliTsx(["check", dir]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("No nudo files found");

    const verify = runCliTsx(["migrate", "verify", dir]);
    // 旧行为：零输出、零诊断、exit 0
    expect(verify.status).toBe(1);
    expect(verify.stdout).toContain("No nudo files found");
    expect(verify.stdout).toContain("fix:");
  });

  it("--json 面：stdout 非空且可解析，空集被标成失败", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir, "--json"]);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as Array<{
      file: string;
      nudoOk: boolean;
      code?: string;
    }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]!.nudoOk).toBe(false);
    expect(parsed[0]!.code).toBe("no-files");
  });
});
});

// ---------------------------------------------------------------------------
// migrate verify — 分析注入与 nudo check 同源（Bug 593）
// ---------------------------------------------------------------------------
describe("[migrate-] migrate verify — 分析注入与 nudo check 同源（Bug 593）", () => {
/**
 * Bug 593 — `nudo migrate verify` 的**分析注入**缺失（无模块图 / 无 mock）⇒ 与
 * `nudo check` **判相反**（两个方向都相反）：
 *
 * - 方向 A（跨模块 ⇒ **假绿**）：被调函数的 throws 面不传播给调用点 ⇒
 *   `nudo check` 判红（entry-may-throw），verify 判绿 ⇒ 迁移闸门放行了 CI 门禁
 *   拒绝的文件 ⇒ `retire` 会在 check 仍红的情况下把 tsc 退役。
 * - 方向 B（`@nudo:mock` ⇒ **假红** + 误导诊断）：verify 侧不施加 mock ⇒
 *   helper 未定义 ⇒ 报「may throw ReferenceError」，cause 文案把用户引向
 *   「你用了 `export { x } from` 重导出写法」——照着改永远不会好。
 *
 * 根因：`migrateVerify` 的 `checkSource` 调用既不传 `modules` 也不传 `inject`
 * （对照 `packages/nudojs/src/commands/check.ts` 的 `{ modules, inject }`）。
 *
 * 判据（闸②）：`migrate verify` 与 `nudo check` 对同一份源码给出**同一结论**。
 */






const root = join(tmpdir(), `nudo-migrate-593-${process.pid}`);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(repoRoot, "tmp", `nudo-migrate-593-env-${process.pid}`), {
    recursive: true,
    force: true,
  });
});

/** 方向 A：跨模块调用（dep 的 throws 面应传播给调用点） */
const cross = join(root, "cross");
mkdirSync(cross, { recursive: true });
writeFileSync(
  join(cross, "dep.js"),
  "export function risky(x) {\n  return x.toFixed(2);\n}\n",
  "utf-8",
);
writeFileSync(
  join(cross, "main.js"),
  'import { risky } from "./dep.js";\nexport function entry(a) {\n  return risky(a);\n}\n',
  "utf-8",
);

/** 方向 B：`@nudo:mock`（mock 生效 ⇒ helper 已知 ⇒ 绿） */
const mock = join(root, "mock");
mkdirSync(mock, { recursive: true });
writeFileSync(join(mock, "mock.js"), "export const helper = (a) => a;\n", "utf-8");
writeFileSync(
  join(mock, "mocked.js"),
  '/**\n * @nudo:mock helper from "./mock.js"\n */\nexport function entryMock(a) {\n  return helper(a);\n}\n',
  "utf-8",
);

/** 方向 C：坏 `@nudo:mock`（mock 文件缺失 ⇒ 双方都必须判红） */
const badMock = join(root, "badmock");
mkdirSync(badMock, { recursive: true });
writeFileSync(
  join(badMock, "mocked.js"),
  '/**\n * @nudo:mock dep from "./missing-mock.js"\n * @nudo:throws TypeError\n */\nexport function entryBad(a) {\n  return dep(a);\n}\n',
  "utf-8",
);

/**
 * 方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。
 * 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from "@nudojs/core"`
 * ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。
 */
const envPath = join(repoRoot, "tmp", `nudo-migrate-593-env-${process.pid}`);
mkdirSync(envPath, { recursive: true });
writeFileSync(
  join(envPath, "env.ts"),
  'import { strLit } from "@nudojs/core";\nexport function defineEnv() {\n  return { globals: { MODE: strLit("on") } };\n}\n',
  "utf-8",
);
writeFileSync(
  join(envPath, "lib.js"),
  "/// @nudo:env ./env.ts\nexport function mode() {\n  return MODE;\n}\n",
  "utf-8",
);

function verdict(args: string[]): { status: number; out: string } {
  const r = runCliTsx(args);
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("migrate verify — 分析注入与 nudo check 同源（Bug 593）", () => {
  it("跨模块：verify 不再假绿（与 check 同判红）", { timeout: 120_000 }, () => {
    const file = join(cross, "main.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(1);
    // 旧行为：verify 判绿（exit 0）⇒ 迁移闸门放行 CI 门禁拒绝的文件
    expect(verify.status).toBe(1);
    expect(verify.out).toContain("FAIL");
  });

  it("@nudo:mock：verify 不再假红（与 check 同判绿）", { timeout: 120_000 }, () => {
    const file = join(mock, "mocked.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(0);
    // 旧行为：verify 判红（mock 没被注入 ⇒ may throw ReferenceError）
    expect(verify.status).toBe(0);
    expect(verify.out).not.toContain("ReferenceError");
  });

  it("path 型 @nudo:env：verify 与 check 同判绿（env 预载必须同口径）", { timeout: 120_000 }, () => {
    const file = join(envPath, "lib.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(0);
    // 旧行为：verify 判红（env 没被预载 ⇒ may throw ReferenceError）
    expect(verify.status).toBe(0);
    expect(verify.out).not.toContain("ReferenceError");
  });

  it("坏 @nudo:mock：verify 与 check 同判红（mock 解析失败必须可见）", { timeout: 120_000 }, () => {
    const file = join(badMock, "mocked.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(1);
    expect(verify.status).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 917 — migrate strip 的 .cts 扩展名映射与告警口径
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 917 — migrate strip 的 .cts 扩展名映射与告警口径", () => {
/**
 * Bug 917 — `migrate strip` 只剥类型、**不改模块系统**：`.cts` 产物里仍是
 * 源侧的 import/export 语法，因此产物形态不得被静默当成 CommonJS。
 *
 * 口径沿革：
 * - 原修复把 `.cts → .js`（不谎称 CommonJS，模块系统由最近的
 *   package.json#type 决定），并在 notes 里如实说明。
 * - Bug 26（类别 08）改为 `.cts → .cjs`，与 tsc / Node 解析序一致且与
 *   `.mts → .mjs` 对称，避免 `.ts` 与 `.cts` 同 stem 时争用同一个 `index.js`
 *   产物（整批产物路径冲突另由 assertUniqueStripProducts 硬错误拦住）。
 *   此时「不谎称」的责任落在 **notes 告警**上：`.cjs` 恒被 Node 当 CommonJS，
 *   若产物仍是 ESM 语法，用户必须先转换模块语法再加载。
 *   `.cjs` 现已是 `isNudoTargetPath` 的目标扩展名，门禁不会零覆盖。
 *
 * 本分片钉的是「映射与说明符同口径 + notes 如实告警」这两条不变量。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 917 — migrate strip 的 .cts 扩展名映射与告警口径", () => {
  it(".cts ⇒ 产物是 .cjs（Bug 26 / tsc 同口径），且 notes 如实说明模块系统未转换", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-917-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a.cts"),
      `export function greet(name: string): string {\n  return name;\n}\n`,
      "utf-8",
    );

    const results = await migrateStrip([dir], { write: true, draft: false });

    // Bug 26：与 tsc / Node 解析序一致，且不再与同 stem 的 .ts 争用 index.js
    expect(existsSync(join(dir, "a.cjs"))).toBe(true);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
    expect(readFileSync(join(dir, "a.cjs"), "utf-8")).toContain("function greet");

    // 如实警告：`.cjs` 恒按 CommonJS 解析，但 strip 产物仍是源侧 ESM 语法
    const notes = results.flatMap((r) => r.notes).join("\n");
    expect(notes).toMatch(/\.cts/);
    expect(notes).toMatch(/does not transform module systems/);
    expect(notes).toMatch(/the \.cjs product/);
  });

  it(".mts ⇒ 产物仍是 .mjs（ESM 源 ⇒ ESM 产物，映射本来就一致）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-917b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.mts"), `export const v: number = 1;\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false });
    expect(existsSync(join(dir, "a.mjs"))).toBe(true);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 943 — 路径限定型 tsc 被计入却不被改写
// ---------------------------------------------------------------------------
describe("[migrate-] Bug 943 — 路径限定型 tsc 被计入却不被改写", () => {
/**
 * Bug 943 — `nudo migrate retire` 的 tsc **检测口径与改写口径不一致**
 * ⇒ 路径限定型的 tsc（`./node_modules/.bin/tsc`）被 status 计入、却不被 retire 改写
 * ⇒ `typescript` 依赖被删、tsc 调用却留着（落盘仓库自相矛盾）。
 *
 * 契约：检测与改写**同一个匹配器**——「被计入 ⇒ 必被改写」。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-943-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b943",
        version: "1.0.0",
        type: "module",
        scripts: {
          typecheck: "tsc --noEmit",
          gate2: "./node_modules/.bin/tsc --noEmit",
        },
        devDependencies: { typescript: "^5.6.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npx tsc --noEmit",
      "      - run: ./node_modules/.bin/tsc --noEmit",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("Bug 943 — 路径限定型 tsc 被计入却不被改写", () => {
  it("rewriteTscCommand 认得路径限定型 tsc", () => {
    expect(rewriteTscCommand("./node_modules/.bin/tsc -p .").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("node_modules/.bin/tsc --noEmit").cmd).toBe(
      "npx nudojs check .",
    );
  });

  it("status 计入的脚本 / CI 行数与改写数一致", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    expect(rows[0]!.tscScripts).toContain("gate2");
    // 2 条 tsc 行（路径限定那条也算）
    expect(listWorkflowTscLines(dir).length).toBe(2);
  });

  it("retire 后仓库里不再残留任何 tsc 调用（依赖已删，门禁必须同时退役）", () => {
    const dir = fixture();
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).not.toContain("tsc");
    expect(pkg.scripts.gate2).not.toContain("tsc");
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc");
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(2);
    // 退役后 status 不再报「tsc still in scripts」
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual([]);
  });
});
});
