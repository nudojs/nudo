/**
 * 模块套件：cli-health-drift-and-watch（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { runWatchCli } from "./helpers/run-watch-cli.ts";
import { startWatch } from "../commands/shared.ts";


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


// ---------------------------------------------------------------------------
// 族 63-1: health Summary 的漂移数与明细行同量纲（见证条数）
// ---------------------------------------------------------------------------
describe("1: health Summary 的漂移数与明细行同量纲（见证条数）", () => {
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


// ---------------------------------------------------------------------------
// 2. pathErrors[] 命名漂移：字段逐字保留 + 新增语义可见的 targetErrors[]
// ---------------------------------------------------------------------------

describe("2: pathErrors[] 逐字保留 + targetErrors[] 让语义可见", () => {
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

describe("3: watch --json ⇒ JSON Lines（多轮累积不再炸 JSON.parse）", () => {
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

describe("负控: 非 watch 的单轮 stdout 逐字不变", () => {
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

{
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
}
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

{
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
}
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

{
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
}
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
