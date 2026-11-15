/**
 * 模块套件：nudojs health/watch 面。
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig, runCliNode as runCli } from "./helpers/run-cli.ts";
import { runWatchCli, extractJsonDocs } from "./helpers/run-watch-cli.ts";
import { startWatch, collectNudoFiles } from "../commands/shared.ts";
import { noteEnvPathDeps, clearEnvPathDeps } from "@nudojs/service";
import { startCheckWatch } from "../commands/check-command.ts";

// ---------------------------------------------------------------------------
// 见证身份必须保留现场组件（同号不同现场 ≠ 同一调用点）
// ---------------------------------------------------------------------------
describe("见证身份必须保留现场组件（同号不同现场 ≠ 同一调用点）", () => {
/**
 * `nudo health` 的见证身份把「不同现场文件里的**同号**调用点」折叠成
 * 一个（`call@a.js:L2` 与 `call@b.js:L2` 都归一成 `call@L2`）⇒ **调用点被删除**
 * 这种最典型的漂移完全看不见（「调用被挪走抓得住、调用被删掉抓不住」）。
 *
 * 修复：见证身份 = **现场 + 行号**；「命名方案归一」（`call@<site>:L<n>` vs
 * `call@L<n>`）只在一侧带现场、另一侧不带时成立。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

/** 两条已冻结的见证：同一行号、**两个不同**现场文件 */
const LIB = `/**
 * @nudo:case "call@a.js:L2" ("Hello World")
 * @nudo:case "call@b.js:L2" ("Goodbye World")
 */
export function slugify(s) {
  return String(s).trim().toLowerCase();
}
`;

const A_CALL = `import { slugify } from "./lib.js";
slugify("Hello World");
`;

const B_CALL = `import { slugify } from "./lib.js";
slugify("Goodbye World");
`;

/** b.js 的调用点已被**删除**（同一行号上只剩一个类型探针） */
const B_DELETED = `import { slugify } from "./lib.js";
console.log(typeof slugify);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-036-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("a.js"), A_CALL);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("见证身份必须保留现场组件（同号不同现场 ≠ 同一调用点）", () => {
  it("另一现场文件的调用点被**删除** ⇒ 报 drift + exit 1（旧行为：0 drift / OK / exit 0）", () => {
    writeFileSync(p("b.js"), B_DELETED);
    const r = runCliTsx(["health", p("lib.js"), "--from", p("a.js"), p("b.js")], { cwd: dir });
    // 删除类漂移必须可见（旧口径：newKeys 里 `call@L2` 命中 ⇒ removed = 0）
    expect(r.stdout, r.stdout).toContain("drift:");
    expect(r.stdout).toMatch(/-1 removed\)/);
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.status).toBe(1);
  }, 60_000);

  it("对照组：两个现场文件的调用点都在 ⇒ 0 case drift / exit 0", () => {
    writeFileSync(p("b.js"), B_CALL);
    const r = runCliTsx(["health", p("lib.js"), "--from", p("a.js"), p("b.js")], { cwd: dir });
    expect(r.stdout, r.stdout).toContain("0 case drift");
    expect(r.stdout).not.toContain("drift:");
    expect(r.status).toBe(0);
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// 从未冻结的文件 + --from ⇒ 0 drift（不发假红）
// ---------------------------------------------------------------------------
describe("从未冻结的文件 + --from ⇒ 0 drift（不发假红）", () => {
/**
 * `nudo health --from` 对**从未冻结**（没有任何 `call@` 见证）的文件
 * 发**假红**——重新固化后多出来的见证被算成 `added`。
 *
 * 代码自己的不变量（health.ts 的 683 注释 / CHANGELOG 936）：
 * 「只有**存在待验证的冻结见证**时才判『无法判定』——没有冻结见证时
 * 『0 drift』属实（不得因此给合法用法发假红）」。
 *
 * 修复：漂移判定同时要求 `frozenWitnesses > 0`。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

/** 从未冻结：没有任何 @nudo:case / call@ 指令 */
const LIB = `export function shout(s) {
  return String(s).toUpperCase();
}
`;

const USAGE = `import { shout } from "../lib2.js";
shout("hi");
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-037-"));
  mkdirSync(p("tests"));
  writeFileSync(p("lib2.js"), LIB);
  writeFileSync(p("tests/usage.js"), USAGE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("从未冻结的文件 + --from ⇒ 0 drift（不发假红）", () => {
  it("文本面：0 case drift / Result: OK / exit 0（旧行为：1 case drift / FAIL / exit 1）", () => {
    const r = runCliTsx(["health", p("lib2.js"), "--from", p("tests/usage.js")], { cwd: dir });
    expect(r.stdout, r.stdout).toContain("0 case drift");
    expect(r.stdout).not.toContain("drift:");
    expect(r.stdout).toContain("Result: OK");
    expect(r.status).toBe(0);
  }, 60_000);

  it("--json 面：ok:true 且 files[0] 无 drift 字段", () => {
    const r = runCliTsx(["health", "--json", p("lib2.js"), "--from", p("tests/usage.js")], {
      cwd: dir,
    });
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: unknown }>;
      summary: { drift: number };
    };
    expect(json.ok).toBe(true);
    expect(json.summary.drift).toBe(0);
    expect(json.files[0]?.drift).toBeUndefined();
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// health --json 的缺失路径必须进 pathErrors[] / targetErrors[]
// ---------------------------------------------------------------------------
describe("health --json 的缺失路径必须进 pathErrors[] / targetErrors[]", () => {
/**
 * `nudo health --json <缺失路径>` 的缺失路径**不进** `pathErrors[]` /
 * `targetErrors[]` ⇒ 机器面只有 `ok:false` + 一句没有机器码的自然语言
 * （`check --json` 对同一路径给了码 + 修复建议）。
 *
 * 根因：缺失路径分支在 `resolveTargetsCollect` **之前**就 `continue`。
 * 修复：同一分支产出同款 PathError（`nudo:path-not-found`）⇒ 三个动词的路径级
 * 错误口径一致；文件条目（「File not found」）保留，但**不重复计数**。
 */






describe("health --json 的缺失路径必须进 pathErrors[] / targetErrors[]", () => {
  it("--json 面：机器码 nudo:path-not-found + errors 只计 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-038-"));
    const missing = join(dir, "nope.js");
    try {
      const r = runCliTsx(["health", "--json", missing], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        pathErrors?: Array<{ path: string; code: string; message: string; suggestion?: string }>;
        targetErrors?: Array<{ path: string; code: string }>;
        files: Array<{ file: string; error?: string }>;
        summary: { errors: number };
      };
      expect(json.ok).toBe(false);
      // 旧行为：pathErrors / targetErrors 都不存在（机器面拿不到原因）
      expect(json.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
      expect(json.pathErrors?.[0]?.path).toBe(missing);
      expect(json.pathErrors?.[0]?.message).toContain("Not found");
      expect(json.pathErrors?.[0]?.suggestion).toBeTruthy();
      expect(json.targetErrors?.[0]?.code).toBe("nudo:path-not-found");
      // 同一个缺失路径只计 1 个错（不是「文件条目 + 路径错误」各计一次）
      expect(json.summary.errors).toBe(1);
      // 文件条目保留（既有 stdout 面「File not found」的事实源）
      expect(json.files[0]?.error).toContain("File not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("文本面：仍打「File not found」+「1 error(s)」+ 路径错误修复建议", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-038b-"));
    const missing = join(dir, "nope.js");
    try {
      const r = runCliTsx(["health", missing], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("File not found");
      expect(r.stdout).toContain("1 error(s)");
      expect(r.stdout).toContain("Result: FAIL");
      expect(r.stderr).toContain("Not found");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// health --json 的用法错误也必须产出 JSON 信封
// ---------------------------------------------------------------------------
describe("health --json 的用法错误也必须产出 JSON 信封", () => {
/**
 * `nudo health --json --from <file>`（**无位置路径**）⇒ usage 错误只写
 * stderr、stdout **0 字节** ⇒ 机器消费方 `JSON.parse("")` 直接抛
 * （违反 `--json` 契约：stdout 永不为空 / 绝不「空 stdout + 非零 exit」）。
 *
 * 修复：该分支在 `--json` 下也打印合法信封（`{ ok:false, error, suggestion }`）
 * + exit 1。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

const LIB = `export function add(a, b) {
  return a + b;
}
add(1, 2);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-113-"));
  writeFileSync(p("lib.js"), LIB);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health --json 的用法错误也必须产出 JSON 信封", () => {
  it("--json --from <file>（无位置路径）⇒ stdout 可解析 + ok:false + exit 1", () => {
    const r = runCliTsx(["health", "--json", "--from", p("lib.js")], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.length, "stdout 不得为空（机器面 JSON.parse 会抛）").toBeGreaterThan(0);
    const json = JSON.parse(r.stdout) as { ok: boolean; error?: string; suggestion?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain("requires explicit paths");
    expect(json.suggestion).toContain("--from");
  }, 60_000);

  it("对照：位置路径在场时 --json --from 正常产出健康文档（不回归）", () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("lib.js")], { cwd: dir });
    const json = JSON.parse(r.stdout) as { ok: boolean; summary: { files: number } };
    expect(json.summary.files).toBe(1);
    expect(typeof json.ok).toBe("boolean");
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// health 与 contract --emit 的漂移结论必须一致
// ---------------------------------------------------------------------------
describe("health 与 contract --emit 的漂移结论必须一致", () => {
/**
 * `nudo health` 的 contract drift 口径（`checkSource` 的
 * `nudo:contract-drift` = **@generated 槽的内容**）与
 * `nudo contract --emit --dry-run --exit-on-diff` 的口径（**整段文本**，含段头
 * 标签 `// derived-from:`）**不同** ⇒ 段头漂移**只对 emit 可见** ⇒ 同一份侧车
 * health「0 contract drift / Result: OK / exit 0」、emit「会变 / exit 1」
 * （两面结论矛盾）。
 *
 * 修复：health 补一条「直写发射器说侧车会变 ⇒ 也是漂移」的**段文本**通道
 * （`emitContract` + `dryRun`，与 emit 的 `changed` 判据逐字同源）⇒ 两面同结论。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

const LIB = `export function f(x) {
  return x + 1;
}
f(1);
`;

/** 段头漂移：槽内容**正确**，多一行今天的直写发射器不会写的 `// derived-from:` */
const STALE_HEADER_SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
// derived-from: lib.js:bar
export const f = fn({ x: lit(1) }, lit(2));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-199-"));
  writeFileSync(p("lib.js"), LIB);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health 与 contract --emit 的漂移结论必须一致", () => {
  it("段头漂移：health 报 contract drift（旧行为：0 / OK / exit 0）且与 emit 同结论", () => {
    writeFileSync(p("lib.nudo.js"), STALE_HEADER_SIDECAR);
    const health = runCliTsx(["health", p("lib.js")], { cwd: dir });
    const emit = runCliTsx(["contract", p("lib.js"), "--emit", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    // emit：侧车会变（段头被今天的重算抹掉）
    expect(emit.status, emit.stdout).toBe(1);
    // health：同一份漂移必须可见（槽级判据看不见段头）
    expect(health.stdout, health.stdout).toMatch(/contract drift: [1-9]\d* @generated/);
    expect(health.stdout).not.toContain("Result: OK");
    // **同结论**：两面都红
    expect(health.status).toBe(1);
  }, 60_000);

  it("对照组：emit 刷新后侧车已是最新 ⇒ 两面都绿（0 drift / exit 0）", () => {
    const emitAll = runCliTsx(["contract", p("lib.js"), "--emit"], { cwd: dir });
    expect(emitAll.status, emitAll.stdout + emitAll.stderr).toBe(0);
    const health = runCliTsx(["health", p("lib.js")], { cwd: dir });
    const emit = runCliTsx(["contract", p("lib.js"), "--emit", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    expect(health.stdout, health.stdout).toContain("0 contract drift");
    expect(health.status).toBe(0);
    expect(emit.status, emit.stdout).toBe(0);
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// 文件级 @nudo:env 按文件目录解析（与 check 同口径）
// ---------------------------------------------------------------------------
describe("文件级 @nudo:env 按文件目录解析（与 check 同口径）", () => {
/**
 * `nudo health` 的契约漂移判定把**文件级** `@nudo:env` 的**相对**说明符
 * 按**项目根**解析（应为**文件所在目录**）⇒ env 全局丢失 ⇒ 同一份陈旧
 * `@generated` 段：`nudo check` 报 `nudo:contract-drift`，`nudo health` 报
 * 「0 contract drift」（漂移计数相反 / 假绿）。
 *
 * 修复：env 名**分层**解析（与 `nudo check` 的 assembleEnvs 同口径）——
 * 项目级按项目根并绝对化、文件级按文件目录，两次 `preloadPathEnvs`。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

/** 项目根（配置在这里，env 文件在**子目录**里） */
const PKG = `{ "name": "p22", "version": "1.0.0", "type": "module", "nudo": {} }\n`;

/** 文件级 env：相对说明符 `./myenv.js` ⇒ 解析基准必须是**文件所在目录** */
const SRC = `/// @nudo:env ./myenv.js
export function f(n) {
  return typeof MAGIC === "number" ? MAGIC : 99;
}
f(1);
`;

const ENV = `export function defineEnv() {
  return { globals: { MAGIC: 1 } };
}
`;

/** 陈旧的 @generated 段（今日返回应是 1） */
const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: m.js:f
export const f = fn({ n: lit(1) }, lit(99));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-228-"));
  mkdirSync(p("src"));
  writeFileSync(p("package.json"), PKG);
  writeFileSync(p("src/m.js"), SRC);
  writeFileSync(p("src/myenv.js"), ENV);
  writeFileSync(p("src/m.nudo.js"), SIDECAR);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("文件级 @nudo:env 按文件目录解析（与 check 同口径）", () => {
  it("health 与 check 同计数：陈旧的 @generated 段 ⇒ 报 contract drift（旧行为：0）", () => {
    const check = runCliTsx(["check", p("src/m.js")], { cwd: dir });
    expect(check.stdout, check.stdout).toContain("nudo:contract-drift");
    const health = runCliTsx(["health", p("src/m.js")], { cwd: dir });
    // 旧行为：Summary 写「0 contract drift」（env 全局丢失 ⇒ 今日域无证据）
    expect(health.stdout, health.stdout).toMatch(/contract drift: [1-9]\d* @generated slot\(s\)/);
    expect(health.stdout).not.toContain("0 contract drift");
    expect(health.status).toBe(1);
  }, 90_000);
});
});

// ---------------------------------------------------------------------------
// 族 63-1: health Summary 的漂移数与明细行同量纲（见证条数）
// ---------------------------------------------------------------------------
describe("族 63-1: health Summary 的漂移数与明细行同量纲（见证条数）", () => {
/**
 * 族 63 · nudojs CLI 协议面（W16）—— health 文本面量纲 / `pathErrors[]` 命名 /
 * watch 多轮 JSON 形态，三条精度债。
 *
 * 1. **health 文本面两处量纲不一**：Summary 的「N case drift」计**有漂移的文件数**，
 * 明细行计**见证条数** ⇒ 同一份报告里两个「N」量纲不同（用户读到的数自相矛盾）。
 * 修法：Summary 的数 = **见证（case）条数**（= Σ 明细行的条数）⇒ 标签
 * 「case drift」与数字终于同义；`--json` 的 `summary.drift` 同一量纲。
 * 2. **`pathErrors[]` 命名漂移**：C1 把「分析目标闸门」错误也推进了同一个 sink
 * ⇒ 该数组名不再只表示「--from 路径错误」。
 * 修法：**`pathErrors[]` 字段名与内容逐字保留**（兼容既有机器消费者），
 * **新增可选字段 `targetErrors[]`**（分析目标闸门错误的精确子集）⇒ 语义可见。
 * 3. **watch 多轮累积的 JSON 形态**：第 2 轮起 stdout 里会有第 2 份文档
 * ⇒ 机器消费者 `JSON.parse(stdout)` 炸。
 * 修法：watch `--json` ⇒ **JSON Lines**（每行一份完整 JSON 文档）；
 * **非 watch 的单轮输出逐字不变**（既有金标钉的形态）。
 *
 * 钉法：
 * - 文本面 / JSON 面：真跑 CLI（`runCliTsx`），断言**等式**（Summary 的数 ==
 * Σ 明细行的条数）。
 * - watch 面：真起常驻进程（`runWatchCli`），**改文件触发第 2 轮** ⇒ stdout
 * 必须是**两行**，每行各自 `JSON.parse` 得通。
 * - 负控：**非 watch 的单轮 stdout 逐字不变**（用 `git archive HEAD` 抽出的
 * 改前输出做基线常量，逐字比对）。
 */







// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

/**
 * 漂移 fixture：**一个**文件里有**两条**陈旧见证 ⇒
 * 「有漂移的文件数」= 1，「见证条数」= 2 ⇒ 两个量纲**可区分**（旧口径 Summary
 * 印 1、明细行印 2 ⇒ 自相矛盾）。
 */
const DRIFT_LIB = `/**
 * @nudo:case "call@L2" ("Hello")
 */
export function up(s) {
  return s.toUpperCase();
}

/**
 * @nudo:case "call@L3" ("Hello")
 */
export function down(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：两个调用点（usage.js 第 2/3 行），实参与冻结见证不同 ⇒ 两条见证都陈旧 */
const DRIFT_USAGE = `import { up, down } from "./lib.js";
console.log(up("Goodbye"));
console.log(down("Goodbye"));
`;

/** 干净 fixture（无漂移）：负控的逐字基线 */
const CLEAN_LIB = `export function libFn(x) {
  return x + 1;
}
`;

/**
 * 非.watch 单轮输出基线（clean fixture 实跑后**逐字**钉住；族 63 负控的
 * 「逐字不变」指 watch 改造不改变单轮形态——后续 additive 字段
 * （summary.unknownSignatures / widenedWitnesses 精度计数）随特性一并更新）。
 * 负控：非 watch 的单轮 stdout 必须与它**逐字一致**。
 */
const CLEAN_JSON_BEFORE = `{
  "ok": true,
  "files": [
    {
      "file": "clean.js",
      "functions": 1,
      "entryOnly": 1,
      "uncovered": [
        "libFn"
      ],
      "budget": {
        "calls": 0,
        "maxCalls": 20000,
        "forks": 0,
        "maxForks": 5000,
        "callTruncated": false,
        "forkTruncated": false,
        "truncated": false,
        "evalCalls": 0,
        "maxEvalCalls": 20000,
        "evalCallTruncated": false,
        "cycleTruncated": false,
        "loopTruncated": false,
        "reasons": [],
        "callReasons": [],
        "depth": 0,
        "maxDepth": 64,
        "evalReasons": [],
        "evalDepth": 0,
        "maxEvalDepth": 64
      },
      "internal_fallbacks": 0
    }
  ],
  "summary": {
    "files": 1,
    "drift": 0,
    "contractDrift": 0,
    "errors": 0,
    "uncovered": 1,
    "unknownSignatures": 0,
    "widenedWitnesses": 0,
    "internal_fallbacks": 0
  }
}
`;

const CLEAN_TEXT_BEFORE = `clean.js
  · 1 function(s), 1 entry-only
  ⚠ uncovered (no call-site evidence): libFn

Summary: 1 file(s) · 0 case drift · 0 contract drift · 0 error(s) · 1 uncovered function(s) · 0 unknown signature(s) · 0 #widened witness(es)
Result: OK (uncovered function(s) are informational only)
`;

let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-63-"));
  // 本文件 spawn CLI 的 cwd 是夹具目录（负控 + watch）⇒ 必须钉 src tsconfig，
  // 否则 tsx 按 cwd 找 tsconfig 会解析到各包 dist（陈旧构建）⇒ 测到的不是
  // 仓内实现（run-cli.ts 的 writeSrcTsconfig 惯例；health/test 报告语义
  // 变更后尤为致命——dist 无新导出直接 SyntaxError）。
  writeSrcTsconfig(dir);
  writeFileSync(p("lib.js"), DRIFT_LIB);
  writeFileSync(p("usage.js"), DRIFT_USAGE);
  writeFileSync(p("clean.js"), CLEAN_LIB);
  writeFileSync(p("types.d.ts"), "export declare function g(x: number): number;\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. health 文本面：Summary 与明细行同量纲
// ---------------------------------------------------------------------------

describe("族 63-1: health Summary 的漂移数与明细行同量纲（见证条数）", () => {
  it("文本面：Summary 的「N case drift」== Σ 明细行的「N witness directive(s) changed」", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.status).toBe(1);

    // 明细行：每个有漂移的文件一行「N witness directive(s) changed」
    const detail = [...r.stdout.matchAll(/(\d+) witness directive\(s\) changed/g)].map((m) =>
      Number(m[1]),
    );
    expect(detail.length, `stdout:\n${r.stdout}`).toBe(1);
    expect(detail[0]).toBe(2);

    // Summary：同一个数（同一量纲）
    const summary = /Summary: .*?· (\d+) case drift/.exec(r.stdout);
    expect(summary, `stdout:\n${r.stdout}`).not.toBeNull();
    const summaryDrift = Number(summary![1]);

    // 等式：Summary 的数 == 明细行的数之和
    expect(summaryDrift).toBe(detail.reduce((a, b) => a + b, 0));
    // 且它**不是**「有漂移的文件数」（= 1）⇒ 旧口径（文件数）会被本钉抓住
    expect(summaryDrift).toBe(2);
    expect(summaryDrift).not.toBe(1);
  });

  it("--json 面：summary.drift 与 Σ files[].drift 同量纲（同为见证条数）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: { added: number; removed: number } }>;
      summary: { drift: number; files: number };
    };
    expect(parsed.ok).toBe(false);
    // 只有一个文件，但漂移的是**两条**见证 ⇒ 两个量纲可区分
    expect(parsed.files.length).toBe(1);
    const cases = parsed.files.reduce(
      (n, f) => n + (f.drift ? f.drift.added + f.drift.removed : 0),
      0,
    );
    expect(cases).toBe(2);
    // summary.drift 与每文件 drift 之和**同量纲**（旧口径是文件数 = 1）
    expect(parsed.summary.drift).toBe(cases);
    expect(parsed.summary.drift).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. pathErrors[] 命名漂移：字段逐字保留 + 新增语义可见的 targetErrors[]
// ---------------------------------------------------------------------------

describe("族 63-2: pathErrors[] 逐字保留 + targetErrors[] 让语义可见", () => {
  it("分析目标闸门错误：pathErrors[] 原样保留 + targetErrors[] 精确可见", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("types.d.ts")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ path: string; code: string; message: string; suggestion: string }>;
      targetErrors?: Array<{ path: string; code: string; message: string; suggestion: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);

    // 既有字段**逐字不变**：名字、条数、码、message/suggestion 形状
    expect(Object.keys(parsed)).toContain("pathErrors");
    expect(parsed.pathErrors?.length).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.pathErrors?.[0].suggestion).toContain(".js/.mjs/.ts");

    // 新增字段：同一批「分析目标闸门」错误的**精确**入口（不丢事实）
    expect(parsed.targetErrors?.length).toBe(1);
    expect(parsed.targetErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.targetErrors?.[0].message).toBe(parsed.pathErrors?.[0].message);
  });

  it("--from 路径错误：仍在 pathErrors[] 里，但**不**冒充分析目标闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("clean.js"), "--from", p("no-such-usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
      targetErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    // --from 路径错误照旧在 pathErrors[]（既有消费者零影响）
    expect(parsed.pathErrors?.length).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-missing-callsite");
    // 但它**不是**分析目标闸门错误 ⇒ 新字段不得把它收进去（语义精确，不是副本）
    expect(parsed.targetErrors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. watch 多轮 JSON：JSON Lines（每行一份完整 JSON 文档）
// ---------------------------------------------------------------------------

describe("族 63-3: watch --json ⇒ JSON Lines（多轮累积不再炸 JSON.parse）", () => {
  it("health --watch --json：两轮 ⇒ stdout 两行，每行各自 JSON.parse 得通", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-"));
    writeSrcTsconfig(watchDir);
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["health", watchDir, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        // 见到第 1 份文档 ⇒ 改文件触发第 2 轮；见到第 2 份文档 ⇒ 收尾
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            // 多一个函数 ⇒ 第 2 轮的报告可与第 1 轮区分开
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      // 两轮 ⇒ **两行**（旧行为：第 2 份文档是 pretty 多行 ⇒ 整份 JSON.parse 炸）
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      // 每行**各自**是一份完整 JSON 文档
      const docs = lines.map((l) => JSON.parse(l) as { files: Array<{ functions: number }> });
      expect(docs.length).toBe(2);
      expect(docs[0].files[0].functions).toBe(1);
      expect(docs[1].files[0].functions).toBe(2);
      // 整份 stdout 仍**不可** JSON.parse（多文档流）⇒ 消费者必须逐行读
      expect(() => JSON.parse(r.stdout)).toThrow();
      // watch 横幅继续走 stderr（stdout 保持纯机器面）
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });

  it("test --watch --json：同一套 JSON Lines 契约（两轮 ⇒ 两行）", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-test-"));
    writeSrcTsconfig(watchDir);
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["test", file, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });
  it("check --watch --json：同一套 JSON Lines 契约（两轮 ⇒ 两行）", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-check-"));
    writeSrcTsconfig(watchDir);
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["check", file, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 负控：非 watch 的单轮 stdout 逐字不变
// ---------------------------------------------------------------------------

describe("族 63 负控: 非 watch 的单轮 stdout 逐字不变", () => {
  it("--json 面：仍是**一份** pretty 文档（逐字等于改前基线）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", "clean.js"], { cwd: dir });
    expect(r.status).toBe(0);
    // 逐字比对（不是形状比对）
    expect(r.stdout).toBe(CLEAN_JSON_BEFORE);
    // 非 watch 面**不是** JSON Lines（仍是一份 pretty 文档）
    expect(r.stdout.trimEnd().split("\n").length).toBeGreaterThan(1);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("文本面：仍是改前那份报告（逐字等于改前基线）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "clean.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(CLEAN_TEXT_BEFORE);
  });
});
});

// ---------------------------------------------------------------------------
// health 的分析错误必须进判定面（不得假绿）
// ---------------------------------------------------------------------------
describe("health 的分析错误必须进判定面（不得假绿）", () => {
/**
 * `nudo health` 把**所有非 drift 的分析诊断**丢掉 → 坏掉的侧车在
 * health 面**绿灯**（假绿）。
 *
 * 口径（guides/health.md:18）：health 的门 = 「Analysis errors + call-site
 * solidification drift」。坏侧车（`nudo:contract-load`）是**分析错误** ⇒ 必须
 * 进 health 的判定面（failed / ok / exit 码），不得只在 `nudo check` 面报。
 */






let dir: string;
const p = (f: string) => join(dir, f);

const MAIN = `export function greet(name) {
  return "hi " + name;
}
`;

/** 坏侧车：语法错误 ⇒ 侧车加载失败（nudo:contract-load） */
const BROKEN_SIDECAR = `export const greet = fn({ name: string()
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-674-"));
  writeFileSync(p("main.js"), MAIN);
  writeFileSync(p("main.nudo.js"), BROKEN_SIDECAR);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health 的分析错误必须进判定面（不得假绿）", () => {
  it("文本面：坏侧车 ⇒ 报分析错误 + exit 1（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("main.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stdout).toContain("error");
    expect(r.stdout).toContain("nudo:contract-load");
  });

  it("--json 面：ok:false + errors≥1 + 文件级 error 给出原因", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("main.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ error?: string }>;
      summary: { errors: number };
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.summary.errors).toBeGreaterThanOrEqual(1);
    expect(parsed.files[0].error).toContain("nudo:contract-load");
  });

  it("跨动词同口径：nudo check 对同一路径同样报 nudo:contract-load", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", p("main.js")]);
    expect(r.stdout).toContain("nudo:contract-load");
  });
});
});

// ---------------------------------------------------------------------------
// witness drift 计数 = 实际变更条数
// ---------------------------------------------------------------------------
describe("witness drift 计数 = 实际变更条数", () => {
/**
 * `nudo health` 的 witness drift 计数报的是「新集合大小 + 旧集合大小」
 * 的和式，而不是**实际变更数** ⇒ 只改 1 条见证报「2 条变更」（且与同屏 Summary
 * 的「1 case drift」自相矛盾）。
 *
 * 口径：漂移计数 = 两侧见证的**实际变更条数**（同一条见证被改写只计 1 次）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

/** 已固化一条见证（调用点现场在 usage.js 第 2 行） */
const LIB = `/**
 * @nudo:case "call@L2" ("Hello World")
 */
export function slugify(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：同一调用点，但实参已改成 "Goodbye World" ⇒ 见证陈旧 */
const USAGE = `import { slugify } from "./lib.js";
console.log(slugify("Goodbye World"));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-682-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("usage.js"), USAGE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("witness drift 计数 = 实际变更条数", () => {
  it("文本面：只改 1 条见证 ⇒ 报「1 witness directive(s) changed」", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.stdout).toContain("1 witness directive(s) changed");
    expect(r.stdout).not.toContain("2 witness directive(s) changed");
    // 漂移确实存在（陈旧见证 ⇒ 仍须判红）
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("drift:");
  });

  it("--json 面：added + removed == 实际变更条数（== 1）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: { added: number; removed: number; changed?: number } }>;
      summary: { drift: number };
    };
    expect(parsed.ok).toBe(false);
    const drift = parsed.files[0].drift;
    expect(drift).toBeDefined();
    expect(drift!.added + drift!.removed).toBe(1);
    expect(drift!.changed).toBe(1); // 同一条见证被改写（不是 +1 new / -1 removed 两条）
    expect(parsed.summary.drift).toBe(1);
  });

  it("同屏 Summary 与明细自洽（Summary 的 case drift ≥ 1，明细条数 == 1）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.stdout).toMatch(/Summary: .*· 1 case drift/);
    const m = /(\d+) witness directive\(s\) changed/.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// --from 零调用记录 ⇒ 不得静默跳过漂移检测
// ---------------------------------------------------------------------------
describe("--from 零调用记录 ⇒ 不得静默跳过漂移检测", () => {
/**
 * `nudo health --from` 的使用点若**一条调用记录都没有**，整段 drift
 * 检测被跳过 ⇒ **假绿**（见证早已陈旧仍报 `Result: OK` / exit 0）。
 *
 * 口径：零调用记录 ⇒「**无法判定漂移**」，不是「无漂移」⇒ 必须显式报出并判红。
 */






let dir: string;
const p = (f: string) => join(dir, f);

/** 已固化一条见证（现场调用点） */
const LIB = `/**
 * @nudo:case "call@L2" ("Hello World")
 */
export function slugify(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：import 了被分析函数但**从不调用** ⇒ 零调用记录 */
const USAGE_NO_CALL = `import { slugify } from "./lib.js";
console.log(typeof slugify);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-683-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("usage-no-call.js"), USAGE_NO_CALL);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("-from 零调用记录 ⇒ 不得静默跳过漂移检测", () => {
  it("文本面：显式报「无法判定漂移」+ exit 1（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage-no-call.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("Cannot determine witness drift");
    expect(r.stderr).toContain("fix:");
  });

  it("--json 面：ok:false + pathErrors 给出原因（机器面不得读到「一切正常」）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage-no-call.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors?.[0].message).toContain("Cannot determine witness drift");
  });

  it("对照组：没有任何冻结见证时，零记录不判红（不得给合法用法发假红）", { timeout: 60_000 }, () => {
    const plain = join(dir, "plain.js");
    writeFileSync(plain, "export function id(x) {\n  return x;\n}\n");
    const r = runCliTsx(["health", "--json", plain, "--from", p("usage-no-call.js")]);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; pathErrors?: unknown[] };
    expect(parsed.pathErrors ?? []).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// watch 多路径且首个是文件 ⇒ 增量轮不再永不触发
// ---------------------------------------------------------------------------
describe("watch 多路径且首个是文件 ⇒ 增量轮不再永不触发", () => {
/**
 * `nudo check/test/health --watch` 在**多路径且首个路径是文件**时
 * watch **彻底失效**（增量轮永不触发）。
 *
 * 根因：监视根只取**第 0 个路径**（`isDir ? primary : dirname(primary)`）——
 * 「首个是文件、另有目录」时监视根是一个**文件**，`join(file, filename)` 又
 * 产出**不存在的目录形式路径** ⇒ dirty 集恒空 ⇒ 增量轮早退。
 *
 * 修法：监视根**按每个路径各自解析**（目录→该目录，文件→其所在目录），
 * 事件路径按所属监视根换算（见 cli-/ cli-同族用例）。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("watch 多路径且首个是文件 ⇒ 增量轮不再永不触发", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("首个路径是文件 + 另有目录路径：改目录里的文件会触发增量轮", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-684-"));
    dirs.push(base);
    const sub = join(base, "sub");
    mkdirSync(sub, { recursive: true });
    const fileA = join(base, "a.js");
    const fileB = join(sub, "b.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([fileA, sub], async (f) => {
      seen.push(f);
    }, "check");
    try {
      // 首轮：a.js + sub/b.js
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 改 sub/b.js ⇒ 必须有一轮增量，且分析的是 b.js
      writeFileSync(fileB, SRC(22), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([fileB]);
    } finally {
      close();
    }
  });

  it("首个路径是文件 + 另有目录路径：改首个文件自身也会触发增量轮", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-684b-"));
    dirs.push(base);
    const sub = join(base, "sub");
    mkdirSync(sub, { recursive: true });
    const fileA = join(base, "a.js");
    const fileB = join(sub, "b.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([fileA, sub], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(fileA, SRC(11), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([fileA]);
    } finally {
      close();
    }
  });
});
});

// ---------------------------------------------------------------------------
// watch 事件路径归属真实变更文件
// ---------------------------------------------------------------------------
describe("watch 事件路径归属真实变更文件", () => {
/**
 * `nudo check/test --watch` 在**同目录多文件**时把变更文件
 * **误记成首个路径** ⇒ 被改的文件**永不被重新分析**。
 *
 * 根因：非目录分支 `const fullPath = isDir ? join(watchTarget, filename) : primary;`
 * ⇒ `fullPath` **恒等于第 0 个路径**，与「哪个文件真的变了」无关。
 *
 * 修法：事件路径按**该事件所属的监视根**换算（`join(root, filename)`）。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("watch 事件路径归属真实变更文件", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("同目录多文件：改第二个文件 ⇒ 增量轮重跑的是它（改前：重跑首个文件）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-685-"));
    dirs.push(dir);
    const p1 = join(dir, "p1.js");
    const p2 = join(dir, "p2.js");
    writeFileSync(p1, SRC(1), "utf-8");
    writeFileSync(p2, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([p1, p2], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(p2, SRC(22), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([p2]);
      expect(seen).not.toContain(p1);
    } finally {
      close();
    }
  });

  it("同目录多文件：改第一个文件 ⇒ 增量轮重跑的是它（回归护栏）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-685b-"));
    dirs.push(dir);
    const p1 = join(dir, "p1.js");
    const p2 = join(dir, "p2.js");
    writeFileSync(p1, SRC(1), "utf-8");
    writeFileSync(p2, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([p1, p2], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      writeFileSync(p1, SRC(11), "utf-8");
      await waitUntil(() => seen.length >= 1);
      expect(seen).toEqual([p1]);
    } finally {
      close();
    }
  });
});
});

// ---------------------------------------------------------------------------
// watch 监视根覆盖全部路径目录
// ---------------------------------------------------------------------------
describe("watch 监视根覆盖全部路径目录", () => {
/**
 * `nudo check/test/health --watch` 在路径**跨多个目录**时，只监视
 * **第一个目录** ⇒ 其余目录下的文件**永不被重跑**。
 *
 * 根因：监视根只由**第 0 个路径**决定（`isDir ? primary : dirname(primary)`），
 * 路径集里其余目录**从未被 `fs.watch` 注册** ⇒ 那些目录里的文件是永久盲区
 * （而 `getFiles()` 却把**所有**路径下的文件都收进文件集 ⇒ 文件集跨目录、
 * 监视范围只有一个目录）。
 *
 * 修法：监视根**按每个路径各自解析**（目录→该目录，文件→其所在目录），
 * 每个根一个 watcher，关闭句柄一次关掉全部。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("watch 监视根覆盖全部路径目录", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("跨目录路径：改第二个目录里的文件会触发增量轮（改前：0 轮）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-686-"));
    dirs.push(base);
    const dirA = join(base, "a");
    const dirB = join(base, "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const fileA = join(dirA, "x.js");
    const fileB = join(dirB, "o.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([dirA, fileB], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 改**第二个目录**里的文件 ⇒ 必须触发增量轮
      // 断言用 toContain 而非 toEqual([fileB])：fs.watch 在 macOS 上会合并
      // / 重复投递**初始扫描**事件，高并发全量运行时残留事件可能落在
      // `seen.length = 0` 之后（实测 Received = [b/o.js, a/x.js]）。
      // 的核心语义是「该目录的变更被监视到」，不是「恰好只投递一个事件」；
      // 严格相等把宿主事件投递行为当成产品契约，会造成与产品无关的假红。
      writeFileSync(fileB, SRC(22), "utf-8");
      await waitUntil(() => seen.includes(fileB));
      expect(seen).toContain(fileB);
    } finally {
      close();
    }
  });

  it("跨目录路径：改第一个目录里的文件也照常触发（回归护栏）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = mkdtempSync(join(tmpdir(), "nudo-686b-"));
    dirs.push(base);
    const dirA = join(base, "a");
    const dirB = join(base, "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const fileA = join(dirA, "x.js");
    const fileB = join(dirB, "o.js");
    writeFileSync(fileA, SRC(1), "utf-8");
    writeFileSync(fileB, SRC(2), "utf-8");

    const seen: string[] = [];
    const close = startWatch([dirA, fileB], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 同上的回归护栏：只要求「改第一个目录的文件仍被监视到」，不假定
      // fs.watch 恰好投递一个事件（初始扫描的延迟事件会跨清空点落地）。
      writeFileSync(fileA, SRC(11), "utf-8");
      await waitUntil(() => seen.includes(fileA));
      expect(seen).toContain(fileA);
    } finally {
      close();
    }
  });
});
});

// ---------------------------------------------------------------------------
// health 文本面与 --json 面的 error 计数同源
// ---------------------------------------------------------------------------
describe("health 文本面与 --json 面的 error 计数同源", () => {
/**
 * `nudo health` 的**文本面与 --json 面给出两个 error 计数**。
 *
 * 旧实现：JSON 面 `summary.errors = errorCount + fromErrors.length`（把
 * --from 的**路径错误**也算进去），文本面 Summary 只用 `errorCount`
 * ⇒ 同一次运行：文本面「0 error(s)」+ JSON 面「errors: 1」。
 * 文本面末尾还打「Result: FAIL (path errors found)」——同一段输出里
 * 结论行说有路径错误、计数行说 0 个。
 *
 * 钉：同一轮的两个面必须报**同一个**数字，且路径错误必须被计入。
 */






let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-687-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health 文本面与 --json 面的 error 计数同源", () => {
  it("同一轮：文本面 Summary 的 error 数 == JSON summary.errors（路径错误计入）", { timeout: 30_000 }, () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function libFn(x) {\n  return x + 1;\n}\n");
    const missingFrom = join(dir, "nope.js");

    const text = runCliTsx(["health", file, "--from", missingFrom]);
    const json = runCliTsx(["health", file, "--json", "--from", missingFrom]);

    // --json 面必须是**一份**合法 JSON 文档
    const parsed = JSON.parse(json.stdout) as {
      ok: boolean;
      pathErrors?: unknown[];
      summary: { errors: number };
    };
    const m = /(\d+) error\(s\)/.exec(text.stdout);
    expect(m, `no error count in text face:\n${text.stdout}`).not.toBeNull();
    const textErrors = Number(m![1]);

    // 两个面同一个数字
    expect(textErrors).toBe(parsed.summary.errors);
    // 路径错误必须被计入（不是 0）
    expect(textErrors).toBeGreaterThan(0);
    expect(parsed.pathErrors?.length).toBe(1);
    // 结论同源：两个面都是红
    expect(parsed.ok).toBe(false);
    expect(text.stdout).toContain("Result: FAIL");
    expect(text.status).toBe(1);
    expect(json.status).toBe(1);
  });

  it("无路径错误时两个面同样一致（0 error）", { timeout: 30_000 }, () => {
    const file = join(dir, "clean.js");
    writeFileSync(file, "export function clean(x) {\n  return x;\n}\n");
    const text = runCliTsx(["health", file]);
    const json = runCliTsx(["health", file, "--json"]);
    const parsed = JSON.parse(json.stdout) as { ok: boolean; summary: { errors: number } };
    const m = /(\d+) error\(s\)/.exec(text.stdout);
    expect(m, text.stdout).not.toBeNull();
    expect(Number(m![1])).toBe(parsed.summary.errors);
    expect(parsed.summary.errors).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(text.status).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// health --from 多文件与 check/contract 同口径
// ---------------------------------------------------------------------------
describe("health --from 多文件与 check/contract 同口径", () => {
/**
 * `nudo health` 拒绝**多文件** `--from`（`check` / `contract` 接受）
 * ⇒ 错误文案**失实**（"received no paths"，但 paths 明明收到了）+ 建议的
 * 解法把**目标与使用点对调** ⇒ 照做后静默分析错文件、exit 0。
 *
 * 钉（与 check / contract 同口径）：
 * - `nudo health <target> --from a.js b.js`：**接受**多文件 --from，
 * 分析目标仍是 <target>（不得静默换成 b.js）；
 * - 没有任何位置路径时（`nudo health --from a.js b.js`）：仍是 usage error，
 * 且文案**如实**（此时 paths 确实为空——"received no paths" 属实），
 * 与 check / test / contract 同款。
 */






let dir: string;
let lib: string;
let a: string;
let b: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-688-"));
  lib = join(dir, "lib.js");
  a = join(dir, "a.js");
  b = join(dir, "b.js");
  // ESM 包（使用点 import 目标 ⇒ 需要 type:module，否则求值失败 ⇒ 无调用记录）
  writeFileSync(join(dir, "package.json"), '{\n  "name": "nudo-bug-688-fixture",\n  "type": "module"\n}\n');
  // 目标：已固化两条 call@ 见证（与使用点一致 ⇒ 无 witness drift ⇒ 干净的 OK）
  writeFileSync(
    lib,
    '/**\n * @nudo:case "call@a.js:L2" (1)\n * @nudo:case "call@b.js:L2" (2)\n */\nexport function libFn(x) {\n  return x + 1;\n}\n',
  );
  // 使用点：顶层调用（调用发生在函数体内 ⇒ 模块求值期没有调用记录）
  writeFileSync(a, 'import { libFn } from "./lib.js";\nexport const rA = libFn(1);\n');
  writeFileSync(b, 'import { libFn } from "./lib.js";\nexport const rB = libFn(2);\n');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health --from 多文件与 check/contract 同口径", () => {
  it("health <target> --from a.js b.js：接受多文件 --from，分析目标不变", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", lib, "--from", a, b]);
    expect(r.status).toBe(0);
    // 不得再报 variadic 吞噬错误（paths 明明收到了目标）
    expect(r.stderr).not.toContain("variadic");
    expect(r.stderr).not.toContain("received no paths");
    // 分析对象是 lib.js（目标），不是 b.js（使用点）
    expect(r.stdout).toContain(lib);
    expect(r.stdout).not.toContain(b);
    expect(r.stdout).toContain("Result: OK");
  });

  it("同一形态在 --json 面：files[] 只含目标文件", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", lib, "--json", "--from", a, b]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ file: string }>;
    };
    expect(r.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.files.length).toBe(1);
    expect(parsed.files[0]!.file).toContain("lib.js");
  });

  it("无位置路径时仍是 usage error，且文案如实（paths 确实为空）", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", "--from", a, b]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("`nudo health` received no paths");
    expect(r.stderr).toContain("fix:");
    // 不得静默扫 cwd
    expect(r.stdout).not.toContain("Result: OK");
  });

  it("单文件 --from 且无位置路径：仍是「requires explicit paths」定向错误", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", "--from", a]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from requires explicit paths");
    expect(r.stderr).not.toContain("consumed");
  });
});
});

// ---------------------------------------------------------------------------
// watch 扫描应用 nudo.analysis.include / exclude
// ---------------------------------------------------------------------------
describe("watch 扫描应用 nudo.analysis.include / exclude", () => {
/**
 * CLI `nudo check/test <dir> --watch` 的**扫描面不应用**
 * `nudo.analysis.include` / `exclude` ⇒ watch 门禁对**项目范围外**的文件仍然
 * 报错，且与 IDE 对同一文件口径相反（文档明写 watch 扫描「应用」）。
 *
 * 修法：watch 的文件集走**产品唯一的范围闸门** `shouldAnalyzeFile`
 * （LSP / vite-plugin 同一个入口 ⇒ 同口径），但**不应用 mode**
 * （docs/design/cli-semantics.md §7 的「入口 × include/exclude」表：
 * watch 扫描「应用」include/exclude、「不应用 mode」）。
 *
 * 分工（与 ）：CLI **非 watch** 的目标扫描**忽略** include/exclude
 * （「点名路径即意图」，文档明写）⇒ 本用例同时钉住这条边界。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("watch 扫描应用 nudo.analysis.include / exclude", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：fx/{package.json(include: src/**), src/in.js, other/out.js} */
  function makeFixture(): { fx: string; inFile: string; outFile: string } {
    const fx = mkdtempSync(join(tmpdir(), "nudo-689-"));
    dirs.push(fx);
    mkdirSync(join(fx, "src"), { recursive: true });
    mkdirSync(join(fx, "other"), { recursive: true });
    writeFileSync(
      join(fx, "package.json"),
      JSON.stringify({
        name: "scopefx",
        version: "1.0.0",
        private: true,
        type: "module",
        nudo: { analysis: { include: ["src/**"] } },
      }),
      "utf-8",
    );
    const inFile = join(fx, "src", "in.js");
    const outFile = join(fx, "other", "out.js");
    writeFileSync(inFile, SRC(1), "utf-8");
    writeFileSync(outFile, SRC(2), "utf-8");
    return { fx, inFile, outFile };
  }

  it("watch 扫描面不收 include 之外的文件（改前：收进来并报红）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const watchSet = collectNudoFiles(fx, { scope: "watch" });
    expect(watchSet).toContain(inFile);
    expect(watchSet).not.toContain(outFile);
  });

  it("watch 首轮只分析范围内的文件（产品面：与 IDE 同口径）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fx, inFile, outFile } = makeFixture();

    const seen: string[] = [];
    const close = startWatch([fx], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 1);
      expect(seen).toContain(inFile);
      expect(seen).not.toContain(outFile);
    } finally {
      close();
    }
  });

  it("边界：CLI 非 watch 的目录目标扫描仍忽略 include/exclude（点名路径即意图）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const targetSet = collectNudoFiles(fx);
    expect(targetSet).toContain(inFile);
    expect(targetSet).toContain(outFile);
  });
});
});

// ---------------------------------------------------------------------------
// watch --json 的 stdout 必须是纯 JSON
// ---------------------------------------------------------------------------
describe("watch --json 的 stdout 必须是纯 JSON", () => {
/**
 * `nudo test --watch --json` / `nudo health --watch --json` 的
 * **watch 横幅写进 stdout** ⇒ stdout = 横幅 + JSON + 横幅 ⇒
 * `JSON.parse(stdout)` 直接抛 SyntaxError（机器面契约破）。
 *
 * 修复：watch 横幅（人类进度）一律走 **stderr**；stdout 只剩 JSON。
 *
 * 钉法（必须真的 JSON.parse）：spawn 真实 CLI → 收 stdout → JSON.parse。
 *
 * ⚠️ 收口订正：本钉原先用 `node tsx/dist/cli.mjs <cli> … --watch` 起子进程 ——
 * tsx 的 CLI 会把 `--watch` 当成**自己/node 的旗标**吞掉 ⇒ 子进程的
 * `process.argv` 里没有 `--watch` ⇒ CLI **根本没进 watch 形态** ⇒ 钉在测
 * 非 watch 路径（假通过）。改用共享的 `runWatchCli`（`node --import tsx` +
 * 显式追加 `--watch`）⇒ 钉真的落在 watch 形态上。
 */






const ONE = `export function one(){ return 1; }\n`;

describe("watch --json 的 stdout 必须是纯 JSON", () => {
  it("nudo test --watch --json → JSON.parse(stdout) 不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-693-"));
    try {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runWatchCli(["test", file, "--json"], {
        cwd: dir,
        // 等 stdout 里出现**一份可解析的 JSON**（watch 面首轮跑完才有）；
        // 谓词只看 stdout —— stderr 的横幅不该参与 JSON 判定
        waitFor: (out) => {
          try {
            JSON.parse(out);
            return true;
          } catch {
            return false;
          }
        },
      });
      const stdout = r.stdout;
      const stderr = r.stderr;

      // 核心断言：stdout 真的能被 JSON.parse（旧行为：横幅在前 ⇒ 抛）
      expect(() => JSON.parse(stdout)).not.toThrow();
      const parsed = JSON.parse(stdout) as { version?: number; functions?: unknown[] };
      expect(parsed.version).toBe(1);
      // 横幅不再进 stdout
      expect(stdout).not.toContain("Watching for changes");
      expect(stdout).not.toContain("nudo test...");
      // 横幅走 stderr（人类面不丢）
      expect(stderr).toContain("nudo test...");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// env 模板变更 ⇒ 依赖它的源文件复分析
// ---------------------------------------------------------------------------
describe("env 模板变更 ⇒ 依赖它的源文件复分析", () => {
/**
 * CLI watch 的 **env 模板失效分支是死代码** ⇒ 目录 watch 下改了
 * env 模板，依赖它的源文件**永不复分析**（IDE/watch 面板里类型一直是旧值）。
 *
 * 根因：`runIncremental` 的路径判定顺序 —— env 模板扩展名
 * （`.env.js` / `.env.mjs` / `.env.ts` / `mock-*.js` / `*.mock.js`）同时命中
 * `isNudoTargetPath` ⇒ `isNudoTargetPath` 分支先 `continue` ⇒ 下面的
 * env 反向边分支永远走不到。（`.env.mts` / `.env.cjs` 不命中
 * `isNudoTargetPath` ⇒ 旧顺序下反而正常。）
 *
 * 修复：env 模板判定**排在 `isNudoTargetPath` 之前**。
 */







const waitUntil = async (pred: () => boolean, ms = 20000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const ENV_SRC = `export function defineEnv(){ return { globals: { MAGIC: 1 } }; }\n`;
const MAIN_SRC = `/// @nudo:env ./globals.env.ts\nexport function useGlobal(){ return MAGIC; }\n`;

afterEach(() => {
  vi.restoreAllMocks();
  clearEnvPathDeps();
});

describe("env 模板变更 ⇒ 依赖它的源文件复分析", () => {
  it("改了 globals.env.ts → main.js 在增量轮被重新分析", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "clear").mockImplementation(() => {});

    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-697-"));
    const envFile = join(dir, "globals.env.ts");
    const mainFile = join(dir, "main.js");
    try {
      writeFileSync(envFile, ENV_SRC, "utf-8");
      writeFileSync(mainFile, MAIN_SRC, "utf-8");
      // 反向边登记（分析器侧行为，与被测的 watch 路由无关）
      noteEnvPathDeps(mainFile, MAIN_SRC);

      const analyzed: string[] = [];
      const close = startWatch(
        [dir],
        async (f) => {
          analyzed.push(f);
        },
        "test",
      );
      try {
        await waitUntil(() => analyzed.length >= 2);
        const mainRunsBefore = analyzed.filter((f) => f.endsWith("main.js")).length;
        expect(mainRunsBefore).toBeGreaterThanOrEqual(1);

        // 改 env 模板 ⇒ 依赖它的 main.js 必须复分析（旧行为：永不复分析）
        writeFileSync(
          envFile,
          `export function defineEnv(){ return { globals: { MAGIC: 2 } }; }\n`,
          "utf-8",
        );
        await waitUntil(
          () => analyzed.filter((f) => f.endsWith("main.js")).length > mainRunsBefore,
        );
        expect(analyzed.filter((f) => f.endsWith("main.js")).length).toBeGreaterThan(
          mainRunsBefore,
        );
      } finally {
        close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// health --json 序列化 budget 截断快照
// ---------------------------------------------------------------------------
describe("health --json 序列化 budget 截断快照", () => {
/**
 * `nudo health --json` 的机器面**整条丢掉 budget 截断快照**。
 *
 * `HealthReport` 类型声明了 `budget?: AbsBudgetStats`（注释明写与
 * `nudo check --json` 的 budget **同源同义**），分析后也填了、文本分支
 * 也打了「⚠ budget truncated」——但 JSON 分支是**逐字段手写列举**的，
 * `budget` 不在清单里 ⇒ 机器消费者读到 `ok: true` 的「干净」健康报告，
 * 而实际结果已被**宽化**（同一轮两个面结论相反）。
 *
 * 钉：两个面同时断言——文本面报截断 + JSON 面**有**对应字段
 * （files[].budget 同源同义 + summary.budgetTruncated 聚合）。
 */






let dir: string;

/** 深自递归：实参逐层变形 ⇒ eval depth 截断（64/64） */
const DEEP = `export function down(n) {
  if (n <= 0) {
    return 0;
  }
  return down(n - 1);
}
`;

/** 普通导出函数：不触发任何预算 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-925-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health --json 序列化 budget 截断快照", () => {
  it("截断文件：JSON 面带 budget.truncated=true + summary.budgetTruncated；文本面报截断", { timeout: 30_000 }, () => {
    const deep = join(dir, "deep.js");
    writeFileSync(deep, DEEP);

    const json = runCliTsx(["health", deep, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      ok: boolean;
      files: Array<{ file: string; budget?: { truncated: boolean; reasons: string[] } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget, `no budget in JSON face:\n${json.stdout}`).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(true);
    expect(parsed.summary.budgetTruncated).toBe(true);

    // 文本面：同一轮明确报「budget truncated」（两个面同源）
    const text = runCliTsx(["health", deep]);
    expect(text.stdout).toContain("budget truncated");

    // 与 `nudo check --json` 的同一份 core budget 快照同源同义
    const check = runCliTsx(["check", deep, "--json"]);
    const cj = JSON.parse(check.stdout) as { budget?: { truncated: boolean } };
    expect(cj.budget!.truncated).toBe(parsed.files[0]!.budget!.truncated);
  });

  it("未截断文件：budget 也在（truncated=false），summary 不报 budgetTruncated", { timeout: 30_000 }, () => {
    const plain = join(dir, "plain.js");
    writeFileSync(plain, PLAIN);
    const json = runCliTsx(["health", plain, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      files: Array<{ budget?: { truncated: boolean } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(false);
    expect(parsed.summary.budgetTruncated).toBeUndefined();
    const text = runCliTsx(["health", plain]);
    expect(text.stdout).not.toContain("budget truncated");
  });
});
});

// ---------------------------------------------------------------------------
// health --watch 的路径错误通道可达
// ---------------------------------------------------------------------------
describe("health --watch 的路径错误通道可达", () => {
/**
 * `nudo health --watch <不存在的路径>`：**路径错误被 watch 的文件
 * 收集整个吞掉** ⇒ exit 0 / 零报告 / 静默空会话 ⇒ 假绿；而 `nudo health`
 * （无 watch）对**同一路径** exit 1。
 *
 * 根因：「File not found」报告的唯一生产者是 runHealth，而 watch 路径下
 * runHealth 只能作为 startWatch 的 per-file runner 被调用；路径不存在 ⇒
 * 收集为空 ⇒ runner 一次都不跑 ⇒ 报告永不产生、退出码永不置红。
 *
 * 钉：watch 面必须与无 watch 面**同款**——路径错误上屏 + 红 + 进程自己
 * 退出（不装 watch ⇒ 不常驻）。
 */







let dir: string;
let missing: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-927-"));
  missing = join(dir, "nope.js");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health --watch 的路径错误通道可达", () => {
  it("health --watch <不存在路径>：路径错误上屏 + exit 1 + 进程自己退出（不装 watch）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    expect(r.stdout, `stderr=${r.stderr}`).toContain("File not found");
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.stdout).toContain("1 error(s)");
    // 不得装 watch（否则是常驻的静默绿会话）
    expect(r.stdout).not.toContain("Watching for changes");
    expect(r.exited, "watch 面仍在常驻（路径错误被吞）").toBe(true);
    expect(r.status).toBe(1);
  });

  it("与无 watch 面同款：同一路径的结论一致（红 + 同一句错误说明）", { timeout: 40_000 }, async () => {
    const watch = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    const plain = runCliTsx(["health", missing]);
    expect(plain.status).toBe(1);
    expect(plain.stdout).toContain("File not found");
    expect(watch.stdout).toContain(plain.stdout.split("\n")[0]!.trim());
  });
});
});

// ---------------------------------------------------------------------------
// watch 每轮重采 --from 调用点证据
// ---------------------------------------------------------------------------
describe("watch 每轮重采 --from 调用点证据", () => {
/**
 * `check --watch --from` 的调用点证据是**启动快照** ⇒ 每轮从不刷新
 * ⇒ 同一轮里两个文件对同一次调用给出相反裁决，且与同一磁盘状态下的**全新**
 * 非 watch 运行结论相反。
 *
 * 修复：watch 每轮重采 `--from` 调用点证据（startCheckWatch 的 onRoundStart），
 * 证据缺失（读不到 / 解析失败）进入本轮门禁（红）。
 *
 * 测试直接驱动 startCheckWatch（拿到 startWatch 的关闭句柄 ⇒ 确定性清理）。
 */






const waitUntil = async (pred: () => boolean, ms = 30000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const LIB_SRC = `export function add(a, b) {
  return a + b;
}
`;
const LIB_CONTRACT = `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number().gt(0), b: number() }, number());
`;
/** 越界的调用点实参（-1 不满足 a > 0）⇒ L1 domain-exceeds */
const USAGE_BAD = `import { add } from "./lib.js";

export const r = add(-1, 2);
`;
/** 合法的调用点实参 ⇒ 无 domain-exceeds */
const USAGE_OK = `import { add } from "./lib.js";

export const r = add(1, 2);
`;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("watch 每轮重采 --from 调用点证据", () => {
  it("调用点改了之后，重新分析依赖方时用的是**当前**证据（不是启动快照）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-928-watch-"));
    const lib = join(dir, "lib.js");
    const usage = join(dir, "usage.js");
    writeFileSync(lib, LIB_SRC, "utf-8");
    writeFileSync(join(dir, "lib.nudo.js"), LIB_CONTRACT, "utf-8");
    writeFileSync(usage, USAGE_BAD, "utf-8");

    const logs: string[] = [];
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const close = startCheckWatch([lib], {
      from: [usage],
      humanMode: true,
      shared: {},
    });

    try {
      // 首轮：启动快照里的 -1 ⇒ L1 domain-exceeds
      await waitUntil(() => logs.join("\n").includes("nudo:contract-domain-exceeds"));
      expect(logs.join("\n")).toContain("-1 exceeds");

      // 调用点改成合法实参（证据变了）
      writeFileSync(usage, USAGE_OK, "utf-8");
      // 等这一轮（usage.js 不是被跟踪目标 ⇒ 增量轮无脏文件，直接返回）
      await new Promise((r) => setTimeout(r, 600));
      const before = logs.length;

      // 触碰依赖方 ⇒ 触发增量轮，重新分析 lib.js
      writeFileSync(lib, LIB_SRC, "utf-8");
      await waitUntil(() => logs.length > before);
      await waitUntil(() => {
        const tail = logs.slice(before).join("\n");
        return tail.includes("nudo check") && !tail.includes("exceeds");
      });

      const tail = logs.slice(before).join("\n");
      // 新证据（1 ≤ a）⇒ 不再有 domain-exceeds（启动快照会一直报 -1）
      expect(tail).not.toContain("nudo:contract-domain-exceeds");
      expect(tail).not.toContain("-1 exceeds");
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// health --watch 一轮只产出一份报告
// ---------------------------------------------------------------------------
describe("health --watch 一轮只产出一份报告", () => {
/**
 * `nudo health --watch <含 N 个文件的目录>`：**watch runner 把自己的
 * per-file 目标整个丢掉** ⇒ 每次都重跑整个路径集 ⇒ 首轮把完整报告打印
 * **N** 遍、`--json` 面 stdout 出 **N** 份完整 JSON 文档（JSON.parse 抛错）、
 * 分析工作量放大 N 倍。
 *
 * 钉：首轮**只**产生一份完整报告（Summary 行数 = 1，不是 N）；--json 面
 * stdout 里**只有一份** JSON 文档（可被 JSON.parse 解析）。
 */






let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-929-"));
  writeFileSync(join(dir, "a.js"), "export function a(x) {\n  return x;\n}\n");
  writeFileSync(join(dir, "b.js"), "export function b(x) {\n  return x * 2;\n}\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health --watch 一轮只产出一份报告", () => {
  it("人类面：首轮完整报告只打印 1 份（Summary 行数 = 1，不是文件数）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir], { timeoutMs: 25_000 });
    const summaries = r.stdout.match(/^Summary:/gm) ?? [];
    expect(summaries.length, `stdout:\n${r.stdout}`).toBe(1);
    // 报告仍然覆盖整个目录（2 个文件都在报告里）
    expect(r.stdout).toContain("2 file(s)");
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("b.js");
  });

  it("--json 面：stdout 只有一份 JSON 文档（JSON.parse 直接成功）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir, "--json"], { timeoutMs: 25_000 });
    const docs = extractJsonDocs(r.stdout);
    expect(docs.length, `stdout:\n${r.stdout}`).toBe(1);
    const parsed = JSON.parse(docs[0]!) as {
      ok: boolean;
      files: Array<{ file: string }>;
      summary: { files: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.files.length).toBe(2);
    expect(parsed.summary.files).toBe(2);
  });
});
});

// ---------------------------------------------------------------------------
// health 必须与分析目标闸门同口径
// ---------------------------------------------------------------------------
describe("health 必须与分析目标闸门同口径", () => {
/**
 * `nudo health` **不设「分析目标」闸门** ⇒ 把 `.d.ts` / 侧车 / `.jsx`
 * 当成**已检查的源文件**并报「Result: OK」（exit 0），而 `nudo check` /
 * `nudo test` 对**同一路径** exit 1「Not an analysis target」⇒ 假绿 + 跨动词
 * 自相矛盾。
 *
 * 口径：health 的目标解析与 check / test **同口径**（`isNudoTargetPath` 闸门 +
 * 同款 pathNotTarget 错误：同样的 message / suggestion）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-947-"));
  writeFileSync(p("types.d.ts"), "export declare function g(x: number): number;\n");
  writeFileSync(p("sidecar.nudo.js"), "export const g = fn({ x: number() }, number());\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("health 必须与分析目标闸门同口径", () => {
  it("文本面：.d.ts 目标 ⇒ exit 1 + Not an analysis target（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("types.d.ts")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("Not an analysis target");
    expect(r.stderr).toContain("fix:");
  });

  it("侧车（*.nudo.js）同样不是分析目标 ⇒ 判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("sidecar.nudo.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not an analysis target");
  });

  it("--json 面：ok:false + pathErrors[0].code == nudo:path-not-target", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("types.d.ts")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string; suggestion: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.files).toEqual([]);
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.pathErrors?.[0].suggestion).toContain(".js/.mjs/.ts");
  });

  it("跨动词同口径：check / test 对同一路径报同一款错误", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", p("types.d.ts")]);
    const health = runCliTsx(["health", p("types.d.ts")]);
    expect(check.status).toBe(1);
    expect(health.status).toBe(check.status);
    expect(health.stderr).toContain("Not an analysis target");
    expect(check.stderr).toContain("Not an analysis target");
  });
});
});

// ---------------------------------------------------------------------------
// 空目标集不得报「一切正常」
// ---------------------------------------------------------------------------
describe("空目标集不得报「一切正常」", () => {
/**
 * `nudo health --json` 在**空目标集**时给出 `"ok": true` + `"files": []`
 * + exit 0 ⇒ 机器消费者读到「一切正常」，而实际上**一个文件都没检查**（文本面
 * 仅一行「No files to check.」）。
 *
 * 口径：空目标集 = 「一个文件都没检查」⇒ 与 `nudo check` 同口径判红
 * （pathEmptyDir 错误 + ok:false + 非零 exit）。
 */






let dir: string;
let emptyDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-948-"));
  emptyDir = join(dir, "emptydir");
  mkdirSync(emptyDir);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("空目标集不得报「一切正常」", () => {
  it("--json 面：ok:false + files:[] + 非零 exit", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", emptyDir]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.files).toEqual([]);
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-empty-dir");
  });

  it("文本面：不得只给一行「No files to check.」——必须说清没检查任何文件并判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", emptyDir]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("No nudo files found in directory");
  });

  it("跨动词同口径：nudo check 对同一空目录也判红", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", emptyDir]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("No nudo files found in directory");
  });
});
});

// ---------------------------------------------------------------------------
// uncovered 指标不得恒为 0
// ---------------------------------------------------------------------------
describe("uncovered 指标不得恒为 0", () => {
/**
 * `nudo health` 的 `uncovered` 指标**在结构上恒为 0**（过滤式恰好
 * 排除了文档定义的「entry fallback」那一类）⇒ 文档承诺的「uncovered ⇒
 * **Reported**, informational only」**永不成立**；机器面读出的 `"uncovered": 0`
 * 恒为假 ⇒ 消费者据此判断「全部函数都有覆盖」。
 *
 * 口径（guides/health.md:22）：uncovered = 「**无调用点证据**（回落 entry@）」的
 * 函数 ⇒ 必须被**报出来**（informational only：不判红，但必须可见）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

/** 形态 1：导出函数、无调用点现场 ⇒ entry fallback ⇒ uncovered */
const NO_EVIDENCE = `export function a(x) {
  return x + 1;
}
`;

/** 形态 2：同文件内有调用点现场 ⇒ 该函数**有**调用点证据 ⇒ 不算 uncovered */
const WITH_EVIDENCE = `export function c(x) {
  return x + 1;
}
export function d() {
  return c(1);
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-949-"));
  writeFileSync(p("no-evidence.js"), NO_EVIDENCE);
  writeFileSync(p("with-evidence.js"), WITH_EVIDENCE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("uncovered 指标不得恒为 0", () => {
  it("--json 面：无调用点证据的函数进 uncovered + summary.uncovered ≥ 1", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("no-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ uncovered: string[]; entryOnly: number }>;
      summary: { uncovered: number };
    };
    expect(parsed.files[0].uncovered).toContain("a");
    expect(parsed.summary.uncovered).toBeGreaterThanOrEqual(1);
    // informational only ⇒ 不判红
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });

  it("文本面：uncovered 必须被报出来（informational only）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("no-evidence.js")]);
    // 必须是「逐个函数点名」的 uncovered 行（Summary 里的计数不算——它恒为 0）
    expect(r.stdout).toContain("uncovered (no call-site evidence): a");
    expect(r.stdout).toContain("Result: OK");
  });

  it("有调用点证据的函数不算 uncovered（指标不是恒真）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("with-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      files: Array<{ uncovered: string[] }>;
    };
    expect(parsed.files[0].uncovered).not.toContain("c");
  });
});
});

// ---------------------------------------------------------------------------
// watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）
// ---------------------------------------------------------------------------
describe("watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）", () => {
/**
 * `nudo check --json --watch <不存在的路径>` /
 * `nudo test --json --watch <不存在的路径>` 的**路径错误早退分支**仍打
 * **pretty 多行** JSON 文档 ⇒ 破坏 watch 面「stdout = JSON Lines（每行一份
 * 完整 JSON 文档，各自可 `JSON.parse`）」的契约。
 *
 * 症状：这两条早退分支位于 **watch 安装之前** ⇒ 命中后直接
 * `console.log(JSON.stringify(..., null, 2))` 落一份缩进多行文档并 return。
 * 逐行 `JSON.parse` 的机器消费者在**第一行**即抛 SyntaxError；且同一 flag
 * 组合的 stdout 形态**随路径是否可解析而变**（合法路径是 1 行 JSON Lines）。
 * 实测：check 29 行 / test 33 行，而同参数的 `health --json --watch` 只有 1 行。
 *
 * 修复：两条早退分支改用 `emitJsonDoc(doc, true)`（watch 面 = JSON Lines）
 * ⇒ 与 health / 每轮文档的口径一致。
 *
 * 负控：**非 watch 面**的单轮 stdout 仍是一份 pretty 文档（既有金标钉的形态）
 * ⇒ 本修复不得改动它。
 */







type Doc = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};

describe("watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）", () => {
  const verbs = ["check", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json --watch <不存在的路径> ⇒ stdout 是**一行**合法 JSON`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-"));
      try {
        const missing = join(dir, "no-such-file.js");
        const r = await runWatchCli([verb, missing, "--json"], {
          cwd: dir,
          timeoutMs: 20_000,
          // 早退分支不装 watch ⇒ 进程自己退出（等退出，不等横幅）
          waitFor: "exit",
        });
        expect(r.exited, `stderr:\n${r.stderr}`).toBe(true);
        expect(r.status).toBe(1);

        const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
        // 旧行为：pretty 多行文档（check 29 行 / test 33 行）
        expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
        // 每行各自是一份完整 JSON 文档（逐行可 parse）
        const doc = JSON.parse(lines[0]!) as Doc;
        // check 面的信封带 `ok:false`；test 面的 CaseJson 信封不带 `ok`（既有形状）
        if (doc.ok !== undefined) expect(doc.ok).toBe(false);
        expect(doc.pathErrors?.length ?? 0).toBeGreaterThan(0);
        expect(doc.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
        // stdout 保持纯机器面（横幅走 stderr）
        expect(r.stdout).not.toContain("Watching for changes");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it("口径对齐：health --json --watch <不存在的路径> 同样是一行（既有行为不回归）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-health-"));
    try {
      const missing = join(dir, "no-such-file.js");
      const r = await runWatchCli(["health", missing, "--json"], {
        cwd: dir,
        timeoutMs: 20_000,
        waitFor: "exit",
      });
      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
      expect(() => JSON.parse(lines[0]!)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("负控：非 watch 面（--json 无 --watch）仍是一份 pretty 文档（逐字不改）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-plain-"));
    try {
      const missing = join(dir, "no-such-file.js");
      for (const verb of ["check", "test"] as const) {
        const r = runCliTsx([verb, missing, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // 非 watch 面 = 一份 pretty 文档（多行）
        expect(r.stdout.trimEnd().split("\n").length, `stdout:\n${r.stdout}`).toBeGreaterThan(1);
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// CLI：check 与 health 的 entry-only 口径一致
// ---------------------------------------------------------------------------
describe("CLI：check 与 health 的 entry-only 口径一致", () => {
/**
 * 回归（CLI 面）：`nudo:contract-entry-only` 在 **check** 面不可达
 * （分析器产出 info，但普通 check 路径不跑分析器 ⇒ 诊断被丢弃），而
 * `nudo health` 走另一条统计路径仍报「N entry-only」⇒ 同一事实两 verb
 * 口径分裂。
 *
 * 修法：普通 check 路径也跑分析器（白名单仍只有 contract 家族）⇒ 两个
 * verb 同一口径。**顺序要求**：分析器必须**先于** checkSource 跑（core 的
 * 侧车加载失败去重表按作用域共享；反序会让分析器误报「无契约根」）。
 *
 * 本文件锁：
 * ① 无契约根 + 无调用点域 ⇒ check 报 entry-only info，条数 == health 的
 * entry-only 计数（**本次修复的正面**）；
 * ② 同文件被调用的导出不算 entry-only（调用点域口径一致）；
 * ③ 有契约根（有侧车）的导出：check 不报「无契约根」info——但 health 的
 * entry-only 计数仍为 1（**两个口径本就不同的两个事实**，见下）。
 *
 * 关于 ③：health 的「entry-only」计数是**覆盖率**事实（该函数回落到了
 * entry@ 见证 = 没有调用点证据）；check 的 `nudo:contract-entry-only` 诊断是
 * **契约缺口**事实（没有契约根 **且** 没有调用点域，docs:
 * reference/diagnostics.md#nudo-contract-entry-only）。有契约根但无调用点
 * 时两者本就该不同（函数有契约，只是没被调用过）⇒ 不是 bug。真要对齐成
 * 同一个统计口径，需要改 service 的 `fn.entryOnly` 语义（越界，见报告）。
 */






/** 无契约根、无调用点域的导出 ⇒ entry-only */
const SOLO = `export function solo() {
  return 1;
}
`;

/** solo 被 same-file 的 other 调用 ⇒ 有调用点域 ⇒ 不是 entry-only */
const CALLED = `export function solo() {
  return 1;
}
export function other() {
  return solo();
}
`;

/** 有侧车契约根 ⇒ check 不报「无契约根」（health 的覆盖率计数仍为 1） */
const WITH_SIDECAR = `export function solo(x) {
  return x;
}
`;
const SIDECAR = `import { fn, number } from "@nudojs/core";

export const solo = fn({ x: number() }, number());
`;

function fixture(src: string, sidecar?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-461-cli-"));
  writeFileSync(join(dir, "probe.js"), src, "utf-8");
  if (sidecar !== undefined) writeFileSync(join(dir, "probe.nudo.js"), sidecar, "utf-8");
  return dir;
}

function checkEntryOnlyNames(dir: string): string[] {
  const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
  const json = JSON.parse(r.stdout) as {
    issues: { code: string; message: string }[];
  };
  return json.issues
    .filter((i) => i.code === "nudo:contract-entry-only")
    .map((i) => {
      const m = /export '([^']+)'/.exec(i.message);
      return m?.[1] ?? "?";
    });
}

function healthEntryOnly(dir: string): number {
  const r = runCli(["health", "probe.js"], { cwd: dir });
  const m = /(\d+) entry-only/.exec(r.stdout);
  return m ? Number(m[1]) : 0;
}

describe("CLI：check 与 health 的 entry-only 口径一致", () => {
  it("无契约根的导出：check 报 entry-only info，条数 == health 的计数", () => {
    const dir = fixture(SOLO);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["solo"]);
      expect(healthEntryOnly(dir)).toBe(1);
      expect(names.length).toBe(healthEntryOnly(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同文件被调用的导出不算 entry-only（两 verb 同口径）", () => {
    const dir = fixture(CALLED);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["other"]); // solo 有调用点域
      expect(healthEntryOnly(dir)).toBe(names.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有侧车契约根 ⇒ check 不报「无契约根」（契约缺口事实不成立）", () => {
    const dir = fixture(WITH_SIDECAR, SIDECAR);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual([]);
      // health 的 entry-only 计数是**覆盖率**事实（回落 entry@ 见证）——
      // 有契约但没被调用过时它仍是 1：两个口径本就不同的两个事实。
      expect(healthEntryOnly(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entry-only 是 info：不红门禁（exit 0）", () => {
    const dir = fixture(SOLO);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:contract-entry-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// --watch 不再被 --json 静默丢弃
// ---------------------------------------------------------------------------
describe("--watch 不再被 --json 静默丢弃", () => {
/**
 * `nudo check --watch --json` ⇒ **watch 从未启动**（--json 早退把它吞了）。
 *
 * 症状：--json 分支在 watch 安装之前就 return ⇒ 进程跑完 JSON 即退出，
 * 「Watching for changes...」永不出现、文件监听从未启动（用户以为在盯盘）。
 * 修复：两者**共存**——watch 每轮仍吐机器可读文档（每文件一份）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-645-"));
  const file = join(dir, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("-watch 不再被 --json 静默丢弃", () => {
  it("CLI：--watch --json ⇒ 监听真的启动（横幅出现 + 进程常驻 + stdout 仍是 CheckJson）", async () => {
    const { cwd, file } = makeProject();
    try {
      const r = await runWatchCli(["check", file, "--json"], {
        cwd,
        timeoutMs: 20_000,
        // 收尾条件 = 横幅出现 **且** stdout 里已有可解析的 JSON 文档
        // （两路管道到达顺序不定 ⇒ 只等横幅会偶发「文档还没到」的假失败）
        waitFor: (stdout, stderr) =>
          (stdout + stderr).includes("Watching for changes...") &&
          extractJsonDocs(stdout).length > 0,
      });
      // 旧症状：进程跑完 JSON 就退出 ⇒ 从来没有「Watching for changes...」
      expect(r.stdout + r.stderr).toContain("Watching for changes...");
      // watch 是常驻面 ⇒ 收尾标记出现时进程仍活着（status=null = 被测试杀掉）
      expect(r.status).toBeNull();
      // 机器面：stdout 仍是可解析的 CheckJson（单文件契约：裸 CheckJson）
      const docs = extractJsonDocs(r.stdout);
      expect(docs.length).toBeGreaterThan(0);
      const doc = JSON.parse(docs[0]!);
      expect(doc.version).toBe(1);
      expect(doc.kind).not.toBe("multi");
      expect(doc.ok).toBe(true);
      expect(doc.signatures[0].name).toBe("one");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 40_000);
});
});

// ---------------------------------------------------------------------------
// watch 面单文件分析失败必须置红（不得吞掉异常保持绿）
// ---------------------------------------------------------------------------
describe("watch 面单文件分析失败必须置红（不得吞掉异常保持绿）", () => {
/**
 * `nudo test --watch` 把**单文件分析失败整个吞掉** ⇒ 门禁**保持绿（exit 0）**；
 * 而**同一目录**的 `nudo check --watch` / `nudo health --watch` / 非 watch 的
 * `nudo test` **全部 exit 1** ⇒ **watch 面上唯一的假绿**（共享 watch 循环吞掉
 * `runOne` 抛出的异常，从不置红）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts` 的**共享** watch 循环
 * `startWatch`）：每文件的 catch **必须置红**（`process.exitCode = 1`）——
 * **全量轮与增量轮两处**都改；与同文件自陈的「退出码语义 = 最近一轮的门禁状态」
 * 一致。
 *
 * ⚠ **不中断整轮**：一个坏文件不该中止整轮（这是现在的行为，也是对的；
 * 错的只是「不置红」）——本文件同时锁住「坏文件不中止整轮」与
 * 「下一轮绿则退出码复位 0（不得引入粘滞红）」。
 *
 * 本钉直接驱动**共享** watch 循环（check / test / health 三个面走同一个
 * `startWatch`）——`runOne` 以 runCheck/runTest 同语义模拟：门禁红置 1、绿不置；
 * 分析失败（解析/装配失败）⇒ **抛异常**（旧实现只打一行 stderr 就吞掉）。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** 坏文件：分析失败（模拟解析失败抛错） */
const BAD_SRC = `export function boom() {
  throw new TypeError("x");
}
`;
/** 好文件：分析通过 */
const GOOD_SRC = `export function id(x) {
  return x;
}
`;

/** 轮末横幅（startWatch 的 watchBanner ⇒ console.error） */
const ROUND_END = "Watching for changes...";

/** 装 console：抓横幅（轮末屏障）+ 静音 clear/log */
function installConsole(): { lines: string[]; rounds: () => number } {
  const lines: string[] = [];
  vi.spyOn(console, "clear").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  return { lines, rounds: () => lines.filter((l) => l.includes(ROUND_END)).length };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("watch 面单文件分析失败必须置红（不得吞掉异常保持绿）", () => {
  it("全量轮：坏文件分析失败 ⇒ exit 1（改前：吞掉异常 ⇒ exit 0 假绿）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const bad = join(dir, "bad.js");
    writeFileSync(bad, BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        // 分析失败 ⇒ 抛（改前：watch 循环 catch 后只打 stderr ⇒ 保持绿）
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("bad.js"))).toBe(true);
      // 门禁必须红
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("全量轮：坏文件**不中止整轮**（后续文件仍被分析）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    writeFileSync(join(dir, "bad.js"), BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("good.js"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("增量轮：坏文件分析失败 ⇒ exit 1；改好后下一轮绿 ⇒ 复位 0（不粘滞红）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const file = join(dir, "w.js");
    writeFileSync(file, GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    let attempts = 0;
    const close = startWatch(
      [file],
      async (f) => {
        attempts++;
        if (readFileSync(f, "utf-8").includes("boom")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      // 首轮（绿）：退出码 0
      await waitUntil(() => rounds() >= 1);
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(process.exitCode).toBe(0);

      // 改坏 ⇒ 增量轮必须置红
      writeFileSync(file, BAD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 2);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(process.exitCode).toBe(1);

      // 改好 ⇒ 下一轮绿 ⇒ 复位 0（本次修复不得引入「粘滞红」）
      writeFileSync(file, GOOD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 3);
      expect(process.exitCode).toBe(0);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });
});
});
