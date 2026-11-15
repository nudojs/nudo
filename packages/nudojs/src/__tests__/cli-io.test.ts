/**
 * 模块套件：nudojs IO/格式/路径/artifact/fix/whatif 面。
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync, readdirSync, realpathSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative } from "node:path";
import { runCliTsx, repoRoot, runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { shouldAnalyzeFile, type PathError } from "@nudojs/service";
import { collectNudoFiles, collectExternalRecords } from "../commands/shared.ts";
import { tmpProject } from "./helpers/tmp-project.ts";
import { migrateRetireMany, migrateStrip, migrateVerify } from "../migrate.ts";
import { abs } from "@nudojs/core";
import { zodInputSlots } from "../commands/export/zod-face.ts";
import { runContractDraft } from "../commands/contract-draft.ts";
import { parseWhatIfBindings } from "../check-gate-config.ts";
import { DIAG } from "@nudojs/core/internal";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// `nudo test` 的 error 级分析诊断必须挡退出码
// ---------------------------------------------------------------------------
describe("`nudo test` 的 error 级分析诊断必须挡退出码", () => {
/**
 * `nudo test` 看不到**分析面 error 级诊断** ⇒ 假绿。
 *
 * 两个可观察面（同一根因：`commands/test.ts` 的退出码只由声明断言 + pathErrors
 * 决定，error 级分析诊断完全不参与）：
 * - 模块装载失败（`nudo:module-missing`，error）⇒ `nudo check` 判红，`nudo test`
 * 此前报绿（exit 0）；
 * - `--json` 面没有 `ok` / error 计数 ⇒ CI 消费方不解析 `diagnostics[]` 就看不出
 * 失败。
 *
 * 反向钉：warning 级诊断（模块环）**不得**把 `test` 判红（那会大面积假红）。
 */






function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug14-"));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const CLEAN = `export function add(a, b) {
  return a + b;
}
`;

/** error 级分析诊断：import 的模块不存在 ⇒ `nudo:module-missing`（error）。 */
const MISSING_MODULE = `import { missing } from "./missing.js";
export function call(a) {
  return missing(a);
}
`;

/** warning 级分析诊断：模块环 ⇒ `nudo:module-cycle`（warning）。 */
const CYCLE_A = `import { b } from "./b.js";
export function a() { return b(); }
`;
const CYCLE_B = `import { a } from "./a.js";
export function b() { return a(); }
`;

describe("`nudo test` 的 error 级分析诊断必须挡退出码", () => {
  it("module-missing（error）⇒ exit 1 且诊断上屏", () => {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCliTsx(["test", join(dir, "m.js")]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[error]");
      expect(r.stdout).toContain("nudo:module-missing");
    } finally {
      cleanup(dir);
    }
  });

  it("--json：ok=false 且 summary.errors 反映 error 计数", () => {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCliTsx(["test", join(dir, "m.js"), "--json"]);
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        ok?: boolean;
        summary?: { errors?: number };
      };
      expect(json.ok).toBe(false);
      expect(json.summary?.errors ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup(dir);
    }
  });

  it("干净文件：ok=true、errors=0、exit 0", () => {
    const dir = project({ "ok.js": CLEAN });
    try {
      const r = runCliTsx(["test", join(dir, "ok.js"), "--json"]);
      expect(r.status).toBe(0);
      const json = JSON.parse(r.stdout) as {
        ok?: boolean;
        summary?: { errors?: number };
      };
      expect(json.ok).toBe(true);
      expect(json.summary?.errors).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  it("warning 级诊断（模块环）不得把 test 判红", () => {
    const dir = project({ "a.js": CYCLE_A, "b.js": CYCLE_B });
    try {
      const r = runCliTsx(["test", join(dir, "a.js")]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:module-cycle");
    } finally {
      cleanup(dir);
    }
  });
});
});

// ---------------------------------------------------------------------------
// rest 参数在 zod / standard 面是**一层**数组
// ---------------------------------------------------------------------------
describe("rest 参数在 zod / standard 面是**一层**数组", () => {
/**
 * `export --format all` 把 rest 参数投影成「**数组的数组**」，
 * 而 dts 面是单数组 ⇒ 同一份产物集里两个方言给出不同的接受集。
 *
 * 根因：`observedRestAbs` 按「rest 位之后每个实参一个槽」遍历 `argAbs`，但
 * 入口见证（`entry@`）把剩余参数编码成**一个数组实参** ⇒ 那个数组被当成
 * 「单个 rest 实参」再包一层。
 *
 * 钉：zod / standard 的 rest 槽是**一层**数组（`z.array(z.unknown())` /
 * `{"k":"arr","element":{"k":"unknown"}}`），与 dts 的 `...rest: unknown[]` 同形。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function withRest(a, ...rest) {\n  return rest.length;\n}\n";

describe("rest 参数在 zod / standard 面是**一层**数组", () => {
  it("zod 入参槽 = z.array(z.unknown())（不是数组的数组）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "rest.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rest: z.array(z.unknown())");
    expect(r.stdout).not.toContain("z.array(z.array(");
  }, 60000);

  it("standard 面 rest 槽节点只有一层 arr（与 dts 的 ...rest: unknown[] 同形）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-std-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const all = runCliTsx(["export", join(dir, "rest.js"), "--format", "all"]);
    expect(all.status).toBe(0);
    // rest 槽恒可选 ⇒ standard 槽带 "optional":true（一层数组不变）
    expect(all.stdout).toContain('{"key":"rest","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(all.stdout).not.toContain('{"key":"rest","node":{"k":"arr","element":{"k":"arr"');
    expect(all.stdout).toContain("...rest: unknown[]");
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// --only 部分吞掉路径 ⇒ 不得静默丢文件
// ---------------------------------------------------------------------------
describe("--only 部分吞掉路径 ⇒ 不得静默丢文件", () => {
/**
 * `nudo check --only <codes…>` **部分吞掉**后面的路径 ⇒ 被吞的
 * 文件**从未被检查** ⇒ exit 0 假绿。
 *
 * 旧守卫只在「paths 全被吞空」（`paths.length === 0`）时触发；`paths` 已非空
 * 时，variadic 旗标吞掉的后续路径从 `paths` 里消失且无任何提示。
 * 现在：只要某 variadic 旗标的取值里出现「该旗标不接受 + 磁盘上确实是路径」
 * 的项，就报定向 usage error（exit 1）并提示 `--` 终止符。
 */






const CLEAN = `export function ok() {
  return 1;
}
`;
/** 未约束 entry ⇒ L2 entry-may-throw（门禁红） */
const BROKEN = `export function staticName(node) {
  return node.type;
}
`;

describe("-only 部分吞掉路径 ⇒ 不得静默丢文件", () => {
  it("`check clean.js --only <code> broken.js` ⇒ 定向 usage error + exit 1", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug046-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b46", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "clean.js"), CLEAN, "utf-8");
      writeFileSync(join(cwd, "broken.js"), BROKEN, "utf-8");

      // 对照：两个路径都在 ⇒ broken.js 的门禁红（exit 1）
      const both = runCliTsx(["check", "clean.js", "broken.js"], { cwd });
      expect(both.status).toBe(1);

      // 缺陷形态：--only 吞掉 broken.js ⇒ 旧实现 exit 0（文件没被检查）
      const swallow = runCliTsx(
        ["check", "clean.js", "--only", "nudo:entry-may-throw", "broken.js"],
        { cwd },
      );
      expect(swallow.status).toBe(1);
      expect(swallow.stderr).toContain("consumed the following path(s): broken.js");
      expect(swallow.stderr).toContain("--");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("对照：把 variadic 旗标放在 `--` 前、路径放后面 ⇒ 正常检查（不误报）", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug046-ok-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b46b", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "clean.js"), CLEAN, "utf-8");
      writeFileSync(join(cwd, "broken.js"), BROKEN, "utf-8");
      const r = runCliTsx(
        ["check", "--only", "nudo:entry-may-throw", "--", "clean.js", "broken.js"],
        { cwd },
      );
      // 两个路径都被检查（broken.js 红），且没有 usage error
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain("consumed the following path(s)");
      expect(r.stdout).toContain("clean.js");
      expect(r.stdout).toContain("broken.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// --fix 的 dry-run 计划 == --write 结果
// ---------------------------------------------------------------------------
describe("--fix 的 dry-run 计划 == --write 结果", () => {
/**
 * `nudo check --fix` 的 dry-run 打印的计划必须等于 `--write` 的
 * 实际写入，且 stdout 可被 `git apply --check -p1` 消费。
 *
 * 旧实现把「推进到计划文本」（`source = next` / `sidecarText = next`）放在
 * `if (opts.write)` 分支内 ⇒ dry-run 时后续 issue 仍按**修改前**的文本算：
 * 同一文件打出两份互相冲突的「新建文件」diff（`@@ -0,0 +1,2 @@`），
 * 第二份丢掉第一份的修改 ⇒ git 拒绝、且与 --write 结果不一致。
 */







/** 同一文件两处可修问题 ⇒ 两份针对同一侧车的 plan */
const HELPER = `export function staticName(node) {
  return node.type;
}
export function staticLabel(node) {
  return node.label;
}
`;

function makeProject(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b47", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "helper.js"), HELPER, "utf-8");
  return cwd;
}

describe("-fix 的 dry-run 计划 == --write 结果", () => {
  it("第二份 diff 以第一份为基准（累积），不是又一份「新建文件」", () => {
    const cwd = makeProject("nudo-bug047-");
    try {
      const r = runCliTsx(["check", "helper.js", "--fix"], { cwd });
      const hunks = r.stdout.split("\n").filter((l) => l.startsWith("@@ "));
      expect(hunks.length).toBeGreaterThanOrEqual(2);
      // 第一份 = 新建（空 → 2 行）；第二份必须**基于第一份**（1,2 → 1,3）
      expect(hunks[0]).toBe("@@ -0,0 +1,2 @@");
      expect(hunks[1]).toBe("@@ -1,2 +1,3 @@");
      expect(r.stdout).toContain("staticLabel");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dry-run 的 diff 可被 `git apply --check -p1` 消费", () => {
    const cwd = makeProject("nudo-bug047-apply-");
    try {
      const init = spawnSync("git", ["init", "-q", "."], { cwd, encoding: "utf8" });
      expect(init.status, `git init 失败: ${init.stderr}`).toBe(0);
      const r = runCliTsx(["check", "helper.js", "--fix"], { cwd });
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(g.status, `git apply --check -p1 应成功（stderr: ${g.stderr}）`).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dry-run 与 --write 得到同一份侧车内容", () => {
    const dryCwd = makeProject("nudo-bug047-dry-");
    const writeCwd = makeProject("nudo-bug047-write-");
    try {
      const dry = runCliTsx(["check", "helper.js", "--fix"], { cwd: dryCwd });
      expect(dry.status).toBe(1); // 残余 error ⇒ 门禁红
      const written = runCliTsx(["check", "helper.js", "--fix", "--write"], {
        cwd: writeCwd,
      });
      // 两条 fix 都落盘 ⇒ 残余 error 归零（dry-run 面才保持红）
      expect(written.status).toBe(0);
      const sidecar = readFileSync(join(writeCwd, "helper.nudo.js"), "utf-8");
      // 写入的两条都在（旧实现在 dry-run 面只能「看到」第一条的基准）
      expect(sidecar).toContain("staticName");
      expect(sidecar).toContain("staticLabel");
      // dry-run 的**累加后的** hunk 文本逐行等于写入内容
      for (const line of sidecar.split("\n").filter((l) => l.trim().length > 0)) {
        expect(dry.stdout).toContain(line);
      }
      expect(dry.stdout).toContain("staticName");
      expect(dry.stdout).toContain("staticLabel");
    } finally {
      rmSync(dryCwd, { recursive: true, force: true });
      rmSync(writeCwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// --fix --only 无命中必须可见
// ---------------------------------------------------------------------------
describe("--fix --only 无命中必须可见", () => {
/**
 * `nudo check --fix --only <码>` 匹配不到任何诊断时是**静默
 * no-op**：拼错的码与「这些诊断确实没有可自动应用的修复」输出完全一样。
 *
 * 现在两个面都可见：
 * - `--only` 的取值必须落在诊断码注册表（DIAG）内 ⇒ 拼错 ⇒ usage error + exit 1
 * - 合法码但本次目标没有该诊断 ⇒ 末尾明确报「matched no diagnostic」
 */






/** 未约束 entry ⇒ nudo:entry-may-throw（error）+ entry-only（info） */
const HELPER = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug048-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b48", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "helper.js"), HELPER, "utf-8");
  return cwd;
}

describe("-fix --only 无命中必须可见", () => {
  it("拼错的码 ⇒ usage error + exit 1（不再静默 no-op）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "helper.js", "--fix", "--only", "nudo:bogus-code"], {
        cwd,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("unknown diagnostic code(s): nudo:bogus-code");
      // 不能退化成「0 edit(s) planned」的静默形态
      expect(r.stdout).not.toContain("0 edit(s)");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("合法码但本次无该诊断 ⇒ 末尾报「matched no diagnostic」", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "helper.js", "--fix", "--only", "nudo:arg-count"], {
        cwd,
      });
      expect(r.stdout).toContain("--only nudo:arg-count matched no diagnostic");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// fix-write-failure
// ---------------------------------------------------------------------------
describe("fix-write-failure", () => {
/**
 * `nudo check --fix --write` 写盘失败抛**裸 Node 异常**（EACCES）
 * 且**不再处理其余文件**（整次运行中断）。
 *
 * 现在与读路径同口径：`error: check --fix cannot write <path>: <原因>`
 * + 计入残余 error + 继续处理其余目标。
 */






/** 未约束 entry ⇒ 可修（写侧车） */
const HELPER = `export function staticName(node) {
  return node.type;
}
`;

/** root 对 chmod 555 免疫（写入仍成功）⇒ 该用例在 root 下无意义 */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe.skipIf(isRoot)("BUG-049 — --fix --write 的写失败不中断整次运行", () => {
  it("不可写目录 ⇒ 有措辞的 error + 其余目标仍被处理", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug049-"));
    const roDir = join(cwd, "ro");
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b49", private: true, type: "module" }),
        "utf-8",
      );
      mkdirSync(roDir);
      writeFileSync(join(roDir, "helper.js"), HELPER, "utf-8");
      writeFileSync(join(cwd, "second.js"), HELPER, "utf-8");
      chmodSync(roDir, 0o555);

      const r = runCliTsx(
        ["check", join("ro", "helper.js"), "second.js", "--fix", "--write"],
        { cwd },
      );

      // 有 nudo 的措辞（不是裸 errno：旧实现 stdout/stderr 里只有 EACCES 原文）
      expect(r.stderr).toContain("error: check --fix cannot write");
      expect(r.stderr).toContain("EACCES");
      // 其余目标仍被处理：second.nudo.js 落盘
      expect(r.stdout).toContain("second.nudo.js");
      // 写失败计入残余 error（门禁红）
      expect(r.stdout).toContain("residual error(s) remain");
      expect(r.status).toBe(1);
    } finally {
      chmodSync(roDir, 0o755);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// --fix --write 不写共享侧车路径
// ---------------------------------------------------------------------------
describe("--fix --write 不写共享侧车路径", () => {
/**
 * `nudo check --fix --write` 写的侧车污染同目录**共享同一侧车
 * 路径**的兄弟模块（`foo.js` 与 `foo.mjs` 都映射到 `foo.nudo.js`）：
 * 给未被修复的兄弟**新增** error，且自己的 fix 被静默丢弃。
 *
 * 现在：检测到共享 ⇒ **拒绝落盘**（可见 error + 点名共享者 + 汇总计数），
 * 不再新写入任何共享侧车 ⇒ 兄弟模块的错误数不增加。
 */






const FOO_JS = `export function a(user) {
  return user.name;
}
`;
const FOO_MJS = `export function b(user) {
  return user.age;
}
`;

/** 人类面 error 计数（` N error · …`） */
function errorCount(stdout: string): number {
  const m = /^\s*(\d+) error · /m.exec(stdout);
  return m ? Number(m[1]) : Number.NaN;
}

describe("-fix --write 不写共享侧车路径", () => {
  it("foo.js + foo.mjs 共存 ⇒ 拒绝落盘、兄弟模块错误数不变", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug067-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b67", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "foo.js"), FOO_JS, "utf-8");
      writeFileSync(join(cwd, "foo.mjs"), FOO_MJS, "utf-8");

      const before = runCliTsx(["check", "foo.mjs"], { cwd });
      expect(errorCount(before.stdout)).toBe(1);

      const fix = runCliTsx(["check", ".", "--fix", "--write"], { cwd });
      // 拒绝落盘必须可见（旧实现只报「1 edit(s) written, 1 applied」）
      expect(fix.stderr).toContain("refuses to write sidecar");
      expect(fix.stderr).toContain("shared with");
      expect(fix.stdout).toContain("sidecar write(s) refused");
      // 共享侧车没有被写出来（写了就会污染兄弟模块）
      expect(existsSync(join(cwd, "foo.nudo.js"))).toBe(false);

      const after = runCliTsx(["check", "foo.mjs"], { cwd });
      expect(errorCount(after.stdout)).toBe(1);
      expect(after.stdout).not.toContain("nudo:contract-load");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// stdout 平铺的顶层标识符互不冲突
// ---------------------------------------------------------------------------
describe("stdout 平铺的顶层标识符互不冲突", () => {
/**
 * `export --format all` 的 stdout 平铺**跨段去重只认「导出声明」**
 * ⇒ 与 zod 段的 `import { z }` / standard 段的非导出 helper 撞名
 * （TS2440 + `z.object` 被解析到用户自己的 `z` ⇒ **语义串味**）。
 *
 * 修法：去重表登记**每一段的全部顶层标识符**（导出声明 + 非导出声明 + import
 * 绑定）；撞名时**工具让位**（import 绑定改名为别名 `z as zZod`，导出名加方言
 * 后缀），用户导出名恒占。
 *
 * 钉：用户导出 `z` 的模块 ⇒ 平铺产物**能过 `tsc --strict`**（rc 0），且用户的
 * `export declare function z` 仍是原名。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function z(x) {\n  return x;\n}\nz(1);\n";

/** zod 桩：平铺产物只 import `{ z }`，类型面 any 即可（编译面判的是作用域冲突）。 */
const ZOD_STUB = "export declare const z: any;\n";

describe("stdout 平铺的顶层标识符互不冲突", () => {
  it("用户导出 `z` + zod 段 import ⇒ 产物可编译（tsc --strict rc 0）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b075-"));
    dirs.push(dir);
    writeFileSync(join(dir, "zname.js"), SRC, "utf-8");
    mkdirSync(join(dir, "node_modules", "zod"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "zod", "index.d.ts"), ZOD_STUB, "utf-8");
    writeFileSync(
      join(dir, "node_modules", "zod", "package.json"),
      '{"name":"zod","version":"0.0.0-stub","types":"index.d.ts","main":"index.js"}\n',
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler","noEmit":true,"skipLibCheck":true}}\n',
      "utf-8",
    );

    const r = runCliTsx(["export", join(dir, "zname.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // 用户的导出名恒占（工具侧让位）
    expect(r.stdout).toContain("export declare function z(x: number): number;");
    writeFileSync(join(dir, "out.ts"), r.stdout, "utf-8");

    const tsc = spawnSync(join(repoRoot, "node_modules/.bin/tsc"), ["-p", join(dir, "tsconfig.json")], {
      cwd: dir,
      encoding: "utf8",
    });
    // 改前：out.ts(4,10) TS2440 + 一片 TS2339（z.object 解析到用户的 z 上）
    expect(`${tsc.stdout}${tsc.stderr}`).not.toContain("TS2440");
    expect(`${tsc.stdout}${tsc.stderr}`).not.toContain("TS2339");
    expect(tsc.status).toBe(0);
  }, 90000);

  it("用户导出 `__nudoCheck`（standard 段的非导出 helper 同名）⇒ 不重复声明", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b075-helper-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "helper.js"),
      "export function __nudoCheck(x) {\n  return x;\n}\n__nudoCheck(1);\n",
      "utf-8",
    );
    const r = runCliTsx(["export", join(dir, "helper.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // helper 在前、用户导出在后 ⇒ 用户侧让位（`Dts` 后缀），helper 只声明一次
    const helperDecls = (r.stdout.match(/^function __nudoCheck\b/gm) ?? []).length;
    expect(helperDecls).toBe(1);
    const nameDecls = (r.stdout.match(/__nudoCheck/g) ?? []).length;
    expect(nameDecls).toBeGreaterThan(1);
    // 没有「同名两份顶层声明」：用户导出被改名后不再与 helper 撞名
    expect(r.stdout).not.toMatch(/^export declare function __nudoCheck\(/m);
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// export --format dts · 无证据参数的既定口径
// ---------------------------------------------------------------------------
describe("export --format dts · 无证据参数的既定口径", () => {
/**
 * `nudo export --format dts` 的**无证据参数**口径。
 *
 * 导出指南 en/zh 与 `docs/design/cli-semantics.md` §2 原本承诺：未被观测的
 * export 参数渲染为 **`unknown`** 并在 stderr 打一行**点名提示**。历史实现
 * （把 `abs.md:100` 的 display 规则误引到 .d.ts 产物面）渲染成
 * **`any`** 且不打提示，本文件曾钉住那处「文档 vs 实现」矛盾。
 *
 * 2026-11-06 产品裁定「nudo 的 any 含义更接近 TS 的 unknown」把 TS 投影面
 * 归一为 `unknown` ⇒ **文档承诺的类型部分已兑现**。`abs.md` 的 display 规则
 * 仍只管 nudo 展示 / CLI 面（那里 any 与 unknown 继续区分）。
 *
 * 归一还带来一个**顺带的正面效应**：提示通道是按「渲染成 unknown」触发的，
 * 所以主路径也开始打点名提示 ⇒ 记录的「文档承诺 vs 实现」矛盾
 * （类型 + 提示两半）**彻底关闭**：① **主路径**（普通导出函数，完全无证据 /
 * 契约未覆盖某位）⇒ `unknown` + stderr `rendered as unknown`；
 * ② **窄路径**（`@nudo:skip` / 无 case 函数 **且** 手写契约参数位存在
 * ⇒ `contractOnlySignature`）⇒ 同样的 `unknown` + 点名提示。
 * 本文件钉住新口径；提示通道若退回只覆盖窄路径，这条回归会先亮红灯。
 *
 * ⚠ 夹具里写 `writeSrcTsconfig`：CLI 子进程按 cwd 找 tsconfig，否则落到
 * `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现。
 */






function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-076-"));
  writeSrcTsconfig(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export --format dts · 无证据参数的既定口径", () => {
  it("主路径：完全无证据的导出函数 ⇒ 参数 unknown，stderr 点名提示", () => {
    const dir = fixtureDir({
      "noev.js": `export function neverCalled(a, b) {\n  return a + b;\n}\n`,
    });

    const r = runCli(["export", "noev.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Abs `any`（未约束）⇒ TS unknown（nudo any ≈ TS unknown；2026-11-06 归一）
    expect(r.stdout).toContain("export declare function neverCalled(a: unknown, b: unknown)");
    expect(r.stdout).toContain("@param a - unknown");
    expect(r.stdout).toContain("unknown");
    // 归一后主路径也纳入提示通道（文档承诺完全兑现）
    expect(r.stderr).toContain("rendered as unknown");
  }, 30000);

  it("主路径：契约只覆盖部分形参时，未覆盖位同样是 unknown", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "partial.js": `export function partialFn(a, b) {\n  return a + b;\n}\n`,
      "partial.nudo.js": `import { number } from "@nudojs/core";\nexport const partialFn = fn({ a: number() }, number());\n`,
    });

    const r = runCli(["export", "partial.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("export declare function partialFn(a: number, b: unknown)");
    expect(r.stdout).toContain("b: unknown");
    expect(r.stderr).toContain("rendered as unknown");
  }, 30000);

  it("窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "skipped.js": [
        `/// @nudo:import { positive } from "./std.nudo.js"`,
        `/**`,
        ` * @nudo:skip`,
        ` * @nudo:contract a positive`,
        ` */`,
        `export function sk3(a, b) {`,
        `  return a + b;`,
        `}`,
        ``,
      ].join("\n"),
    });

    const r = runCli(["export", "skipped.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // 契约位具名投影；未覆盖位 = unknown（contractOnlySignature 的兜底）
    expect(r.stdout).toContain("export declare function sk3(a: number, b: unknown)");
    // 提示点名到 `fn.param`，并给出三条补证据路径
    expect(r.stderr).toContain("note: sk3.b rendered as unknown");
    expect(r.stderr).toContain("*.nudo.js");
    expect(r.stderr).toContain("@nudo:contract");
    expect(r.stderr).toContain("@nudo:case");
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// 截断诊断跨面可见（test / --json / check）
// ---------------------------------------------------------------------------
describe("截断诊断跨面可见（test / --json / check）", () => {
/**
 * CLI 回归：截断诊断必须**跨面可见**。
 *
 * 修前：同一份递归源码，`nudo check` / `nudo health` 报「求值被截断」，
 * `nudo test`（人类面 + `--json`）**零诊断** —— 三个面对同一件事给出互斥
 * 结论，`test --freeze` 还会把放宽结果固化成 `@nudo:case` 事实。
 * 文档承诺（website/docs/guides/performance.md）：truncation never degrades
 * results silently。
 *
 * 断言面：text 面标注 / `--json` 的 diagnostics[] 与 summary 自洽 /
 * check 面同码（跨面口径一致）。
 */






/** 自递归：抽象实参 `n - 1` 仍是 `number` ⇒ 同指纹在栈上（cycle 归因） */
const SELF_RECURSION = `export function loop(n) {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
`;

const CODE = "nudo:recursion-truncated";

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug099-"));
  const file = join(dir, "self.js");
  writeFileSync(file, SELF_RECURSION, "utf-8");
  return file;
}

interface TestJson {
  summary: { diagnostics: number };
  diagnostics: { code: string; severity: string }[];
}

describe("截断诊断跨面可见（test / --json / check）", () => {
  it("test 文本面与 --json 面都带 nudo:recursion-truncated", { timeout: 60_000 }, () => {
    const file = writeFixture();

    const text = runCliTsx(["test", file]);
    expect(text.stdout).toContain(`(${CODE})`);
    expect(text.stdout).toContain("Recursive evaluation of 'loop'");

    const json = runCliTsx(["test", file, "--json"]);
    const parsed = JSON.parse(json.stdout) as TestJson;
    const trunc = parsed.diagnostics.filter((d) => d.code === CODE);
    expect(trunc).toHaveLength(1);
    expect(trunc[0]!.severity).toBe("info");
    // summary 计数来自同一条数组 ⇒ 两面自洽（此前恒为 0）
    expect(parsed.summary.diagnostics).toBe(parsed.diagnostics.length);
  });

  it("check 面同码同源（跨面口径一致，info 不挡门禁）", { timeout: 60_000 }, () => {
    const file = writeFixture();
    const r = runCliTsx(["check", file]);
    expect(r.stdout).toContain(`(${CODE})`);
    // 门禁仍由 L2 may-throw 决定：截断诊断是 info，不是新错误
    expect(r.stdout).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// 目录目标扫描排除产品默认安全目录（dist / coverage）
// ---------------------------------------------------------------------------
describe("目录目标扫描排除产品默认安全目录（dist / coverage）", () => {
/**
 * CLI 的**目录目标扫描**只抄了产品默认安全排除 3 条里的 1 条
 * （`node_modules`）⇒ `dist/` / `coverage/` 里的构建产物被当源码门禁。
 *
 * 后果（本次逐条钉住）：
 * ① `nudo test <pkg>` 因**陈旧构建产物**里的过期见证而**红**（假红）
 * ② **CLI 与 IDE / vite 对同一文件结论相反**（service 闸门恒不分析 dist/）
 * ③ **watch 扫描**同样扫进 `dist/`
 *
 * 修法：目录发现复用产品唯一的范围闸门（`shouldAnalyzeFile`）⇒
 * `DEFAULT_ANALYSIS_EXCLUDE`（node_modules / dist / coverage）三条全生效。
 */








/** 源码：见证成立 */
const SRC_LIB = `/**
 * @nudo:case "ok" (2) => 4
 */
export function double(x) {
  return x * 2;
}
`;
/** 陈旧构建产物：见证早已作废（源码里早就删掉了） */
const DIST_LIB = `/**
 * @nudo:case "stale" (2) => 99
 */
export function double(x) {
  return x * 2;
}
`;

describe("目录目标扫描排除产品默认安全目录（dist / coverage）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：pkg/{package.json, src/lib.js, dist/lib.js, coverage/cov.js} */
  function makeFixture(): string {
    const pkg = mkdtempSync(join(tmpdir(), "nudo-1026-"));
    dirs.push(pkg);
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "scopefx", version: "1.0.0", private: true, type: "module" }),
      "utf-8",
    );
    mkdirSync(join(pkg, "src"), { recursive: true });
    mkdirSync(join(pkg, "dist"), { recursive: true });
    mkdirSync(join(pkg, "coverage"), { recursive: true });
    writeFileSync(join(pkg, "src", "lib.js"), SRC_LIB, "utf-8");
    writeFileSync(join(pkg, "dist", "lib.js"), DIST_LIB, "utf-8");
    writeFileSync(join(pkg, "coverage", "cov.js"), DIST_LIB, "utf-8");
    return pkg;
  }

  it("collectNudoFiles 不收 dist/ 与 coverage/ 下的文件（改前：收进来）", () => {
    const pkg = makeFixture();
    const names = collectNudoFiles(pkg)
      .map((f) => f.split("/").slice(-2).join("/"))
      .sort();
    expect(names).toEqual(["src/lib.js"]);
  });

  it("CLI check <pkg> 的文件集合里没有 dist/（改前：多出 dist/lib.js）", () => {
    const pkg = makeFixture();
    const r = runCliTsx(["check", pkg]);
    expect(r.stdout).not.toContain("dist/lib.js");
    expect(r.stdout).not.toContain("coverage/cov.js");
    expect(r.stdout).toContain("src/lib.js");
  });

  it("CLI test <pkg> 不因陈旧构建产物而红（改前：exit 1 假红）", () => {
    const pkg = makeFixture();
    const r = runCliTsx(["test", pkg]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("stale");
    expect(r.stdout).toContain("ok");
  });

  it("跨面一致：CLI 目录发现与 IDE/vite 的 service 闸门对同一批文件给出相同结论", () => {
    const pkg = makeFixture();
    const distFile = join(pkg, "dist", "lib.js");
    const srcFile = join(pkg, "src", "lib.js");
    // IDE / vite 走的就是这个闸门
    expect(shouldAnalyzeFile(distFile, DIST_LIB)).toBe(false);
    expect(shouldAnalyzeFile(srcFile, SRC_LIB)).toBe(true);
    // CLI 目录发现必须与它同口径
    const cliSet = collectNudoFiles(pkg);
    expect(cliSet).not.toContain(distFile);
    expect(cliSet).toContain(srcFile);
  });
});
});

// ---------------------------------------------------------------------------
// dropped preds 台账标题与内容同源
// ---------------------------------------------------------------------------
describe("dropped preds 台账标题与内容同源", () => {
/**
 * `nudo export` 的 stdout `dropped preds` 台账恒称「not projected into
 * zod」⇒ `--format standard`（**根本没产 zod 产物**）也这么写 ⇒ 误导诊断
 * （标题与内容张冠李戴）。
 *
 * 机制：台账**标题**取 `effectiveDialect`（`schemaDialectOf` 不看 `_format` ⇒
 * 恒 `"zod"`），而台账**内容**来自 **standard** 面的 dropped 记录 ⇒ 不同源。
 *
 * 修法（stdout 面，S5）：台账标题按**来源面**取名（standard）——zod 模块自己
 * 的台账（模块内注释）仍由 service 侧按 zod 口径出，两处标题不再同名重复。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：返回 bigint 的函数（lit bigint 不可投影 ⇒ 有 dropped 记录）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1050-"));
  dirs.push(dir);
  const file = join(dir, "bigint.js");
  writeFileSync(file, "export function retBigInt() { return 1n; }\n", "utf-8");
  return file;
}

/** 出现次数。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("dropped preds 台账标题与内容同源", () => {
  it("--format standard：台账标题不再宣称 zod（没有 zod 产物）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// dropped preds (not projected into standard):");
    expect(r.stdout).not.toContain("not projected into zod");
    // 内容仍在（有损投影的披露通道不能丢）
    expect(r.stdout).toContain("retBigInt");
    expect(r.stdout).toContain("not projected");
  }, 30000);

  it("--format all：zod 台账与 standard 台账各一次（标题不再同名重复）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /not projected into zod/g)).toBe(1);
    expect(count(r.stdout, /not projected into standard/g)).toBe(1);
  }, 30000);

  it("--format dts：无台账（dts 面不携带 dropped 记录）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("dropped preds");
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// --json 信封的 summary.pathErrors
// ---------------------------------------------------------------------------
describe("--json 信封的 summary.pathErrors", () => {
/**
 * `check --json` 的信封里 `summary.errors` **不含** `pathErrors`
 * （695 口径），而设计文档写的是「并计入」⇒ 只读 `summary.errors` 的机器
 * 消费方把「路径失败」读成「0 错」（`ok` 才是 false）。
 *
 * 现在信封给出**不含歧义**的字段 `summary.pathErrors`（路径错误 / 文件级
 * 硬错误条数），`summary.errors` 仍是分析诊断数（= Σ reports[]，core 契约），
 * 绿运行不加该字段（JSON 逐字节不变）。
 */






type Envelope = {
  ok: boolean;
  summary: { errors: number; pathErrors?: number };
  pathErrors?: Array<{ code: string }>;
  reports: unknown[];
};

const CLEAN = `export function ok() {
  return 1;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug115-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b115", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "ok.js"), CLEAN, "utf-8");
  return cwd;
}

describe("-json 信封的 summary.pathErrors", () => {
  it("路径不存在 ⇒ ok:false + summary.pathErrors = 1（summary.errors 仍只数诊断）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--json", "nope.js"], { cwd });
      expect(r.status).toBe(1);
      const env = JSON.parse(r.stdout) as Envelope;
      expect(env.ok).toBe(false);
      // 695 口径保留：分析诊断数不含路径错误（= Σ reports[]）
      expect(env.summary.errors).toBe(0);
      // 新增的不歧义字段：机器消费方不必再数 pathErrors[]
      expect(env.summary.pathErrors).toBe(1);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("绿运行 ⇒ 不带 pathErrors 字段（JSON 形态不漂移）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--json", "ok.js"], { cwd });
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout) as Envelope;
      expect(env.ok).toBe(true);
      expect("pathErrors" in env.summary).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// / `<fn>Input` 的顶层键
// ---------------------------------------------------------------------------
describe("/ `<fn>Input` 的顶层键", () => {
/**
 * `<fn>Input` 的**键语义**在解构形参与普通形参上相反 ⇒
 * `plainInput` 拒绝 `.d.ts` 明文声明的调用形态。
 *
 * **口径已由 修正**：把解构形参整段收进一个以**求值占位**
 * （`_p0`）命名的槽 —— 占位名不是公共名，发布的校验器因此对唯一合法调用报
 * `required@_p0`。现口径：解构形参按**字段名**建顶层键（与 dts 声明的调用形态
 * 同形）；普通形参仍按形参名。
 *
 * 症状：解构形参 `destr({ a, b })` ⇒ `destrInput` 的顶层键是**绑定名**
 * （`{a, b}` = 实参的**值**）；普通形参 `plain(o)` ⇒ 顶层键是**形参名**
 * （`{o: …}` = 实参的**包**）⇒ 同一份导出包里两个函数的 Input 语义相反，而
 * 文档与 dts 面都是「**具名形参**」。
 *
 * 修法：解构形参的字段级契约收进**一个**槽，槽名取**形参名**
 * （`FormalParam.placeholder`，与无契约的解构分支 / 数组解构分支同口径）⇒
 * `<fn>Input` 的顶层键集合 ≡ 形参名集合（字段级槽交给元组合成的那条分支不变）。
 *
 * 钉（三个面同口径 + 顶层键 ≡ 形参名）：
 * - zod：`destrInput` / `plainInput` 的顶层键都是形参名，值都是那个对象的形状；
 * - standard：`destrInput` 的槽节点是**一个**对象槽 `_p0`；
 * - 负控制：数组解构的字段级契约仍是**元组**（口径不变）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = [
  "export function destr({ a, b }) { return a + b; }",
  "export function plain(o) { return o.a + o.b; }",
  "",
].join("\n");

const SIDECAR = [
  'import { fn, number, string, shape } from "@nudojs/core";',
  "export const destr = fn({ a: number(), b: string() });",
  "export const plain = fn({ o: shape({ a: number(), b: string() }) });",
  "",
].join("\n");

function fixture(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b120-"));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.js"), SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  for (const [name, content] of Object.entries(extra)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/**
 * 某个 `<fn>Input` 导出的 Standard Schema 节点（`__nudoCheck(<node>, value, …)`
 * 里的那段 JSON）。
 */
function inputNode(stdout: string, exportName: string): string {
  const idx = stdout.indexOf(`export const ${exportName} = {`);
  expect(idx).toBeGreaterThan(-1);
  const m = /__nudoCheck\((\{.*?\}), value, \[\], issues\)/.exec(stdout.slice(idx));
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("/ `<fn>Input` 的顶层键", () => {
  // 口径（覆盖 的槽名部分）：解构形参**没有公共名**，`_p0` 是
  // 求值占位 ⇒ 公共面只允许源码里写得出来的键。解构形参因此按**字段名**建顶层
  // 键（= `.d.ts` 明文声明的调用形态 `f({ a, b })`）；普通形参仍按形参名建键。
  it("zod：解构形参按**字段名**建顶层键（不再是内部占位 `_p0`）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/export const destrInput = z\.object\(\{ a:/);
    expect(r.stdout).not.toContain("_p0");
    // 普通形参：形参名 `o` ⇒ 值是该对象的形状
    expect(r.stdout).toMatch(/export const plainInput = z\.object\(\{ o: z\.object\(\{ a:/);
  }, 60000);

  it("standard：解构形参的顶层槽是字段名（无占位名）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(inputNode(r.stdout, "destrInput")).toContain('"key":"a"');
    expect(inputNode(r.stdout, "destrInput")).not.toContain("_p0");
    expect(inputNode(r.stdout, "plainInput")).toContain('"key":"o","node":{"k":"obj"');
  }, 60000);

  it("负控制：数组解构的字段级契约仍是元组（Bug 394 口径不变）", () => {
    const dir = fixture({
      "arr.js": "export function f7([a, b]) { return a; }\n",
      "arr.nudo.js": 'import { fn, number } from "@nudojs/core";\nexport const f7 = fn({ a: number() }, number());\n',
    });
    const r = runCliTsx(["export", join(dir, "arr.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// --from 路径去重
// ---------------------------------------------------------------------------
describe("--from 路径去重", () => {
/**
 * 回归：同一个 `--from` 路径给两次不是两个现场。
 *
 * 改前 `collectExternalRecords` 逐项处理、不去重 ⇒ 同一路径登记两次错误、
 * 跑两次求值探针，human 面还把同一文件说成「2 usage-site files」。
 */






describe("-from 路径去重", () => {
  it("同一缺失路径给两次 ⇒ 只登记一条错误", () => {
    const dir = tmpProject("nudo-171-");
    const missing = join(dir, "nope.js");
    const sink: PathError[] = [];
    collectExternalRecords([missing, missing], sink);
    expect(sink).toHaveLength(1);
  });

  it("同一现场文件给两次 ⇒ 记录不重复（按调用点身份各一条）", () => {
    const dir = tmpProject("nudo-171-dup-", {
      "site.js": 'import { f } from "./lib.js";\nexport const v = f(1);\n',
      "lib.js": "export function f(a) { return a + 1; }\n",
    });
    const site = join(dir, "site.js");
    const once = collectExternalRecords([site], []);
    const twice = collectExternalRecords([site, site], []);
    expect(twice?.length ?? 0).toBe(once?.length ?? 0);
  });
});
});

// ---------------------------------------------------------------------------
// stdout 跨段改名不碰 schema 里的槽键数据
// ---------------------------------------------------------------------------
describe("stdout 跨段改名不碰 schema 里的槽键数据", () => {
/**
 * `export --format all`（stdout）的跨段改名是**裸文本替换** ⇒ 把
 * standard 段 `{"key":"<形参名>"}` 这个**数据**一并改名 ⇒ 导出的 standard
 * schema 要求一个根本不存在的形参名，与同一产物里的 zod 段 / dts 段结论相反。
 *
 * 根因：`renameIdentifier` 只做标识符边界判断，不区分「绑定名」与「字符串
 * 字面量里的数据」。
 *
 * 修法：改名走**词法感知**的实现（跳过字符串 / 模板 / 注释 / 属性访问 /
 * 对象字面量的键），只改绑定与引用。
 *
 * 钉（形参名与函数名同形的夹具）：standard 段的槽键**仍是原形参名**，导出名
 * 让位为 `<原名>Standard`；zod 段 / dts 段仍用原形参名。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function f1(f1Input) {\n  return f1Input;\n}\n";

describe("stdout 跨段改名不碰 schema 里的槽键数据", () => {
  it("standard 段的槽键是原形参名（导出名让位，数据不动）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(r.status).toBe(0);

    // 数据（槽键）保持原形参名 ⇒ 与 zod 段 / dts 段判同一个对象
    expect(r.stdout).toContain('{"key":"f1Input","node"');
    expect(r.stdout).not.toContain('"key":"f1InputStandard"');
    // 导出名照常去重（仍是 `<fn>Input` 让位）
    expect(r.stdout).toContain("export const f1InputStandard");
    // zod 段仍用原形参名
    expect(r.stdout).toContain("export const f1Input = z.object({ f1Input:");
    // dts 段的形参名不变
    expect(r.stdout).toContain("export declare function f1(f1Input: unknown): unknown;");
  }, 60000);

  it("负控制：--out 落盘的 standard 产物槽键同样是原形参名（两条投递路径同结论）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-out-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    const artifact = readFileSync(join(out, name!), "utf-8");
    expect(artifact).toContain('{"key":"f1Input","node"');
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// 唯一名兜底分支按「同一模块」覆盖更新
// ---------------------------------------------------------------------------
describe("唯一名兜底分支按「同一模块」覆盖更新", () => {
/**
 * `nudo export --out` 的「唯一名兜底」分支**不查「同一模块」** ⇒
 * 同一模块重导落盘产生**内容互斥**的陈旧副本并逐次累积。
 *
 * 症状：两个同名模块（`a/lib.js` / `b/lib.js`）导出到同一 `--out` 目录后再改
 * `b` 的源码重导 ⇒ 每次新增 `.2` / `.3` 编号副本，旧的保留 ⇒ 同一目录里两份
 * 文件自称同一模块的投影却给出互斥的返回形态（`=> 3` vs `=> 201`）。
 *
 * 根因：唯一名兜底循环只判「内容一致」与「是本工具产物」，从不调
 * `isSameModule`（规范名分支**有**这一步）。
 *
 * 钉：同一模块重导**原地覆盖**（产物数不增长、无编号副本、内容是最新一次导出）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("唯一名兜底分支按「同一模块」覆盖更新", () => {
  it("同名两个模块 + 同模块重导 ⇒ 无编号副本、无陈旧内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) {\n  return x + 1;\n}\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) {\n  return x + 2;\n}\nbeta(1);\n", "utf-8");

    const exportDts = (file: string) =>
      runCliTsx(["export", file, "--format", "dts", "--out", out]);

    expect(exportDts(join(dir, "a", "lib.js")).status).toBe(0);
    expect(exportDts(join(dir, "b", "lib.js")).status).toBe(0);
    // 改 b 的返回形态后重导（同一模块）
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) {\n  return x + 200;\n}\nbeta(1);\n", "utf-8");
    expect(exportDts(join(dir, "b", "lib.js")).status).toBe(0);

    const files = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 两个**不同**模块各一份；没有 `.2` / `.3` 编号副本
    expect(files).toHaveLength(2);
    expect(files.filter((f) => /\.\d+\.d\.ts$/.test(f))).toEqual([]);

    // 同一模块只留**最新**一份投影
    const bFiles = files.filter((f) => readFileSync(join(out, f), "utf-8").includes("beta"));
    expect(bFiles).toHaveLength(1);
    const body = readFileSync(join(out, bFiles[0]!), "utf-8");
    expect(body).toContain("=> 201");
    expect(body).not.toContain("=> 3");
  }, 90000);

  it("幂等重导：内容不变时仍是一份产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-idem-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) { return x + 1; }\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) { return x + 2; }\nbeta(1);\n", "utf-8");
    for (const f of ["a", "b", "b", "a"]) {
      expect(runCliTsx(["export", join(dir, f, "lib.js"), "--format", "dts", "--out", out]).status).toBe(0);
    }
    expect(readdirSync(out).filter((f) => f.endsWith(".d.ts"))).toHaveLength(2);
  }, 90000);
});
});

// ---------------------------------------------------------------------------
// --out 产物的相对说明符必须重基
// ---------------------------------------------------------------------------
describe("--out 产物的相对说明符必须重基", () => {
/**
 * `nudo export --format dts --out <dir>` 不重基相对模块说明符。
 *
 * 产物里的 `import type … from "./point.js"` / `export … from "./helper.js"`
 * 是相对**源目录**的；写到 `--out` 后解析基准变成输出目录 ⇒ 消费端
 * `tsc` 报 **TS2307**（同一份字节放源目录 0 error）。
 *
 * 修法（起）：写盘时把相对说明符压成产物**旁边的兄弟声明**
 * （`./point.js` / `./helper.js`，按源 stem 平铺的声明树；不再指向源目录）。
 * `ExportArtifacts.sourcePath` 是**独立**的可选字段 —— `moduleKey` 仍与
 * 路径无关，不回归。
 */






function makeFixture(): { src: string; outDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-bug-232-"));
  const src = join(root, "src");
  const outDir = join(root, "dist", "types");
  mkdirSync(src, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(src, "point.js"), `export class Point {\n  constructor(x) { this.x = x; }\n}\n`);
  writeFileSync(join(src, "point.d.ts"), `export declare class Point {\n  x: number;\n  constructor(x: number);\n}\n`);
  writeFileSync(join(src, "helper.js"), `export function helper() {\n  return 1;\n}\n`);
  writeFileSync(join(src, "helper.d.ts"), `export declare function helper(): number;\n`);
  writeFileSync(
    join(src, "user.js"),
    'import { Point } from "./point.js";\n\nexport { helper } from "./helper.js";\n\nexport function make(x) {\n  return new Point(x);\n}\n\nmake(1);\n',
  );
  return { src, outDir, root };
}

describe("-out 产物的相对说明符必须重基", () => {
  it("写出的 .d.ts 里的相对说明符从输出目录可解析（不再指向源目录）", () => {
    const { src, outDir } = makeFixture();
    // 平铺声明树：依赖模块也导出到同一 out ⇒ 兄弟声明就在产物旁边。
    for (const name of ["point.js", "helper.js", "user.js"]) {
      const r = runCli(["export", join(src, name), "--format", "dts", "--out", outDir]);
      expect(r.status, name).toBe(0);
    }

    const produced = join(outDir, "user.d.ts");
    expect(existsSync(produced)).toBe(true);
    const dts = readFileSync(produced, "utf-8");

    const specs = [...dts.matchAll(/\bfrom\s*["'](\.[^"']*)["']/g)].map((m) => m[1]!);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      // 说明符按**产物所在目录**解析必须落到一个真实文件（或它的 .d.ts）
      const abs = resolve(dirname(produced), spec);
      const candidates = [abs, abs.replace(/\.js$/, ".d.ts"), abs.replace(/\.js$/, ".ts")];
      expect(candidates.some((p) => existsSync(p)), `unresolved specifier ${spec}`).toBe(true);
    }
    // 说明符已被压成产物旁边的兄弟声明（不指向源目录）
    expect(dts).toContain('from "./helper.js"');
    expect(dts).not.toContain('from "../src/helper.js"');
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
});

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

describe("CLI：可选槽吸收 undefined", () => {
  it("optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` ⇒ exit 0、无 constraint-violated", () => {
    const file = fixture(
      "f",
      OPTIONAL_SIDECAR,
      `f({ a: undefined });\nf({});\nf({ a: "x" });`,
    );
    const r = runCliTsx(["check", file, "--json"]);
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
  });

  it("required 对照 + `{ a: undefined }` ⇒ exit 1 且报 nudo:constraint-violated", () => {
    const file = fixture("g", requiredSidecar("g"), `g({ a: undefined });`);
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as { ok: boolean; issues: CliIssue[] };
    expect(json.ok).toBe(false);
    const vs = json.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(vs).toHaveLength(1);
    expect(vs[0]!.expected).toBe('typeof o.a = "string"');
  });

  it("required 对照 + `{ a: 'x' }` ⇒ exit 0（对照组正例）", () => {
    const file = fixture("g2", requiredSidecar("g2"), `g2({ a: "x" });`);
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as { issues: CliIssue[] };
    expect(json.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });
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

describe("rest 入参槽不得多包一层数组", () => {
  it("A 组（无调用点）：zod / standard 槽是一层数组，dts 同形", () => {
    const dir = fixture(NO_CALLSITE);
    const schema = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    // rest 槽恒可选（zod 面 .optional()），仍是一层数组
    expect(schema.stdout).toContain("export const restOneInput = z.object({ args: z.array(z.unknown()).optional() })");
    expect(schema.stdout).not.toContain("z.array(z.array(");

    const std = runCliTsx(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(std.status).toBe(0);
    expect(std.stdout).toContain('{"key":"args","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(std.stdout).not.toContain('{"key":"args","node":{"k":"arr","element":{"k":"arr"');

    const dts = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.stdout).toContain("...args: unknown[]");
  }, 90000);

  it("A 组 standard 校验器**接受**该函数自己的合法调用 `{args:[1,2]}`", () => {
    const dir = fixture(NO_CALLSITE);
    const out = join(dir, "out");
    expect(runCliTsx(["export", join(dir, "lib.js"), "--format", "standard", "--out", out]).status).toBe(0);
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
  }, 90000);

  it("对照组（有调用点证据）：同样是**一层**数组，接受集与 A 组一致", () => {
    const dir = fixture(WITH_CALLSITE);
    const schema = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    expect(schema.stdout).not.toContain("z.array(z.array(");
    expect(schema.stdout).toMatch(/export const restOneInput = z\.object\(\{ args: z\.array\(z\.(union|unknown)/);
  }, 90000);
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
  it("--gha 单独 ⇒ 注解在 stdout（不回归）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "err.js"], { cwd });
      expect(r.status).toBe(1);
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(r.stdout).toContain("::error");
      expect(r.stderr).not.toContain("::error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("--gha --gitlab ⇒ stdout 仍是 GitLab 数组、stderr 有 ::error（不被丢弃）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "--gitlab", "err.js"], { cwd });
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
  });

  it("单变量对照：加 --json 后 GHA 计数不变（不再取决于无关旗标）", () => {
    const cwd = makeProject();
    try {
      const both = runCliTsx(["check", "--gha", "--gitlab", "err.js"], { cwd });
      const withJson = runCliTsx(
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
  it("check --from <使用现场> -- <被检查文件> ⇒ 报 nudo:contract-drift（改前 0 条）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(
      ["check", "--json", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nudo:contract-drift");
    expect(r.stdout).toContain("addOne[return]");
  }, 60000);

  it("控制组：没有跨文件证据 ⇒ 不报 drift（无证据不判）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["check", "--json", "lib.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("nudo:contract-drift");
  }, 60000);

  it("归因闸：别的模块的同名调用点证据不得污染本文件的判定", () => {
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
    const r = runCliTsx(
      ["check", "--json", "--from", "usage.js", "--", "other.js"],
      { cwd: dir },
    );
    expect(r.stdout).not.toContain("nudo:contract-drift");
  }, 60000);
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

describe("export — 数组解构形参的输入面（族 08 · S5 · ）", () => {
  it("zod 入参面：数组解构 + 字段级契约 ⇒ 元组槽（改前是对象槽 `a`）", () => {
    const dir = fixture({ "m394.js": ARRAY_SRC, "m394.nudo.js": ARRAY_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    // 改前的形态：对象槽按绑定名摊开
    expect(r.stdout).not.toContain("z.object({ a:");
  }, 30000);

  it("standard 面：数组解构形参的槽节点是元组", () => {
    const dir = fixture({ "m394s.js": ARRAY_SRC, "m394s.nudo.js": ARRAY_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394s.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"k":"tuple"');
    expect(r.stdout).not.toContain('"key":"a"');
  }, 30000);

  it("负控制：对象解构 + 字段级契约仍摊成对象槽（既有口径不变）", () => {
    const dir = fixture({ "m394o.js": OBJECT_SRC, "m394o.nudo.js": OBJECT_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394o.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.object({ a:");
  }, 30000);

  it("负控制：无契约的数组解构仍是观测元组（既有口径不变）", () => {
    const dir = fixture({ "m394n.js": ARRAY_SRC });
    const r = runCliTsx(["export", join(dir, "m394n.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    expect(r.stdout).not.toContain("z.object({ a:");
  }, 30000);
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
  it("--target 指向函数名：返回域取自函数面（不再是 `() => ?`）", () => {
    const dir = fixture({ "w405.js": SRC });
    const r = runCliTsx([
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
  }, 60000);

  it("两条面不再互相矛盾：--target 的返回域与签名表一致", () => {
    const dir = fixture({ "w405b.js": SRC });
    const whatIf = runCliTsx([
      "check",
      join(dir, "w405b.js"),
      "--what-if",
      "raw:string",
      "--target",
      "useRaw",
    ]);
    const table = runCliTsx(["check", join(dir, "w405b.js")]);
    expect(whatIf.status).toBe(0);
    expect(table.status).toBe(0);
    // 签名表：`useRaw() => 3`（字面量视图）
    expect(table.stdout).toContain("useRaw() =>");
    expect(table.stdout).not.toContain("=> ?");
    // --target：返回域视图（number），与签名表同属一个返回域
    expect(whatIf.stdout).toContain("() => number");
  }, 60000);

  it("控制：--target 指向非函数绑定时行为不变", () => {
    const dir = fixture({ "w405c.js": SRC });
    const r = runCliTsx([
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
  }, 60000);

  it("控制：--target 指向不存在的名字时仍是 unknown", () => {
    const dir = fixture({ "w405d.js": SRC });
    const r = runCliTsx([
      "check",
      join(dir, "w405d.js"),
      "--what-if",
      "raw:string",
      "--target",
      "nope",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Type of "nope": unknown');
  }, 60000);
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

describe("strip 产物不得残留「值位置的类型专用导入」（产物可加载）", () => {
  it("类型专用的值位置 import 被消掉 ⇒ 产物 `node --check` 过且真 import() 成功", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
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
  });

  it("产物里的 import 不得指向「没有该运行时导出」的模块（链接面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-445b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "types.ts"), TYPES_TS, "utf-8");
    writeFileSync(join(dir, "use.ts"), USE_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    // 被 import 的模块剥成空模块 ⇒ 任何残留的具名 import 都会链接失败
    const types = readFileSync(join(dir, "types.js"), "utf-8");
    expect(types.trim()).toBe("");
    const use = readFileSync(join(dir, "use.js"), "utf-8");
    expect(use).not.toMatch(/import\s/);
  });
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

describe("类成员的 `x!` / `y?` / `m?()` 必须被剥除（产物是合法 JS）", () => {
  it("字段的 `x!` / `y?` 被剥 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447-"));
    dirs.push(dir);
    writeFileSync(join(dir, "f3.ts"), FIELDS_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "f3.ts")]);
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
  });

  it("可选方法 `m?()` 被剥 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "om.ts"), OPTIONAL_METHOD_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "om.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "om.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("m?()");
    expect(code).toContain("m() {}");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
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

describe("TS 的 `this` 形参必须被剥除（产物可加载）", () => {
  it("`this` 形参被剥 ⇒ 产物 `node --check` 过且形参表只剩 `a`", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448-"));
    dirs.push(dir);
    writeFileSync(join(dir, "thisparam.ts"), THIS_PARAM_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "thisparam.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "thisparam.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("export function f(a)");
    expect(code).not.toContain("f(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("函数体里的 `this` **表达式**必须保留（只有形参位被删）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448b-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "body.ts"),
      `export function g(this: { x: number }) { return this.x; }\n`,
      "utf-8",
    );

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "body.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "body.js");
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("this.x");
    expect(code).not.toContain("g(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// 族 56 · CLI 面 3 条
// ---------------------------------------------------------------------------
describe("族 56 · CLI 面 3 条", () => {
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

describe("族 56 · CLI 面 3 条", () => {
  it("第 1 条：排除清单上 stdout（--json 面可解析；文本面 stdout 不含被排除的包）", () => {
    const { dir, legacy } = workspaceFixture();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
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
    const text = runCliTsx(["migrate", "status", dir]);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).not.toContain("packages/legacy");
    expect(text.stderr).toContain("skipped (pnpm excluded)");
    // 反向闸：被排除的包真的在工作区里（否则上面的断言是永真）
    expect(existsSync(join(legacy, "package.json"))).toBe(true);
  });

  it("第 1 条：retire --all --json 同样带排除清单（机器面统一口径）", () => {
    const { dir } = workspaceFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string; excluded?: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(row.excluded).toEqual(["packages/legacy"]);
    }
  });

  it("第 1 条 · 负控：无排除的 workspace ⇒ --json 逐字不变（不出现 excluded 键）", () => {
    const dir = cleanWorkspaceFixture();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("excluded");
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(Object.keys(row)).not.toContain("excluded");
    }
  });

  it("第 2 条：多个目标失败 ⇒ 消息列出**全部**失败目标，且整批零写盘", () => {
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
  });

  it("第 2 条：CLI 面 —— 失败目标全部可见（文本面 + --json 的 failedTargets）", () => {
    const a = plainPkg("cli-plain-a");
    const b = plainPkg("cli-plain-b");
    const r = runCliTsx(["migrate", "retire", a.dir, b.dir]);
    expect(r.status).toBe(0); // 「无可退役」是正常结果（口径不变）
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(a.dir);
    expect(all).toContain(b.dir);

    const j = runCliTsx(["migrate", "retire", a.dir, b.dir, "--json"]);
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
  });

  it("第 2 条：真错误与「无可退役」混在一批 ⇒ 报红（不再被当成正常结果吞成 exit 0）", () => {
    const plain = plainPkg("mix-plain");
    const broken = brokenPkg("mix-broken");
    const r = runCliTsx(["migrate", "retire", plain.dir, broken]);
    expect(r.status).toBe(1);
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(plain.dir);
    expect(all).toContain(broken);
    expect(all).toContain("package.json parse failed");
    // 原子性：整批零写盘
    expect(readFileSync(join(plain.dir, "package.json"), "utf-8")).toBe(plain.before);
  });

  it("第 2 条 · 反向闸：单个失败 ⇒ 消息与旧实现逐字同形", () => {
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
  });

  it("第 3 条：verify 的目标集合含 `.jsx`（JSX 产物不再对迁移闸门隐形）", () => {
    const dir = verifyFixture();
    const r = runCliTsx(["migrate", "verify", dir]);
    // 改前：`.jsx` 不可见 ⇒ verify 只看到 .js 目标（本 fixture 里一个都没有 ⇒
    // 走「空集 ⇒ 判红」分支），JSX 产物从未被验过。
    expect(r.stdout).toContain("Comp.jsx");
    expect(r.stdout).not.toContain("Not an analysis target");

    // 显式点名的 `.jsx` 目标也不再被拒（改前：not-a-target）
    const one = runCliTsx(["migrate", "verify", join(dir, "Comp.jsx")]);
    expect(one.stdout).toContain("Comp.jsx");
    expect(one.stdout).not.toContain("Not an analysis target");
  });

  it("第 3 条 · 反向闸：声明文件 / 侧车**仍不是** verify 的目标（Bug 566 同口径不变）", () => {
    const dir = verifyFixture();
    const r = runCliTsx(["migrate", "verify", dir]);
    expect(r.stdout).not.toContain("types.d.ts");
    expect(r.stdout).not.toContain("sidecar.nudo.js");
    // 显式点名的声明文件仍被拒（消息口径不变）
    const decl = runCliTsx(["migrate", "verify", join(dir, "types.d.ts")]);
    expect(decl.status).toBe(1);
    expect(`${decl.stdout}${decl.stderr}`).toContain("Not an analysis target");
  });
});
});

// ---------------------------------------------------------------------------
// 族 56b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）
// ---------------------------------------------------------------------------
describe("族 56b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）", () => {
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

describe("族 56b — migrateStrip 库面逐文件错误隔离（与 migrateVerify 同口径）", () => {
  it("同目标内一个文件语法错 ⇒ 库面不 throw + 成功文件的结果仍返回", async () => {
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
  });

  it("原子性仍成立 ⇒ 有失败时一个字节都不落盘（含好文件）", async () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });

    await migrateStrip([dir], { write: true, draft: false });

    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("失败行带文件名 + 失败码与 migrateVerify 同码（同款结构）", async () => {
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
  });

  it("负控：全部成功 ⇒ 返回行的字段逐字不变（无 code / error 键）", async () => {
    const dir = dirWith({ "a-good.ts": GOOD });

    const rows = await migrateStrip([dir], { write: false, draft: false });

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["file", "notes", "outFile"]);
    expect(rows[0]!.notes).toEqual([]);
  });

  it("CLI 面：失败目标的 stdout/stderr 与旧版逐字同形（失败详情带文件名）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
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
  });
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

describe("export --format standard 的 helper 只声明一次", () => {
  it("stdout 里 helper / 类型别名各只出现一次（两个函数 ⇒ 两块）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^function __nudoTypeOf/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoCheck/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoDescribe/gm)).toBe(1);
    expect(count(r.stdout, /^type NudoSchemaNode =/gm)).toBe(1);
    expect(count(r.stdout, /^const __nudoBrandCtors =/gm)).toBe(1);
  }, 30000);

  it("剥前导不丢内容：两个函数的导出体都在", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const alpha_x");
    expect(r.stdout).toContain("export const beta_x");
    expect(r.stdout).toContain("export const alphaInput");
    expect(r.stdout).toContain("export const betaInput");
    expect(r.stdout).toContain("// === alpha Standard Schema ===");
    expect(r.stdout).toContain("// === beta Standard Schema ===");
  }, 30000);

  it("--out 落盘不变（每函数一份文件，各带一份 helper ⇒ 互不冲突）", () => {
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
  }, 30000);
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

describe("export --format all 到 stdout：`<fn>Output` 不跨段撞名", () => {
  it("stdout 里 `fooOutput` 只声明一次（standard 段改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 段保留产品名；standard 段改名（不再是同名第二份）
    expect(count(r.stdout, /^export const fooOutput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooOutputStandard");
    expect(r.stdout).toContain('import { z } from "zod"');
  }, 30000);

  it("stdout 流里没有重复的顶层声明（产物可编译）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(duplicateTopLevelNames(r.stdout)).toEqual([]);
  }, 30000);

  it("--out 落盘不变（各方言各占一个文件 ⇒ 产品名不漂移）", () => {
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
  }, 30000);
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

describe("export --format all 到 stdout：`<fn>Input` 不跨段撞名", () => {
  it("stdout 里 `fooInput` 只声明一次（standard 段改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^export const fooInput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooInputStandard");
  }, 30000);

  it("dts 段不产 `<fn>Input`（报告的撞名对不存在 ⇒ 治的是 zod ↔ standard）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("fooInput");
    expect(r.stdout).toContain("export declare function foo");
  }, 30000);

  it("--format standard 单方言时导出名不漂移（无冲突 ⇒ 不改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const fooInput");
    expect(r.stdout).not.toContain("fooInputStandard");
  }, 30000);
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

describe("export — 剩余参数位（族 17 · S1 · ）", () => {
  it("zod 入参面：槽名取裸名、槽值是数组、不凭空造 argN 槽", () => {
    const dir = fixture({
      "rest604.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "rest604.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 剩余参数位：裸名 + 数组值
    expect(r.stdout).toContain("rest: z.array(");
    // 槽名不带 `...`
    expect(r.stdout).not.toContain('"...rest"');
    // 槽数取声明形参表（2 个）⇒ 没有凭空造出来的 `arg2`
    expect(r.stdout).not.toContain("arg2");
  }, 30000);

  it("standard 面：剩余参数位导出名取裸名，节点是数组", () => {
    const dir = fixture({
      "rest604b.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "rest604b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("sumAll_rest");
    expect(r.stdout).not.toContain("sumAll____rest");
    expect(r.stdout).not.toContain("sumAll_arg2");
  }, 30000);
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

describe("zod 槽表保留 `__proto__` 形参（无原型对象 ⇒ 不触发原型 setter）", () => {
  it("槽表把 `__proto__` 落为自有键（改前：普通对象 ⇒ 被原型 setter 吞掉）", () => {
    const slots = zodInputSlots([
      { name: "__proto__", abs: numAbs },
      { name: "normal", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["__proto__", "normal"]);
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
    expect(slots["__proto__"]?.value).toBe(numAbs);
    expect(slots["normal"]?.value).toBe(numAbs);
  });

  it("继承键（constructor / toString）同样不被原型吞掉", () => {
    const slots = zodInputSlots([
      { name: "constructor", abs: numAbs },
      { name: "toString", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["constructor", "toString"]);
    // 无原型 ⇒ 槽表不挂 Object.prototype（改前：挂原型 ⇒ 继承键可被误读）
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(slots["constructor"]?.value).toBe(numAbs);
    expect(slots["toString"]?.value).toBe(numAbs);
  });

  it(
    "产品面 zod Input 含 `__proto__` 形参（core 两处补丁后：projection 字段表无原型 + 键走计算键）",
    () => {
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
      const r = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("__proto__");
    },
    30000,
  );
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






describe("nudo export --out · standard 产物名不撞名", () => {
  it("同名函数在两个模块里 ⇒ 两份 standard 产物都在（先导出的不被覆盖）", () => {
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
  }, 60000); // 2 个顺序 CLI 子进程（tsx 冷启动）

  it("同名函数的第二份产物名带模块键后缀（不是同一个路径）", () => {
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
  }, 60000);
});
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

describe("export — 声明级默认值的可选性（族 17 · S1 · ）", () => {
  it("zod 入参面：带默认值的形参位是可选槽（与 dts 面同口径）", () => {
    const dir = fixture({
      "d611.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "d611.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("b: z.literal(2).optional()");
  }, 30000);

  it("dts 面仍声明可选位 `b?`（两面的可选性口径一致）", () => {
    const dir = fixture({
      "d611b.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "d611b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(a: number, b?: number): number;");
  }, 30000);
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






describe("nudo export --out · 写失败回放已落盘清单", () => {
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
});

// ---------------------------------------------------------------------------
// export — async 返回约束的 Promise 保形（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — async 返回约束的 Promise 保形（族 17 · S1 · ）", () => {
/**
 * async 函数的**返回约束被当成整个返回类型** ⇒ `Promise<…>` 包装丢失。
 *
 * 症状（改前）：`@nudo:contract return num` 的 async 函数，zod 面产出
 * `fOutput = z.number()…`（**不是** Promise）、dts 面产出
 * `export declare function f(x: number): number;`
 * ⇒ 产物说「返回 number」，实现返回的是 `Promise<number>` ⇒ 校验器会把合法
 * 返回值判非法（运行时校验器拿到的是 Promise）。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面直接投影契约返回
 * Abs，没有按观测返回的 `eff/promise` 形态保形。
 *
 * 修法（族 17 · S1）：观测返回是 `promise<…>` 时，契约返回描述的是 **await 后**
 * 的值 ⇒ 返回面用 `wrapPromise` 包住契约返回（三个产物面同口径）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-618-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;

describe("export — async 返回约束的 Promise 保形（族 17 · S1 · ）", () => {
  it("zod 返回面保留 promise 包装", () => {
    const dir = fixture({
      "c618.nudo.js": NUM,
      "async618.js": [
        `/// @nudo:import { num } from "./c618.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "async618.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.promise(");
  }, 30000);

  it("dts 面返回类型是 Promise<number>（不是 number）", () => {
    const dir = fixture({
      "c618b.nudo.js": NUM,
      "async618b.js": [
        `/// @nudo:import { num } from "./c618b.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "async618b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(x: number): Promise<number>;");
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// nudo export --out · 同 stem 模块产物不互相覆盖
// ---------------------------------------------------------------------------
describe("nudo export --out · 同 stem 模块产物不互相覆盖", () => {
/**
 * `nudo export --out` 的 dts / zod / guard 三面按源文件 **stem** 命名
 * ⇒ 不同目录下的同名模块映射到同一批产物路径 ⇒ 后写覆盖先写（先导出的那份
 * 无声丢失）⇒ 消费方拿到别的模块的声明。
 *
 * 钉：两个不同目录下的同名模块导出到同一个 out 目录 ⇒ 两份产物都在，
 * 先导出的那份内容不被覆盖。
 */






describe("nudo export --out · 同 stem 模块产物不互相覆盖", () => {
  it("两个目录下的同名模块 ⇒ 两份 .d.ts 都在（先导出的不被覆盖）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    const r1 = runCli(["export", aFile, "--format", "all", "--out", out]);
    expect(r1.status).toBe(0);
    const dtsFiles = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    expect(dtsFiles).toHaveLength(1);
    const firstBody = readFileSync(join(out, dtsFiles[0]!), "utf-8");
    expect(firstBody).toContain("alphaOnly");

    const r2 = runCli(["export", bFile, "--format", "all", "--out", out]);
    expect(r2.status).toBe(0);
    const dtsAfter = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 两份都在 ⇒ 没有互相覆盖
    expect(dtsAfter).toHaveLength(2);
    // 先导出的那份内容不变（仍是 a 模块的声明）
    expect(readFileSync(join(out, dtsFiles[0]!), "utf-8")).toBe(firstBody);
    // 另一份是 b 模块的声明
    const other = dtsAfter.find((f) => f !== dtsFiles[0]!)!;
    expect(readFileSync(join(out, other), "utf-8")).toContain("betaOnly");
  }, 90000); // 2 个顺序 CLI 子进程（tsx 冷启动）

  it("同 stem 模块 ⇒ zod / guard 面同样不互相覆盖", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622b-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    runCli(["export", aFile, "--format", "all", "--out", out]);
    const guardFirst = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardFirst).toHaveLength(1);
    const body = readFileSync(join(out, guardFirst[0]!), "utf-8");

    runCli(["export", bFile, "--format", "all", "--out", out]);
    const guardAfter = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardAfter).toHaveLength(2);
    expect(readFileSync(join(out, guardFirst[0]!), "utf-8")).toBe(body);
  }, 90000); // 2 个顺序 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// nudo export --out · 同名函数的产物不互相覆盖
// ---------------------------------------------------------------------------
describe("nudo export --out · 同名函数的产物不互相覆盖", () => {
/**
 * 产物面把「函数名 → 校验器」建成**以函数名为键**的映射 ⇒ 同名
 * 函数后者覆盖前者；standard 面则把**同一个文件写两次**（后者静默覆盖前者，
 * CLI 零告警）。
 *
 * 钉（写盘面）：同一个类里两个同名方法 ⇒ standard 产物**两份都在**
 * （`C.m.nudo.standard.ts` + `C.m.2.nudo.standard.ts`），先写的那份不被覆盖。
 */






const DUP = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(a) { return a + 1; }
  /**
   * @nudo:case "m2" (3) => 4
   */
  m(b) { return b + 2; }
}
`;

describe("nudo export --out · 同名函数的产物不互相覆盖", () => {
  it("同一文件里两个同名方法 ⇒ 两份 standard 产物都在", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-623-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, DUP, "utf-8");
    const out = join(dir, "out");

    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    // 两个同名方法 ⇒ 两份产物（不是同一个文件写两次）
    expect(files).toHaveLength(2);
    expect(files).toContain("C.m.nudo.standard.ts");
    // 两份内容不同（各带自己那条 case 的见证）
    const bodies = files.map((f) => readFileSync(join(out, f), "utf-8"));
    expect(bodies[0]).not.toBe(bodies[1]);
    // 两行 wrote ⇒ 两个不同路径（不是同一路径写两次）
    const wrote = r.stdout.split("\n").filter((l) => l.startsWith("wrote "));
    expect(wrote).toHaveLength(2);
    expect(new Set(wrote).size).toBe(2);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// nudo export --out · 写失败提示可执行
// ---------------------------------------------------------------------------
describe("nudo export --out · 写失败提示可执行", () => {
/**
 * `nudo export --out` 写失败的 `fix:` 提示硬编码成 **不存在的**
 * `check --out` ⇒ 用户照做只会再吃一个 `unknown option '--out'`。
 *
 * 钉：写失败的提示指向**本命令**且可执行（不含 `check --out`）。
 */






describe("nudo export --out · 写失败提示可执行", () => {
  it("--out 指向已有文件 ⇒ 提示不再指向不存在的 check --out", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const notDir = join(dir, "notadir");
    writeFileSync(notDir, "not a directory\n", "utf-8");

    const r = runCli(["export", file, "--format", "dts", "--out", notDir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out mkdir failed");
    expect(r.stderr).toContain("fix:");
    // 提示里不得出现不存在的 `check --out`
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("目标路径是目录 ⇒ 写失败提示点名该文件且指向本命令（EISDIR 走写失败通道）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624b-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    // 目标路径是目录 ⇒ readFileSync EISDIR。目录不可能被 writeFileSync
    // 覆盖（无绕过「拒绝覆盖」守卫的风险）⇒ 照常走写入，由**写失败通道**
    // 点名该文件并给可执行 fix:（与 的回放语义同一通道）。
    // （EACCES/EIO 等真读不出 ⇒ refuse 分支；refuse 文案由 
    // 「可读手写文件」钉住。）
    mkdirSync(join(out, "lib.d.ts"), { recursive: true });

    const r = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out write failed");
    expect(r.stderr).toContain("lib.d.ts");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }, 60000); // 1 个 CLI 子进程
});
});

// ---------------------------------------------------------------------------
// 族 63b-1: check --json
// ---------------------------------------------------------------------------
describe("族 63b-1: check --json", () => {
/**
 * 族 63b · nudojs `pathErrors[]` 口径一致性（**check / test / contract**）。
 *
 * **根因**：`pathErrors[]` 这个名字原本只承诺「`--from` 路径错误」，但 C1 把
 * 「**分析目标闸门**」错误（路径不存在 / 空目录 / 非分析目标）也推进了**同一个**
 * sink ⇒ 数组名不再副实 ⇒ **机器消费者**读 `pathErrors[]` 时会误以为里面
 * 全是 `--from` 路径问题。
 *
 * **口径**（与 health 面（W16）**同款**，三个动词统一）：
 * - `pathErrors[]`：**有序全集**，**字段名 + 内容 + 顺序逐字不变**
 * （既有机器消费者零影响）；
 * - `targetErrors[]`：**新增的可选** JSON 字段 = **分析目标闸门**错误的
 * **精确**子集
 * - `--from` 路径错误**不**进它（它是**精确入口**，不是副本）；
 * - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）；
 * - **无**闸门错误 ⇒ `targetErrors[]` **不出现**（既有场景 stdout 逐字不变）。
 *
 * **钉法**（真跑 CLI，`runCliTsx`）：
 * - 闸门错误场景：`pathErrors[]` 与**改前**逐字一致（名字 / 条数 / 码 /
 * `suggestion` / 顺序）+ `targetErrors[]` **精确**只装闸门错误；
 * - `--from` 路径错误：**不**进 `targetErrors[]`；
 * - 无闸门错误：`targetErrors[]` 不出现 + stdout 与**改前基线逐字一致**
 * （负控；基线 = 改前实跑抓的常量）。
 */







// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

/** 干净的分析目标（负控 / `--from` 场景的被检查文件） */
const CLEAN_SRC = `export function id(x) {
  return x;
}
`;

/** **非**分析目标（`.d.ts` 声明文件）⇒ 触发「分析目标闸门」错误 */
const DECL_SRC = `export declare function g(x: number): number;
`;

let dir: string;
const p = (f: string): string => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-63b-"));
  writeFileSync(p("clean.js"), CLEAN_SRC);
  writeFileSync(p("types.d.ts"), DECL_SRC);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** fixture 目录绝对路径 → `<DIR>`（跨机器稳定；同 cli-e2e-golden 的 normalize） */
function normalize(text: string): string {
  const real = realpathSync(dir);
  return text.split(real).join("<DIR>").split(dir).join("<DIR>");
}

/** `--json` 面的路径错误条目形状 */
type PathErr = { path: string; code: string; message: string; suggestion?: string };

/**
 * 「分析目标闸门」错误条目（`nudo:path-not-target`）——**改前**的既有内容
 * （逐字钉住：`pathErrors[]` 的名字 / 条数 / 码 / `suggestion` / 顺序）。
 */
function gateEntry(abs: string): PathErr {
  return {
    path: abs,
    code: "nudo:path-not-target",
    message: `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${abs}`,
    suggestion:
      "pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)",
  };
}

/** `--from` 路径错误条目（`nudo:path-missing-callsite`） */
function fromEntry(abs: string): PathErr {
  return {
    path: abs,
    code: "nudo:path-missing-callsite",
    message: `Callsite file not found: ${abs}`,
    suggestion:
      "pass --from <file-or-dir> that exists; it supplies call@ records for generation",
  };
}

// ---------------------------------------------------------------------------
// 改前（HEAD 实跑抓的）逐字基线 —— 负控用
// ---------------------------------------------------------------------------

const CHECK_CLEAN_JSON_BEFORE = `{
  "version": 1,
  "file": "<DIR>/clean.js",
  "ok": true,
  "summary": {
    "errors": 0,
    "warnings": 0,
    "infos": 1,
    "functions": 1
  },
  "signatures": [
    {
      "name": "id",
      "params": [
        "x"
      ],
      "paramTypes": [
        "any"
      ],
      "display": "any",
      "detail": "id\\n  any\\n  term: A1\\n  conf: path",
      "conf": "path",
      "abs": "any  = A1  #path",
      "entry": true
    }
  ],
  "issues": [
    {
      "severity": "info",
      "code": "nudo:contract-entry-only",
      "message": "export 'id' has no contract root and no call-site domain (entry-only)",
      "line": 1,
      "column": 7
    }
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
  }
}
`;

const TEST_CLEAN_JSON_BEFORE = `{
  "version": 1,
  "file": "<DIR>/clean.js",
  "summary": {
    "functions": 1,
    "externalFunctions": 0,
    "cases": 1,
    "diagnostics": 1,
    "errors": 0
  },
  "functions": [
    {
      "name": "id",
      "loc": {
        "start": {
          "line": 1,
          "column": 7
        },
        "end": {
          "line": 3,
          "column": 1
        }
      },
      "entryOnly": true,
      "cases": [
        {
          "name": "entry@L1",
          "args": [
            "any"
          ],
          "result": "any",
          "throws": null,
          "source": null,
          "argsAbs": [
            "any  #path"
          ],
          "resultAbs": "any  #path",
          "intension": {
            "display": "id: (x: A1) => A1",
            "abs": "any  #path",
            "absMultiline": "id\\n  any\\n  conf: path",
            "term": "A1",
            "conf": "path"
          }
        }
      ],
      "combined": "any",
      "combinedAbs": "any  #path"
    }
  ],
  "diagnostics": [
    {
      "range": {
        "start": {
          "line": 1,
          "column": 7
        },
        "end": {
          "line": 1,
          "column": 7
        }
      },
      "severity": "info",
      "message": "export 'id' has no contract root and no call-site domain (entry-only)",
      "code": "nudo:contract-entry-only"
    }
  ],
  "assertions": {
    "passed": 0,
    "failed": 0,
    "unchecked": 0
  },
  "ok": true
}
`;

const CONTRACT_CLEAN_JSON_BEFORE = `[
  {
    "file": "clean.js",
    "entries": [
      {
        "fn": "id",
        "signature": "  id  [implicit]  (x: any) → any"
      }
    ]
  }
]
`;

const GATE_TEXT_BEFORE = `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): <DIR>/types.d.ts
fix:  pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)
`;


// ---------------------------------------------------------------------------
// 1. check —— pathErrors[] 逐字不变 + targetErrors[] 精确可见
// ---------------------------------------------------------------------------

describe("族 63b-1: check --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.ok).toBe(false);

    // 既有字段**逐字不变**：名字 / 条数 / 码 / suggestion / 顺序
    expect(Object.keys(parsed)).toContain("pathErrors");
    expect(parsed.pathErrors).toEqual([gateEntry(p("types.d.ts"))]);

    // 新增字段：**精确**子集（逐字同形，不是一份副本）
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toHaveLength(1);
  });

  it("--from 路径错误**不**进 targetErrors[]（它是精确入口，不是副本）", { timeout: 60_000 }, () => {
    const r = runCliTsx(
      ["check", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    // `--from` 路径错误照旧在 pathErrors[]（既有消费者零影响）
    expect(parsed.pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    // 但它**不是**分析目标闸门错误 ⇒ 新字段不得把它收进去
    expect(parsed.targetErrors).toBeUndefined();
  });

  it("闸门错误 + `--from` 错误并存：pathErrors[] 全集（顺序不变）+ targetErrors[] 只装闸门", { timeout: 60_000 }, () => {
    const r = runCliTsx(
      ["check", "--json", p("types.d.ts"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    // 全集：闸门在前、`--from` 在后（顺序逐字不变）
    expect(parsed.pathErrors).toEqual([
      gateEntry(p("types.d.ts")),
      fromEntry(p("no-such-from.js")),
    ]);
    // 精确子集：只有闸门那一条
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(
      parsed.targetErrors?.some((e) => e.code === "nudo:path-missing-callsite"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. test —— 同一套口径
// ---------------------------------------------------------------------------

describe("族 63b-2: test --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.pathErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toHaveLength(1);
  });

  it("--from 路径错误**不**进 targetErrors[]", { timeout: 60_000 }, () => {
    const r = runCliTsx(
      ["test", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    expect(parsed.targetErrors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. contract —— 同一套口径
// ---------------------------------------------------------------------------

describe("族 63b-3: contract --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["contract", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as Array<{
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    }>;
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(errDocs[0].targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(errDocs[0].targetErrors).toHaveLength(1);
  });

  it("--from 路径错误**不**进 targetErrors[]", { timeout: 60_000 }, () => {
    const r = runCliTsx(
      ["contract", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as Array<{
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    }>;
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    expect(errDocs[0].targetErrors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. 负控：无闸门错误 ⇒ targetErrors[] 不出现 + stdout 逐字不变
// ---------------------------------------------------------------------------

describe("族 63b 负控: 无闸门错误时输出逐字不变（既有场景零影响）", () => {
  it("check --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CHECK_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("test --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(TEST_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("contract --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["contract", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CONTRACT_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("人类面（闸门错误）：stderr 文案与改前逐字一致（机器面改动不外溢）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(normalize(r.stderr)).toBe(GATE_TEXT_BEFORE);
  });
});
});

// ---------------------------------------------------------------------------
// test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors
// ---------------------------------------------------------------------------
describe("test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors", () => {
/**
 * `nudo test` 遇解析失败 ⇒ **裸 message、无文件名**；`--json` 面
 * stdout **0 字节**（而 `nudo check` 对同一文件有 tsc 风格块 +
 * `pathErrors[{code:"syntax-error"}]` 信封）。
 *
 * 旧行为：Babel 解析异常上浮到顶层 catch ⇒ stderr 只有一行
 * `Unexpected keyword 'return'. (2:2)`（**没有文件名**、没有行:列、没有
 * 源码摘录），`--json` 面的序列化点排在异常之后 ⇒ stdout 一个字节都没有
 * ⇒ 机器面 `JSON.parse(stdout)` 直接炸。
 *
 * 修复：`runTest` 复用 check 面的语法错分支（`check-report.ts` 的
 * `syntaxErrorInfo` / `formatSyntaxErrorBlock`）——人类面给 tsc 风格块
 * （路径 + 行:列 + 摘录 + `^` 指位），`--json` 面并入
 * `pathErrors[{code:"syntax-error"}]`（同一条 CaseJson 失败信封）。
 *
 * ⚠ 错误**文案随夹具变**（Babel 版本 / 夹具不同 ⇒ 措辞不同）⇒ 本钉只钉
 * **形状**（有文件名 / 有 `path:line:col` / `--json` 有 body + 机器码），
 * 不断言文案字面量。
 */






const SYNTAX_ERROR_SRC = `export function broken( {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-650-"));
  const file = join(cwd, "syn.js");
  writeFileSync(file, SYNTAX_ERROR_SRC, "utf-8");
  return { cwd, file };
}

describe("test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors", () => {
  it("人类面：文件名 + 行:列 + 摘录 + ^ 指位（不再是无路径的裸 message）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      // 形状：<file>:<line>:<col> — syntax error: <本质信息>
      expect(r.stderr).toMatch(/syn\.js:\d+:\d+ — syntax error: /);
      // 源码摘录 + 指位
      expect(r.stderr).toContain("return 1;");
      expect(r.stderr).toMatch(/\n\s*\^\s*$/m);
      // 旧症状：stderr 只有一个不带文件名的裸 message
      expect(r.stderr).not.toMatch(/^Unexpected .*$/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("--json 面：stdout 是 CaseJson 失败信封（pathErrors[{code:\"syntax-error\"}]）+ exit 1", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      // 旧症状：stdout 0 字节 ⇒ JSON.parse 炸
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.version).toBe(1);
      expect(Array.isArray(doc.pathErrors)).toBe(true);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("syntax-error");
      expect(doc.pathErrors[0].path).toContain("syn.js");
      // 形状：<line>:<col> — syntax error: <本质信息>
      expect(doc.pathErrors[0].message).toMatch(/^\d+:\d+ — syntax error: /);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("对照面：nudo check 对同一文件给同码 pathErrors（两个 verb 机器面同形）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      const doc = JSON.parse(r.stdout);
      const codes = (doc.pathErrors ?? []).map((e: { code: string }) => e.code);
      expect(codes).toContain("syntax-error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// --exit-on-diff 的前置校验不得嵌在 --freeze 分支内
// ---------------------------------------------------------------------------
describe("--exit-on-diff 的前置校验不得嵌在 --freeze 分支内", () => {
/**
 * `nudo test --exit-on-diff`（**无 `--freeze`**）被**静默忽略**、
 * exit 0 ⇒ CI 门禁形同虚设（用户以为「有 diff 就红」）。
 *
 * 根因：旗标校验被**嵌在 `if (opts.freeze !== undefined)` 块内** ⇒
 * `--exit-on-diff` 的前置条件（需 `--freeze` / `--dry-run`）只在有
 * `--freeze` 时才被检查；无 `--freeze` 时整段被跳过。
 *
 * 修复：前置校验**移到分支外** ⇒ 无 `--freeze` 时也报**用法错误**
 * （与 `nudo contract --exit-on-diff` 的口径对齐）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-653-"));
  const file = join(cwd, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

describe("-exit-on-diff 的前置校验不得嵌在 --freeze 分支内", () => {
  it("无 --freeze：报用法错误 + exit 1（旧行为：静默忽略 + exit 0）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
      // 旧症状：旗标被吞掉 ⇒ 一句提示都没有
      expect(r.stderr.trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("有 --freeze 无 --dry-run：仍是既有的「requires --dry-run」用法错误", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff requires --dry-run");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("合法组合 --freeze --dry-run --exit-on-diff：照常跑（不误伤）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze", "--dry-run"], { cwd });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("--exit-on-diff requires");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// contract --json 的路径错误必须进 JSON body
// ---------------------------------------------------------------------------
describe("contract --json 的路径错误必须进 JSON body", () => {
/**
 * `nudo contract --json`（**非** `--draft` 形态）把**路径错误整个吞掉**
 * ⇒ exit 1 但 stdout 的 JSON 里**没有** `pathErrors`、stderr 0 字节
 * ⇒ 「置红的那个原因没有任何地方说得出来」。
 *
 * 修法（族 20 · 片 A）：`--json` 形态下**路径错误必须进 JSON body**
 * （`pathErrors[]`）⇒ print / emit / draft **三形态统一**。
 *
 * ⚠ 勘误（族 21 已修 print 分支 ⇒ stdout **现在就是**合法 JSON）：
 * 验收用例**不**断言「stdout 不是 JSON」，只断言「JSON 里有 `pathErrors[]`」
 * +「stderr **可**为空」+「exit **仍** 1」。
 */






let dir: string;
let lib: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  entries?: { fn: string }[];
  pathErrors?: { path: string; code: string; message: string; suggestion?: string }[];
};

describe("contract --json 的路径错误必须进 JSON body", () => {
  it("print 形态 + 缺失路径：stdout 是合法 JSON 且带 pathErrors[] + exit 1", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**一份**合法 JSON（恒定数组外壳）
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    // 路径错误独立成一项（命令级事实，不是某个 root 的）
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
    expect(errDocs[0].pathErrors?.[0]?.path).toContain("nope.js");
    expect(errDocs[0].pathErrors?.[0]?.message).toContain("Not found");
    // 好文件的文档仍在载荷里（不被路径错误挤掉）
    expect(docs.some((d) => d.file === "lib.js")).toBe(true);
  });

  it("draft 形态 + 缺失路径：同一套 pathErrors[]（三形态统一）", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  });

  it("全部路径都缺失（无 root）：stdout 仍是**非空**合法 JSON + pathErrors[] + exit 1", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  });

  it("对照面：非 --json 的人类面仍在 stderr（不因 --json 消失）", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found:");
    expect(r.stderr).toContain("fix:");
  });
});
});

// ---------------------------------------------------------------------------
// contract --draft --write 不得把 `..data/` 判成越出项目根
// ---------------------------------------------------------------------------
describe("contract --draft --write 不得把 `..data/` 判成越出项目根", () => {
/**
 * `nudo contract --write` 的**项目根边界**用 `rel.startsWith("..")`
 * 判逃逸 ⇒ 项目根下的**合法目录** `..data/` 被判「在项目根之外」⇒ 草稿
 * **拒写**（exit 1）—— 而同一文件在项目根下**正常写出**。
 *
 * 根因：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 路径分隔符开头」，**不是**裸
 * `startsWith("..")`：后者把 `..data/` / `...cfg/` 这类**合法**相对路径
 * （目录名以 `..` 开头）误判成父目录逃逸。
 *
 * 修法（族 20 · 片 B · **CLI 半**）：判据改成
 * `rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`
 * —— 与 service 半（`packages/service/src/emit/contract-draft.ts` 的
 * `writeContractDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里 ⇒ 绝不往仓里写文件。
 * ⚠ 两层钉：
 * ① **进程内**直调 `runContractDraft`（`@nudojs/service/emit` 在测试里
 * 走 **src** 别名 ⇒ CLI 半 + service 半**两端都是源码**）⇒ 端到端写盘；
 * ② **CLI 级**（子进程）：断言 CLI 半**不再**用那句 CLI 专属的拒写文案。
 */







let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 进程内跑一次 `runContractDraft`，收走 console 与 exit code（不污染测试进程）。 */
async function runDraftInProcess(
  file: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | string | null | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const prevExitCode = process.exitCode;
  console.log = (...args: unknown[]): void => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    err.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  let exitCode: number | string | null | undefined;
  try {
    await runContractDraft(file, { fnNames: [], write: true, dryRun: false });
    exitCode = process.exitCode;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = prevExitCode;
  }
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}

describe("contract --draft --write 不得把 `..data/` 判成越出项目根", () => {
  it("进程内：CLI 半 + service 半（都走 src）⇒ `..data/f.js` 的草稿**写出来了**", async () => {
    const file = join(dir, "..data", "f.js");

    const r = await runDraftInProcess(file);

    // 改前：CLI 半就拒了（`is outside project root …; draft write refused`）
    expect(r.stderr).not.toContain("outside project root");
    expect(r.exitCode).not.toBe(1);
    expect(r.stdout).toContain("Draft written →");
    expect(existsSync(join(dir, "..data", "f.nudo.draft.js"))).toBe(true);
  }, 60000); // 进程内分析（不走子进程）

  it("CLI 级：CLI 半**不再**用那句「is outside project root」拒写文案", () => {
    const r = runCli(["contract", "--draft", "--write", "..data/f.js"], { cwd: dir });

    // 改前：stderr = "Error: '…/..data/f.js' is outside project root '…'; draft write refused"
    // （service 半的拒写文案是「draft write refused: outside project root」，
    // 两者**不同** ⇒ 这条断言精确地钉住 **CLI 半**。）
    expect(r.stderr).not.toContain("is outside project root");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("负控制：同一项目根下的普通文件照常写出（不误伤）", () => {
    const r = runCli(["contract", "--draft", "--write", "normal.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Draft written → normal.nudo.draft.js");
    expect(existsSync(join(dir, "normal.nudo.draft.js"))).toBe(true);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
});

// ---------------------------------------------------------------------------
// migrate status 审计全部路径（回归钉）
// ---------------------------------------------------------------------------
describe("migrate status 审计全部路径（回归钉）", () => {
/**
 * `nudo migrate status` 静默忽略第一个之后的全部路径。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（`packages/nudojs/src/commands/
 * migrate.ts` 的 status 分支改为**全量审计**）⇒ 本文件是**回归钉**（防止
 * 回退到「只报 targets[0]」），不是重复修复。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本（`git show
 * e5b3f388^:packages/nudojs/src/commands/migrate.ts`）⇒ 「两个包都被审计」
 * 断言**必红**（旧实现只报 pkg-a）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-668-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts: { typecheck: "tsc --noEmit" } }),
    "utf-8",
  );
  return dir;
}

describe("migrate status 审计全部路径（回归钉）", () => {
  it("migrate status <a> <b> ⇒ 两个包都被审计（不得只报第一个）", () => {
    const a = pkgDir("status-a");
    const b = pkgDir("status-b");
    const r = runCliTsx(["migrate", "status", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
    expect(r.stdout).toContain(b);
  });

  it("migrate status --json <a> <b> ⇒ 顶层数组含两个 root", () => {
    const a = pkgDir("status-json-a");
    const b = pkgDir("status-json-b");
    const r = runCliTsx(["migrate", "status", "--json", a, b]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    // migrate status 的 root 是**相对 cwd** 的路径（CLI 的 cwd = repoRoot）
    expect(parsed.map((row) => row.root)).toEqual([relative(repoRoot, a), relative(repoRoot, b)]);
  });

  it("单路径时行为不变（不得因多路径支持而破坏单路径）", () => {
    const a = pkgDir("status-single");
    const r = runCliTsx(["migrate", "status", a]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
  });
});
});

// ---------------------------------------------------------------------------
// 目录扫描跟随符号链接
// ---------------------------------------------------------------------------
describe("目录扫描跟随符号链接", () => {
/**
 * 目录目标的文件收集**静默跳过符号链接**。
 *
 * 旧实现用 `entry.isDirectory()` / `entry.isFile()` 判定 dirent ⇒ 符号链接
 * 条目两者皆 false（既非 dir 也非 file）⇒ 被**静默丢弃**（既不分析、也不报
 * 路径错误）⇒ `check <dir>` 对链接进来的坏文件**假绿**（exit 0），同一文件
 * 直传却 FAILED（exit 1）。
 *
 * 修法：`collectNudoFiles` 跟随符号链接判定（`statSync`），目录链接按
 * realpath 防环。
 */







/** L2 entry-may-throw：解引用 unconstrained 参数 */
const BAD_SRC = `export function getName(obj) {
  return obj.name;
}
`;
const GOOD_SRC = `export function one() {
  return 1;
}
`;

describe("目录扫描跟随符号链接", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：base/l2.js（坏）+ base/symdir/{good.js, badlink.js -> ../l2.js} */
  function makeFixture(): string {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-"));
    dirs.push(base);
    const scanDir = join(base, "symdir");
    mkdirSync(scanDir, { recursive: true });
    writeFileSync(join(base, "l2.js"), BAD_SRC, "utf-8");
    writeFileSync(join(scanDir, "good.js"), GOOD_SRC, "utf-8");
    symlinkSync(join(base, "l2.js"), join(scanDir, "badlink.js"));
    return scanDir;
  }

  it("collectNudoFiles 收进链接进来的 .js（改前：静默跳过）", () => {
    const scanDir = makeFixture();
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["badlink.js", "good.js"]);
  });

  it("符号链接目录被递归进入（改前：整棵链接目录被跳过）", () => {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-dir-"));
    dirs.push(base);
    const real = join(base, "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "inside.js"), GOOD_SRC, "utf-8");
    const scanDir = join(base, "scan");
    mkdirSync(scanDir, { recursive: true });
    symlinkSync(real, join(scanDir, "linked-dir"));
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["inside.js"]);
  });

  it("CLI check <dir>：链接进来的坏文件参与门禁（改前：exit 0 假绿）", () => {
    const scanDir = makeFixture();
    const r = runCliTsx(["check", scanDir]);
    expect(r.stdout).toContain("badlink.js");
    expect(r.status).toBe(1);
  });

  it("同一文件直传与目录扫描结论一致（不再一个绿一个红）", () => {
    const scanDir = makeFixture();
    const direct = runCliTsx(["check", join(scanDir, "badlink.js")]);
    const viaDir = runCliTsx(["check", scanDir]);
    expect(direct.status).toBe(1);
    expect(viaDir.status).toBe(direct.status);
    // 目录扫描必须**看见**同一个文件（改前：链接被静默跳过，目录面看不见它）
    expect(viaDir.stdout).toContain("badlink.js");
    expect(viaDir.stdout).toContain("nudo:entry-may-throw");
  });
});
});

// ---------------------------------------------------------------------------
// strip 产物必须是 Node 能解析的纯 JS
// ---------------------------------------------------------------------------
describe("strip 产物必须是 Node 能解析的纯 JS", () => {
/**
 * `nudo migrate strip --write` 写出的 `.js` **Node 无法解析**
 * （`private` / `public` / `readonly` 未剥离；参数属性
 * `constructor(private opening: number)` 也原样保留）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（经 `packages/nudojs/src/migrate.ts` 的
 * `stripTsToJs` 调用）—— 族 21 收口时由主 agent 接线修好：
 * ① 类成员修饰符（`private` / `public` / `protected` / `readonly` / `abstract` /
 * `override` / `declare`）剥掉；② 构造器参数属性降级成
 * 「普通形参 + 构造器体开头的 `this.x = x`」。
 *
 * 命令层（`packages/nudojs/src/commands/migrate.ts`）另有一道**兜底闸门**：
 * 写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错
 * （migrate 是一程闸门，写坏了没有回退路径）。真源修好后常规路径不再触发它，
 * 它只作为真源漏网时的兜底存在。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CLASS_TS = `export class Account {
  private balance: number = 0;
  public readonly owner: string = "ada";
  constructor(private opening: number) { this.balance = opening; }
}
`;

function dirWith(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-672-"));
  dirs.push(dir);
  writeFileSync(join(dir, name), content, "utf-8");
  return dir;
}

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("strip 产物必须是 Node 能解析的纯 JS", () => {
  it("产物必须落盘且能被 `node --check` 解析（成员修饰符已剥、参数属性已降级）", () => {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    const product = join(dir, "cls.js");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(product)).toBe(true);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
    const code = readFileSync(product, "utf-8");
    // 成员修饰符不得残留
    expect(code).not.toContain("private");
    expect(code).not.toContain("public");
    expect(code).not.toContain("readonly");
    // 参数属性降级：形参变普通形参 + 构造器体补上字段赋值
    expect(code).toContain("this.opening = opening");
    expect(code).not.toContain("constructor(private");
  });

  it("命令层闸门是**兜底**：真源修好后常规路径不再触发它（不得误拦合法产物）", () => {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    // 闸门仍在（真源漏网时拒写盘 + 点名文件 + exit 1），但真源已修 ⇒ 不该拦
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    expect(existsSync(join(dir, "cls.js"))).toBe(true);
  });

  it("对照：纯类型注解的 TS 源照常 strip（闸门不得过度拦截）", () => {
    const dir = dirWith("ok.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "ok.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "ok.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain(": number");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// --what-if 等号 / 冒号两种写法等价
// ---------------------------------------------------------------------------
describe("--what-if 等号 / 冒号两种写法等价", () => {
/**
 * `--what-if` 只认冒号 ⇒ 文档给的可复制命令（等号形态）原样跑不通。
 *
 * 症状：整串被当成绑定名 ⇒ 「Bindings not applied」+ exit 0（假设静默不生效，
 * 用户以为假设生效了）。修复：解析器**两种分隔符都认**（`:` 与 `=`），
 * 文档保持等号形态（ai-native-dx.md / reference/agents.md 的命令示例不变）。
 */







const SRC = `const raw = 1;

export function len() {
  return raw;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-673-whatif-"));
  const file = join(dir, "c.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("-what-if 等号 / 冒号两种写法等价", () => {
  it("解析器：等号形态切出 name/type（不是整串当绑定名）", () => {
    expect(parseWhatIfBindings(["raw=string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  });

  it("解析器：冒号形态不变（旧口径不回归）", () => {
    expect(parseWhatIfBindings(["raw:string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  });

  it("解析器：分隔符取最先出现的那个；无分隔符仍是 name=整串 / type=any", () => {
    expect(parseWhatIfBindings(["a=b:c"])).toEqual([{ name: "a", type: "b:c" }]);
    expect(parseWhatIfBindings(["m:a:b"])).toEqual([{ name: "m", type: "a:b" }]);
    expect(parseWhatIfBindings(["plain"])).toEqual([{ name: "plain", type: "any" }]);
  });

  it("CLI：等号形态的假设真的生效（绑定被应用，类型按假设打印）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--what-if", "raw=string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
      // 旧症状：整串被当成绑定名 ⇒ 「not applied」
      expect(r.stdout).not.toContain("Bindings not applied");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：冒号形态仍然生效（两种写法同结果）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--what-if", "raw:string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// migrate retire --all --json 顶层形状恒定（回归钉）
// ---------------------------------------------------------------------------
describe("migrate retire --all --json 顶层形状恒定（回归钉）", () => {
/**
 * `migrate retire --all --json` 的**顶层 JSON 形状随结果条数变化**
 * （1 个包 = 对象，≥2 个包 = 数组）⇒ 机器可读契约不稳定。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（顶层恒为数组）⇒ 本文件是
 * **回归钉**（防止回退到「单元素退化为对象」的糖）。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本 ⇒ 「1 个包时顶层
 * 仍是数组」断言**必红**（旧实现顶层是对象，`Array.isArray` 为 false）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** pnpm workspace：root + n 个可退役包 */
function workspace(pkgCount: number): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-675-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  for (let i = 0; i < pkgCount; i++) {
    const dir = join(root, "packages", `p${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: `p${i}`,
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "tsc --noEmit" },
      }),
      "utf-8",
    );
  }
  return root;
}

describe("migrate retire --all --json 顶层形状恒定（回归钉）", () => {
  it("1 个可退役包 ⇒ 顶层仍是数组（不得退化为对象）", () => {
    const root = workspace(1);
    const r = runCliTsx(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("2 个可退役包 ⇒ 顶层同样是数组（形状不随条数漂移）", () => {
    const root = workspace(2);
    const r = runCliTsx(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("两个场景的顶层形状一致（都是数组）", () => {
    const one = runCliTsx([
      "migrate",
      "retire",
      workspace(1),
      "--all",
      "--dry-run",
      "--json",
    ]);
    const two = runCliTsx([
      "migrate",
      "retire",
      workspace(2),
      "--all",
      "--dry-run",
      "--json",
    ]);
    expect(one.status, one.stderr).toBe(0);
    expect(two.status, two.stderr).toBe(0);
    expect(Array.isArray(JSON.parse(one.stdout))).toBe(Array.isArray(JSON.parse(two.stdout)));
  });
});
});

// ---------------------------------------------------------------------------
// TS enum 被合成成运行时对象（产物面 + 门禁行为）
// ---------------------------------------------------------------------------
describe("TS enum 被合成成运行时对象（产物面 + 门禁行为）", () => {
/**
 * TS 的 `enum` 被整段删除 ⇒ 成员引用退化成**未绑定全局**读取 ⇒
 * 门禁报 error 级 `nudo:entry-may-throw`（**假红**）+ dts / zod / standard /
 * guard 四个产物面把返回类型落成 `never`。
 *
 * **真源**：`packages/core/src/strip-types.ts`（把 TS enum **合成成运行时
 * 对象**，逐形态对齐 tsc 的 emit）。本钉是**产物面**的回归钉：
 * ① 产物必须是可加载的运行时对象（不是空模块）；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**都绿**，签名都是 `f() => 1`
 * （不再是 `never` + ReferenceError 的假红）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENUM_TS = `export enum E { A = 1 }
export function f() {
  return E.A;
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 真 ESM 加载并读 enum 成员（运行时语义面） */
function esmReadEnum(path: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(`file://${path}`)}).then(m=>console.log("VALUE:", m.E.A)).catch(e=>{console.log("LOAD ERROR:", e.constructor.name+":", e.message); process.exitCode=1;});`,
    ],
    { encoding: "utf-8" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("TS enum 被合成成运行时对象（产物面 + 门禁行为）", () => {
  it("产物含运行时 enum 对象 ⇒ `node --check` 过且 `E.A === 1`", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "enum.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // enum 不得被整段删除：绑定 `E` 必须**有声明**（只剩引用 `E.A` ⇒ 运行时
    // 未绑定全局读取 ⇒ ReferenceError）
    expect(code).toMatch(/\b(var|const|let)\s+E\b/);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);

    // 运行时语义面：enum 成员必须取得到值（tsc 同口径：E.A === 1）
    const load = esmReadEnum(product);
    expect(load.status, `${load.stdout}\n${load.stderr}`).toBe(0);
    expect(load.stdout).toContain("VALUE: 1");
  });

  it("门禁行为正确：`.ts` 源与 `.js` 产物都绿，签名是 `f() => 1`（不再是 never）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["enum.ts", "enum.js"]) {
      const c = runCliTsx(["check", join(dir, name)]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(0);
      expect(c.stdout).toContain("f() => 1");
      expect(c.stdout).not.toContain("never");
      expect(c.stdout).not.toContain("ReferenceError");
    }
  });
});
});

// ---------------------------------------------------------------------------
// 断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）
// ---------------------------------------------------------------------------
describe("断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）", () => {
/**
 * `nudo test` 的断言判定**没有「推导失败」第三态**。
 *
 * 根因（`packages/nudojs/src/run-test.ts` 的报告面）：断言判定是**二值**的
 * ——实测侧 `unknown`（**引擎没推出来**）被压成「断言不符」（假红），
 * 而 `any()` 期望又借 core `leqAbs` 的「目标放宽 ⇒ 通过」捷径**空洞通过**
 * （假绿）⇒ **同一事实两种期望都不可用**；且与 check 面把同一状态判成
 * INFO（`nudo:opaque-result`、exit 0）**严重度相反**。
 *
 * 修法：报告面引入**第三态**——实测侧是 `unknown` / `conf === "opaque"`
 * （推导失败）⇒ 记 **unchecked（无法判定）**：不是失败、不置红（exit 0）、
 * 也不是空洞通过；诊断文本区分「实测与期望不符」（真失败）与
 * 「引擎未能推断实测值」（工具的局限，指向 `nudo:opaque-result` 的补证据路径）。
 *
 * 钉（CLI 报告面）：
 * - 推导失败 + 期望 `number()` ⇒ **unchecked**（不是 FAIL）+ exit 0；
 * - 推导失败 + 期望 `any()` ⇒ 同样 **unchecked**（不是空洞 ok）+ exit 0；
 * - 诊断文本区分：含「无法判定」口径 + 指向 `nudo:opaque-result`；
 * - `--json` 面：assertions = {passed: 0, failed: 0, unchecked: 1}；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 **FAIL / exit 1**（既有行为不变）。
 *
 * ⚠ 本钉只钉**报告面**（两个报告面的第三态是同一条口径，见 service 面的
 * 平行钉 `packages/service/src/__tests__/service--test-report-third-state.part.ts`）。
 */






/**
 * 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持
 * ⇒ 实测落到 `unknown`）——与 check 面的 `nudo:opaque-result` 同一事实。
 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

/** 推导成功（负控制）：实测是 `2`，期望 `string()` ⇒ 真失败。 */
const INFERRED_BODY = `export function g(x) { return x + 1; }
`;

type Fixture = { cwd: string; file: string };

/** 写一个临时项目（ESM）+ 一个带声明期望的 case 文件。 */
function makeProject(expectation: string, body: string): Fixture {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-950-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b950", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  const file = join(cwd, "t.js");
  writeFileSync(
    file,
    `/**
 * @nudo:case "w" (1) => ${expectation}
 */
${body}`,
    "utf-8",
  );
  return { cwd, file };
}

describe("断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）", () => {
  it("推导失败 + 期望 number() ⇒ unchecked + exit 0（改前：FAIL + exit 1）", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[FAIL]");
      expect(r.stdout).toContain("[unchecked]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("推导失败 + 期望 any() ⇒ 同样 unchecked（改前：空洞 ok「1 passed」）", () => {
    const { cwd, file } = makeProject("any()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[ok]");
      expect(r.stdout).not.toContain("1 passed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("诊断文本区分「无法判定」与「类型不匹配」，并指向 nudo:opaque-result 的补证据路径", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      // 报告面：说「引擎没推出来」，不是「类型不匹配」
      expect(r.stdout).toContain("cannot judge");
      expect(r.stdout).toContain("the engine could not infer the actual value");
      expect(r.stdout).toContain("not a type mismatch");
      // 补证据路径 = check 面同事实的 INFO（nudo:opaque-result）
      expect(r.stdout).toContain("nudo:opaque-result");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("--json 面：assertions = {passed: 0, failed: 0, unchecked: 1}", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("负控制：推导成功 + 期望不符 ⇒ 仍是 FAIL / exit 1（既有行为不变）", () => {
    const { cwd, file } = makeProject("string()", INFERRED_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("1 failed");
      expect(r.stdout).toContain("0 unchecked");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);
});
});

// ---------------------------------------------------------------------------
// test --json 的用法错误也必须有机器可读 body
// ---------------------------------------------------------------------------
describe("test --json 的用法错误也必须有机器可读 body", () => {
/**
 * `nudo test --json` 的**用法错误**路径产出「**空 stdout + 非零
 * exit**」⇒ 违反「`--json` 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」的机器面契约；而**同一动词**的路径失败路径**有**合法
 * `pathErrors[]` 信封 ⇒ 机器面自相矛盾。
 *
 * 根因：全部用法错误分支都排在 CaseJson 序列化点**之前**，且沿用「写
 * stderr + exit 1 + return」的人类面约定 ⇒ `--json` 下机器面根本没有机会
 * 产出。
 *
 * 修复：用法错误在 `--json` 下也走**同一条** CaseJson 失败信封
 * （`pathErrors[{code:"nudo:usage-error"}]` + exit 1）；非 `--json` 面的人读
 * 文案**不变**。
 *
 * ⚠ 码：用法错误码本地定义在 `commands/test.ts`（不改 `shared.ts` 的
 * `PathError["code"]` 联合）——：该码原为 `"usage-error"`，与
 * `check` / `contract` 的 `"nudo:usage-error"` **分叉** ⇒ 同一类错误在三个
 * 动词产出不同的机器码 ⇒ 消费者要为 test 单独维护一张码表 ⇒ 已统一为
 * `"nudo:usage-error"`（`"syntax-error"` 保持不变）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-957-"));
  const file = join(cwd, "one.js");
  const other = join(cwd, "two.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd, file, other };
}

describe("test --json 的用法错误也必须有机器可读 body", () => {
  const cases: Array<{ name: string; args: (p: { file: string; other: string }) => string[] }> = [
    { name: "无路径", args: () => ["test", "--json"] },
    { name: "--json + --abs", args: (p) => ["test", p.file, "--json", "--abs"] },
    { name: "--json 多文件", args: (p) => ["test", p.file, p.other, "--json"] },
    { name: "--json + --freeze（旗标吞路径）", args: (p) => ["test", "--json", "--freeze", p.file] },
    { name: "--json + --from（变参吞路径）", args: (p) => ["test", "--json", "--from", p.file] },
    { name: "--json + --exit-on-diff（无 --freeze）", args: (p) => ["test", p.file, "--json", "--exit-on-diff"] },
  ];

  for (const c of cases) {
    it(`CLI：${c.name} ⇒ stdout 是 CaseJson 信封（pathErrors[{code:\"nudo:usage-error\"}]）+ exit 1`, () => {
      const p = makeProject();
      try {
        const r = runCli(c.args(p), { cwd: p.cwd });
        expect(r.status).toBe(1);
        // 旧症状：stdout 0 字节 ⇒ 机器面 JSON.parse 炸
        expect(r.stdout.trim().length, `stdout 为空：${r.stderr}`).toBeGreaterThan(0);
        const doc = JSON.parse(r.stdout);
        expect(doc.version).toBe(1);
        expect(Array.isArray(doc.pathErrors)).toBe(true);
        expect(doc.pathErrors.length).toBeGreaterThan(0);
        // 用法错误码与 check / contract 同码（`nudo:usage-error`）
        expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
        expect(doc.pathErrors[0].message.length).toBeGreaterThan(0);
        // 与路径错误信封同形（同一动词不再有两条失败通道）
        expect(Array.isArray(doc.functions)).toBe(true);
        expect(Array.isArray(doc.diagnostics)).toBe(true);
        expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 0 });
      } finally {
        rmSync(p.cwd, { recursive: true, force: true });
      }
    }, 30000);
  }

  it("CLI：非 --json 面的人读文案不变（stderr 一行 + stdout 空 + exit 1）", () => {
    const p = makeProject();
    try {
      const r = runCli(["test"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo test` needs at least one path.");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("CLI：非 --json 面的其它用法错误文案不变（--exit-on-diff 无 --freeze）", () => {
    const p = makeProject();
    try {
      const r = runCli(["test", p.file, "--exit-on-diff"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("CLI：路径错误信封（对照）仍是 pathErrors 机器码，两条通道同形", () => {
    const p = makeProject();
    try {
      const r = runCli(["test", join(p.cwd, "missing.js"), "--json"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("nudo:path-not-found");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);
});
});

// ---------------------------------------------------------------------------
// 文件级指令随被删语句消失（产物面 + 门禁行为）
// ---------------------------------------------------------------------------
describe("文件级指令随被删语句消失（产物面 + 门禁行为）", () => {
/**
 * 挂在「将被删除的语句」上的**文件级指令**被静默丢掉 ⇒ 产物
 * **失去契约绑定** ⇒ 门禁从**红变绿**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（数组分支剔除语句时把它的
 * `leadingComments` **转挂**到下一个幸存节点 + 「剥除前后指令条数比对」的
 * 兜底自检）。本钉是**产物面**的回归钉：
 * ① 指令必须在产物里**存活**；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**同样红**（源红 / 产物红 ⇒ 结论
 * 一致；产物绿才是假绿）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SHAPES_NUDO_JS = `export const positive = number().gt(0);
`;
const TYPES_JS = `export const Foo = 1;
`;
const LIB_TS = `/// @nudo:import { positive } from "./shapes.nudo.js"
import type { Foo } from "./types.js";

/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}

export function caller() {
  return inc(-1);
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("文件级指令随被删语句消失（产物面 + 门禁行为）", () => {
  it("挂在被删语句上的 `/// @nudo:import` 必须在产物里存活", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "lib.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // ★ 指令必须存活（否则契约整条失效 ⇒ 产物绿 = 假绿）
    expect(code).toContain("@nudo:import");
    expect(code).toContain("@nudo:contract x positive");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("门禁行为正确：源红 / 产物**同样红**（契约仍被绑定 ⇒ 不是假绿）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["lib.ts", "lib.js"]) {
      const c = runCliTsx(["check", join(dir, name), "--entry-throws", "off"]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(1);
      expect(c.stdout).toContain("nudo:constraint-violated");
    }
  });
});
});

// ---------------------------------------------------------------------------
// nudo test --from 模块解析失败不得静默放过
// ---------------------------------------------------------------------------
describe("nudo test --from 模块解析失败不得静默放过", () => {
/**
 * `nudo test --from <callsite>` 对**模块解析失败**
 * （import 不存在的模块 / 不存在的导出）**静默放过**：零提示、零 `call@`、
 * **exit 0 假绿**（而语法错 / 顶层抛错**有**报错）—— **的半修**
 * （只补了「求值抛错」这一档）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts`）：现场文件探针
 * `probeCallsiteFile` 补**第三档**「模块解析失败」——求值**成功**（lenient
 * 装载器给未解析的 import 补 stub，模块体继续跑完）但引擎的 `moduleIssues`
 * 报 `missing` / `missing-export` ⇒ **调用点已丢** ⇒ 判为「现场文件读失败」
 * （pathMissingCallsite 家族）⇒ 明确报错 + 非 0 退出。
 *
 * ⚠ 探针**不能**再挂在「0 条记录」分支上：模块解析失败时记录**非空**
 * （指向一个不存在的函数，下游被丢弃）⇒ 只挂 0 记录分支永远测不到第三档。
 *
 * 本文件锁：模块解析失败必须报错 + 非 0 退出；可读且模块可解析的邻近形态
 * （有调用 / 无调用）**不得**被这条修复波及（负控制）；的两档
 * （语法错 / 顶层抛错）**不得**被这条修复改口径（回归锁）。
 */






/** 被测文件：导出 add（entry-only） */
const TARGET_SRC = `export function add(a, b) {
  return a + b;
}
`;
/** 现场文件：import **不存在的模块** ⇒ 模块解析失败 */
const MISSING_MOD_SRC = `import { nope } from "./does-not-exist.js";
const r = nope(1);
`;
/** 现场文件：import **不存在的导出** ⇒ 模块解析失败 */
const MISSING_EXPORT_SRC = `import { missing } from "./target.js";
const r = missing(1);
`;
/** 现场文件：可解析可求值、模块可解析、有调用 */
const CALL_SRC = `import { add } from "./target.js";
const r = add(1, 2);
`;
/** 现场文件：可解析可求值、模块可解析、没有调用 */
const NO_CALL_SRC = `export function helper() {
  return 0;
}
`;
/** 现场文件：语法错（第一档） */
const SYNTAX_ERR_SRC = `import { add } from "./target.js";
const x = add(1, 2
`;
/** 现场文件：顶层抛错（第二档） */
const TOPLEVEL_THROW_SRC = `throw new Error("boom");
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1060-"));
  writeFileSync(join(dir, "package.json"), `{ "name": "nudo-1060", "private": true, "type": "module" }`, "utf-8");
  writeFileSync(join(dir, "target.js"), TARGET_SRC, "utf-8");
  writeFileSync(join(dir, "missing-mod.js"), MISSING_MOD_SRC, "utf-8");
  writeFileSync(join(dir, "missing-export.js"), MISSING_EXPORT_SRC, "utf-8");
  writeFileSync(join(dir, "call.js"), CALL_SRC, "utf-8");
  writeFileSync(join(dir, "nocall.js"), NO_CALL_SRC, "utf-8");
  writeFileSync(join(dir, "syntaxerr.js"), SYNTAX_ERR_SRC, "utf-8");
  writeFileSync(join(dir, "toplevel-throw.js"), TOPLEVEL_THROW_SRC, "utf-8");
  return dir;
}

describe("nudo test --from 模块解析失败不得静默放过", () => {
  it("import 不存在的模块 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-mod.js");
      expect(r.stderr).toContain("module resolution failed");
      // 报错要指名道姓：装不上的模块是谁
      expect(r.stderr).toContain("does-not-exist.js");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("import 不存在的导出 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-export.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-export.js");
      expect(r.stderr).toContain("module resolution failed");
      expect(r.stderr).toContain("missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 面：pathErrors 收录该失败 + exit 1（改前：pathErrors 为空 + exit 0）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "--json", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        pathErrors: { path: string; code: string; message: string }[];
      };
      expect(json.pathErrors).toHaveLength(1);
      expect(json.pathErrors[0]!.path).toContain("missing-mod.js");
      expect(json.pathErrors[0]!.code).toBe("nudo:path-missing-callsite");
      expect(json.pathErrors[0]!.message).toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件模块可解析且有调用 ⇒ call@ 而非 entry@ + exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "call.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
      expect(r.stdout).toContain("call@");
      expect(r.stdout).not.toContain("entry@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件模块可解析但没有调用 ⇒ 不报错 + exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "nocall.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归锁：语法错现场仍是 parse failed + exit 1（口径不得被第三档改写）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "syntaxerr.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("parse failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归锁：顶层抛错现场仍是 evaluation failed + exit 1（口径不得被第三档改写）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "toplevel-throw.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("evaluation failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip --json 的逐文件隔离与 path 量纲
// ---------------------------------------------------------------------------
describe("migrate strip --json 的逐文件隔离与 path 量纲", () => {
/**
 * `nudo migrate strip --json` 的 `pathErrors[].path` **混用两种量纲**
 * （目标**目录** vs 失败**文件**），且同目标内**成功文件的逐文件结果被整条丢弃**。
 *
 * 症状（目标目录里混一个语法错文件：`a-good.ts` + `z-bad.ts`）：
 * 1. 库面（`packages/nudojs/src/migrate.ts`，族 56b）已按**逐文件隔离**改好 ——
 * `migrateStrip` 返回「成功行 + 失败行」，失败行自带 `file`；但 CLI 命中
 * `plan.find(r => r.code !== undefined)` 后直接 `continue` ⇒ 该目标**所有**
 * 成功行一并丢掉 ⇒ 机器消费者拿不到「哪些文件本来可以迁移」。
 * 2. 失败条目的 `path` 填的是**目标目录**而不是失败文件，而同一数组里
 * TS-only 闸门失败填的是**文件**（`path: l.file`）⇒ `path` 量纲不一致；
 * 消费者要定位坏文件只能去解析 message 里的文件名字符串。
 *
 * 修复：失败条目的 `path` 改用库面失败行的 `file`（失败**文件**）；同目标内的
 * 成功行**照常透出**（写盘轮按库面已附的「未写盘」注记透出）⇒ 原子性不变
 * （有失败 ⇒ 零写盘），但「哪些文件本来可以迁移」这一事实不再丢。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1086-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: Array<{ file: string; outFile: string; notes?: string[] }>;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};

describe("migrate strip --json 的逐文件隔离与 path 量纲", () => {
  it("混合目录 ⇒ results 保留成功文件的逐文件结果（不再整目标丢弃）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 成功文件的行**仍在** results 里（旧行为：整目标丢弃 ⇒ results 为空）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.outFile).toBe("a-good.js");
  });

  it("失败条目的 path 是**失败文件**（不是目标目录）⇒ 与 TS-only 闸门同量纲", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    const p = parsed.pathErrors![0]!.path;
    // 是**文件**（旧行为：目标目录 "."）
    expect(p).toBe("z-bad.ts");
    expect(p.endsWith(".ts")).toBe(true);
    expect(p).not.toBe(".");
    // 失败详情仍逐字沿用库面文案（带文件名）
    expect(parsed.pathErrors![0]!.message).toContain("z-bad.ts");
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
    // stderr 仍带文件名（人类面不回归）
    expect(r.stderr).toContain("z-bad.ts");
  });

  it("pathErrors[] 内所有 path 量纲一致（都是文件，不是目录）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    const paths = (parsed.pathErrors ?? []).map((e) => e.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // 文件级量纲（不是目录）⇒ 与 `results[].file` 同量纲
      expect(p.endsWith(".ts"), `path=${p}`).toBe(true);
      expect(p).not.toBe(".");
      expect(p).not.toBe(dir);
    }
  });

  it("--write：成功行带库面的「未写盘」注记，且原子性不变（一个字节都不落盘）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    // 成功行仍在 results 里，且带「未写盘」注记（不被误读成已写盘）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.notes?.join(" ")).toContain("not written");
    // 失败条目的 path 仍是**文件**
    expect(parsed.pathErrors?.[0]?.path).toBe("z-bad.ts");
    // 原子性：零写盘
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("负控：全部成功 ⇒ stdout 仍是顶层数组（形状不变）", () => {
    const dir = dirWith({ "a-good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe("a-good.ts");
  });
});
});

// ---------------------------------------------------------------------------
// 用法错误的机器码三动词统一（nudo:usage-error）
// ---------------------------------------------------------------------------
describe("用法错误的机器码三动词统一（nudo:usage-error）", () => {
/**
 * 用法错误的机器码在三个动词间**分叉** ⇒ 同一类错误产出**不同的
 * `pathErrors[].code`** ⇒ 机器消费者必须为 `test` 单独维护一张码表。
 *
 * 实测（改前）：`nudo check --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo contract --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo test --json`（无路径）⇒ **`"usage-error"`**。
 *
 * 修复：`test` 面的用法错误码改成 `"nudo:usage-error"`（与 check / contract
 * 对齐）；`"syntax-error"` 保持不变（与 check 面同码）。
 *
 * 负控：非 `--json` 面的人读文案与 exit 码不变。
 */






type PathError = { path: string; code: string; message: string };
type Doc = { ok?: boolean; pathErrors?: PathError[] };

/** 各动词的 `--json` 文档形状不同（check/test = 单文档；contract = 文档数组） */
function firstPathError(stdout: string): PathError | undefined {
  const parsed = JSON.parse(stdout) as Doc | Doc[];
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  for (const d of docs) {
    if (d.pathErrors && d.pathErrors.length > 0) return d.pathErrors[0];
  }
  return undefined;
}

describe("用法错误的机器码三动词统一（nudo:usage-error）", () => {
  const verbs = ["check", "contract", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json（无路径）⇒ pathErrors[0].code === "nudo:usage-error"`, () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-"));
      try {
        const r = runCliTsx([verb, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // stdout 永不为空（机器面契约）
        expect(r.stdout.trim().length).toBeGreaterThan(0);
        const err = firstPathError(r.stdout);
        expect(err, `stdout:\n${r.stdout}`).toBeDefined();
        expect(err!.code).toBe("nudo:usage-error");
        expect(err!.message.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("负控：非 --json 面仍是 stderr 文案 + exit 1（人读面不回归）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-human-"));
    try {
      for (const verb of verbs) {
        const r = runCliTsx([verb], { cwd: dir });
        expect(r.status, `${verb}: ${r.stderr}`).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain("Usage error");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）
// ---------------------------------------------------------------------------
describe("migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）", () => {
/**
 * `nudo migrate strip --write` 把「**未写盘**」的成功行报成 `wrote`。
 *
 * 症状（目标目录里混一个语法错文件：`good.ts` + `bad.ts`）：
 * 1. **人类面说谎**：stdout 打 `wrote good.ts → good.js`，而磁盘上**根本没有**
 * `good.js`（库面原子性：批内有失败 ⇒ 整批零写盘，）⇒ 同一行下面还
 * 跟着一句 `note: not written — …` ⇒ **同一行既说「wrote」又说「not
 * written」**（自相矛盾）。
 * 2. **机器面不可判定**：`--json` 的 `results[]` 里该行带 `outFile`
 * （`good.js`）⇒ 消费方**只能靠一条自由文本 `notes`** 才能区分「计划成功」
 * 与「已写盘」⇒ 极易误判已产出。
 *
 * 根因（两半）：
 * - 库面（`packages/nudojs/src/migrate.ts`）有失败时**整批零写盘**，但把成功行
 * 的结果一并返回（结果不丢是对的）⇒ 附注记 `STRIP_NOT_WRITTEN_NOTE`。
 * - 命令层（`packages/nudojs/src/commands/migrate.ts`）把这些成功行当普通成功行
 * 推入 `results`，人类面又**无条件**按 `--write` 打 `wrote`。
 *
 * 修法：
 * - 库面：逐行给**写盘状态**（机器面枚举）：写盘轮全成功 ⇒ `written`；批内有
 * 失败 ⇒ 整批 `not-written`（dry-run 的行不带此键，命令层补 `planned`）。
 * - 命令层：人类面措辞由**逐行**的写盘状态决定（`wrote` / `not written` /
 * `dry`）⇒ 未写盘**不得**打 `wrote`；`--json` 的每一行都带 `writeStatus`
 * ⇒ 消费方只读结构化字段即可判定。
 *
 * 必须保持的不变量（负控）：
 * - **整批零写盘的原子性不变**（）：有失败 ⇒ 磁盘上一个 `.js` 都没有。
 * - **成功行的结果不丢**：失败批次里「本来可以迁移」的文件仍出现在 `results[]`。
 * - **退出码语义不变**：有失败 ⇒ 非 0；全成功 ⇒ 0。
 * - `pathErrors[]` 的内容与量纲不变（失败**文件**，不是目标目录 —— ）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1100-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripRow = {
  file: string;
  outFile: string;
  notes?: string[];
  /** 写盘状态（机器面 · ）：`written` / `not-written` / `planned` */
  writeStatus?: string;
};

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: StripRow[];
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};

describe("migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）", () => {
  it("验收 1：批内有失败文件 + --write ⇒ 人类面**不打** `wrote`，且磁盘上零产出", () => {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCliTsx(["migrate", "strip", "--write", "."], { cwd: dir });

    // 人类面：该行必须显示为「未写盘」，**不得**出现 `wrote`
    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toContain("not written");
    expect(r.stdout).toContain("good.ts");
    // 失败详情走 stderr（带文件名）
    expect(r.stderr).toContain("bad.ts");
    // 原子性：一个字节都没落盘
    expect(existsSync(join(dir, "good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("验收 2：同场景 --json ⇒ results[] 的该行带**机器可判定**的「未写盘」标记", () => {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });

    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 结果**不丢**（成功行仍在 results[] 里）
    expect(parsed.results?.length ?? 0).toBe(1);
    const row = parsed.results![0]!;
    expect(row.file).toBe("good.ts");
    expect(row.outFile).toBe("good.js");
    // 机器可判定：**只读结构化字段**就能判定「没落盘」（不必解析 notes）
    expect(row.writeStatus).toBe("not-written");
    expect(row.writeStatus).not.toBe("written");
    // 失败路径的量纲不变（失败**文件**，不是目标目录 —— ）
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors![0]!.path).toBe("bad.ts");
  });

  it("验收 3：全部成功 + --write ⇒ 人类面照旧打 `wrote`，产物真实落盘，标记为「已写盘」", () => {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCliTsx(["migrate", "strip", "--write", "."], { cwd: dir });

    expect(r.stdout).toMatch(/^wrote {2}good\.ts → good\.js$/m);
    expect(r.stdout).not.toContain("not written");
    // 产物真的落盘
    expect(existsSync(join(dir, "good.js"))).toBe(true);

    // 机器面：标记为「已写盘」
    const j = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]!.writeStatus).toBe("written");
  });

  it("验收 4：退出码语义不变（有失败 ⇒ 非 0；全成功 ⇒ 0）", () => {
    const bad = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });

    expect(runCliTsx(["migrate", "strip", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCliTsx(["migrate", "strip", "--write", "."], { cwd: good }).status).toBe(0);
    expect(runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: good }).status).toBe(0);
  });

  it("负控：dry-run（不带 --write）⇒ 人类面是 `dry`（不是 `wrote`），标记为「计划」", () => {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCliTsx(["migrate", "strip", "."], { cwd: dir });

    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toMatch(/^dry {2}good\.ts → good\.js$/m);
    expect(existsSync(join(dir, "good.js"))).toBe(false);

    const j = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(parsed[0]!.writeStatus).toBe("planned");
  });

  it("库面：写盘轮逐行给写盘状态（有失败 ⇒ not-written；全成功 ⇒ written）", async () => {
    const mixed = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const rows = await migrateStrip([mixed], { write: true, draft: false });
    const good = rows.find((r) => r.file.endsWith("good.ts"))!;
    expect(good.writeStatus).toBe("not-written");
    // 原子性不变（）
    expect(readdirSync(mixed).filter((f) => f.endsWith(".js"))).toHaveLength(0);

    const ok = dirWith({ "good.ts": GOOD });
    const okRows = await migrateStrip([ok], { write: true, draft: false });
    expect(okRows[0]!.writeStatus).toBe("written");
    expect(existsSync(join(ok, "good.js"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip 的失败码走 DIAG 注册表
// ---------------------------------------------------------------------------
describe("migrate strip 的失败码走 DIAG 注册表", () => {
/**
 * `nudo:migrate-strip-failed` 必须走**稳定诊断码注册表**
 * （`@nudojs/core/internal` 的 `DIAG`），不得在 CLI 层直写字面量。
 *
 * 旧行为：`packages/nudojs/src/commands/migrate.ts` 的 `--json` 信封里直接写
 * `code: "nudo:migrate-strip-failed"` 字面量 ⇒ 绕过 `DIAG` 注册表 ⇒
 * - 码的**拼写**在生产面有两处真理源（注册表外的字面量 + 术语表）；
 * - 术语表反向对账（website docs-coverage rule 19）只能靠「src 字面量扫描」
 * 兜底，一旦 CLI 层改写法（变量 / 拼接）该码就会变成**永久幻影**
 * （文档里有、实现里扫不到 ⇒ rule 19 误报 phantom）。
 *
 * 新行为：码进 `DIAG` 注册表（键 `migrateStripFailed`），CLI 层引用常量。
 *
 * 断言口径：
 * - 产出的 `pathErrors[].code` **等于注册表常量**（不是另写的字面量）；
 * - 该码**在注册表里存在**（`Object.values(DIAG)` 含它）；
 * - 生产 src 里**不再残留**该码的裸字面量赋值（`code: "nudo:…"` 形态）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1143-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};

describe("migrate strip 的失败码走 DIAG 注册表", () => {
  it("注册表里存在该码（键名 migrateStripFailed）", () => {
    expect(DIAG.migrateStripFailed).toBe("nudo:migrate-strip-failed");
    expect(Object.values(DIAG)).toContain("nudo:migrate-strip-failed");
  });

  it("产出的 pathErrors[].code 等于注册表常量（不是另写的字面量）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    // 非空字符串（防「两边都是 undefined ⇒ 断言空过」）
    expect(typeof parsed.pathErrors![0]!.code).toBe("string");
    expect(parsed.pathErrors![0]!.code).toBe(DIAG.migrateStripFailed);
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
  });

  it("生产 src 不再残留该码的裸字面量赋值（`code: \"nudo:…\"` 形态）", () => {
    const src = readFileSync(
      join(repoRoot, "packages/nudojs/src/commands/migrate.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/code:\s*"nudo:migrate-strip-failed"/);
    // 引用注册表常量
    expect(src).toContain("DIAG.migrateStripFailed");
  });
});
});

// ---------------------------------------------------------------------------
// CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）
// ---------------------------------------------------------------------------
describe("CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）", () => {
/**
 * 回归（CLI 面）：**依赖模块不可读（EACCES）**不得被说成「文件不存在」，
 * 也不得让异常冒到整轮外面。
 *
 * 口径（core 侧 load-guard + service 侧 ModuleReadError 同源）：
 * - 不可读 ⇒ 一条明确诊断（写明「读不到」+ errno），严重级 error ⇒ 非零退出；
 * - 不可读 ≠ 不存在（诊断文案不得出现「not found」）；
 * - 整轮仍产出报告（stdout 非空），不是「0 字节无报告」。
 *
 * root 对 chmod 000 免疫 ⇒ 真实 EACCES 用例在 root 下跳过。
 *
 * cwd 固定为仓库根（repoRoot）：tsx 的 tsconfig `paths` 解析以 cwd 为准
 * ——cwd 在仓库外时 `@nudojs/core` 会落到 package.json exports 的 dist
 * （未 build 时是陈旧产物），本用例要验的 core 侧 load-guard 就不在。
 * 仓库根 ⇒ core/service 走 src（CI build 后同样走 src，行为一致）。
 */






const isRoot = process.geteuid?.() === 0;

const MAIN = `import { probe } from "./dep.js";
export function run() {
  return probe();
}
`;
const DEP = `export function probe() {
  return 0;
}
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-499-cli-"));
  writeFileSync(join(dir, "main.js"), MAIN, "utf-8");
  writeFileSync(join(dir, "dep.js"), DEP, "utf-8");
  return dir;
}

describe("CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）", () => {
  it.runIf(!isRoot)("chmod 000 的依赖 ⇒ EACCES 诊断 + exit 1 + 报告非空", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      // 报告非空（不是「整轮抛未捕获异常 ⇒ stdout 0 字节」）
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).toContain("nudo check");
      // 明确诊断：写明读不到 + errno
      expect(r.stdout).toContain("cannot read module");
      expect(r.stdout).toContain("EACCES");
      // 不可读 ≠ 不存在
      expect(r.stdout).not.toContain("not found");
      expect(r.stdout).not.toContain("Module file not found");
      // 非零退出（门禁 fail-closed）
      expect(r.status).toBe(1);
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(!isRoot)("--json 面：ok:false + error 级 issue + 非零退出", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", "--json", join(dir, "main.js")], { cwd: repoRoot });
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        summary: { errors: number };
        issues: { code: string; severity: string; message: string }[];
      };
      expect(json.ok).toBe(false);
      expect(json.summary.errors).toBeGreaterThan(0);
      expect(r.status).toBe(1);
      const readErr = json.issues.filter((i) => i.message.includes("cannot read module"));
      expect(readErr.length).toBeGreaterThan(0);
      for (const i of readErr) expect(i.severity).toBe("error");
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：依赖可读 ⇒ 无「cannot read module」诊断，门禁绿", () => {
    const dir = fixture();
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      expect(r.stdout).not.toContain("cannot read module");
      expect(r.stdout).toContain("run() => 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// nudojs : standard 产物的字面量保真
// ---------------------------------------------------------------------------
describe("nudojs : standard 产物的字面量保真", () => {
/**
 * / `nudo export --format standard` 的**产品面**回归。
 *
 * 修前：standard 节点经 `JSON.stringify` 落地 ⇒ `Infinity` 静默变 `null` ⇒
 * 导出的校验器**拒绝函数必返的值**、**放行函数永不返回的 `null`**（schema 与
 * 函数完全反向）；bigint 字面量则让整条 export **崩溃、零产物**（`--format all`
 * 下四个方言的产物一起丢）。
 *
 * 修后：节点走保真序列化 ⇒ 产物放行 `Infinity`、拒绝 `null`；bigint 契约的
 * export 不再崩溃（四个方言的产物都在）。
 */







type StdExport = {
  "~standard": {
    validate(value: unknown): {
      value?: unknown;
      issues?: ReadonlyArray<{ message?: string }>;
    };
  };
};

describe("nudojs : standard 产物的字面量保真", () => {
  it("export --format standard：Infinity 放行、null 拒绝（不再折成 null）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-inf-"));
    const file = join(dir, "divzero.js");
    writeFileSync(
      file,
      "export function divZero() { return 1 / 0; }\nexport function okNum() { return 42; }\n",
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);

    const p = join(out, "divZero.nudo.standard.ts");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf-8");
    // 修前：{"k":"lit","value":null}
    expect(body).toContain('"value":Infinity');
    expect(body).not.toContain('"value":null');

    const mod = (await import(pathToFileURL(p).href)) as unknown as Record<string, StdExport>;
    const validate = mod.divZeroOutput!["~standard"].validate;
    expect(validate(Infinity).issues).toBeUndefined();
    const nul = validate(null);
    expect(nul.issues).toBeDefined();
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
  });

  it("export --format all：bigint 字面量契约不再让整条命令崩溃（零产物）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-big-"));
    const file = join(dir, "big.js");
    writeFileSync(file, "export function bigAdd(a) { return a; }\n", "utf-8");
    writeFileSync(
      join(dir, "big.nudo.js"),
      // 侧车的契约形参名必须与函数形参表一致（`bigAdd(a)` ⇒ `a`）：写成 `n` 时
      // `nudo check` 判 `nudo:contract-param-mismatch`（error）⇒ 导出面按契约
      // 一致性闸门拒绝发布产物（）。
      'import { fn, lit } from "@nudojs/core";\nexport const bigAdd = fn({ a: lit(10n) }, lit(10n));\n',
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "all", "--out", out]);
    // 修前：exit 1 +「Do not know how to serialize a BigInt」+ 产物 0 个
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("Do not know how to serialize a BigInt");
    // 四个方言的产物都在（standard 面不再连坐其它方言）
    expect(existsSync(join(out, "big.nudo.schema.zod.ts"))).toBe(true);
    expect(existsSync(join(out, "big.nudo.guard.ts"))).toBe(true);
    expect(existsSync(join(out, "big.d.ts"))).toBe(true);
    const std = join(out, "bigAdd.nudo.standard.ts");
    expect(existsSync(std)).toBe(true);
    expect(readFileSync(std, "utf-8")).toContain('"value":10n');
  });
});
});

// ---------------------------------------------------------------------------
// --dry-run 与 --write 同时给出时以 dry-run 为准
// ---------------------------------------------------------------------------
describe("--dry-run 与 --write 同时给出时以 dry-run 为准", () => {
/**
 * `nudo check --fix --write --dry-run` 仍**落盘**（--dry-run 被静默忽略）。
 *
 * 症状：--dry-run 与 --write 同时给出时 write 胜出 ⇒ 磁盘被改、侧车被写；
 * 用户以为在演练、实际改了仓库。修复：--dry-run 优先（与兄弟命令同款口径：
 * `nudo contract --draft --write --dry-run` / `nudo test --freeze --dry-run`
 * 都是「只打印、不落盘」）。
 */






const SRC = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): { cwd: string; file: string; sidecar: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-629-"));
  const file = join(dir, "helper.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file, sidecar: join(dir, "helper.nudo.js") };
}

describe("-dry-run 与 --write 同时给出时以 dry-run 为准", () => {
  it("CLI：--fix --write --dry-run 只打印计划、**不落盘**", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--write", "--dry-run"], { cwd });
      const out = r.stdout + r.stderr;
      // 计划面：打印 diff + 「planned (dry-run)」
      expect(out).toContain("planned (dry-run)");
      expect(out).not.toContain("edit(s) written");
      // 磁盘面：侧车不生成、源文件不变
      expect(existsSync(sidecar)).toBe(false);
      expect(readFileSync(file, "utf-8")).toBe(SRC);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--fix --write（不带 --dry-run）仍落盘（旧口径不回归）", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--write"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("edit(s) written");
      expect(existsSync(sidecar)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--fix（不带 --write）只打印计划、不落盘（默认值不回归）", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("planned (dry-run)");
      expect(existsSync(sidecar)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）
// ---------------------------------------------------------------------------
describe("check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）", () => {
/**
 * `check --json` 遇**输入读取失败**（EACCES）⇒ stdout 0 字节 + 裸 errno。
 *
 * 旧实现：`runCheck` 的 `readFileSync` 无 try/catch ⇒ 异常逃逸出命令层 ⇒
 * 顶层兜底只打一行裸 errno ⇒ `--json` 面 **stdout 0 字节** + exit 1
 * （违反 cli-semantics「--json 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」）。同族的其它路径错误（不存在 / 空目录 / 非目标）都走 `pathErrors[]`
 * 信封，唯独「读输入」这条路漏了。
 *
 * 修复：读输入包 try/catch ⇒ 归一到 `PathError{code:"nudo:path-io"}`：
 * - `--json` 面 ⇒ 信封 `ok:false` + `pathErrors[{code:"nudo:path-io"}]`，stdout 非空；
 * - 人类面 ⇒ 一行 message + `fix:` 提示（同一 face）。
 *
 * 注：以 root 运行时 chmod 000 拦不住读取 ⇒ 该用例跳过（root 环境下无法
 * 构造 EACCES；非 root 环境正常跑）。
 */






const SRC = "export function f(x){ return x; }\n";

/** 造一个「存在但不可读」的文件；返回 undefined 表示本机拦不住（root） */
function makeUnreadable(dir: string): string | undefined {
  const file = join(dir, "u.js");
  writeFileSync(file, SRC, "utf-8");
  chmodSync(file, 0o000);
  try {
    readFileSync(file, "utf-8");
    return undefined; // 仍可读 ⇒ root / 特殊挂载
  } catch {
    return file;
  }
}

describe("check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）", () => {
  it("--json 面：stdout 非空 + 信封 ok:false + pathErrors[nudo:path-io] + exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) return; // root：无法构造 EACCES
      const r = runCliTsx(["check", file, "--json"]);
      expect(r.stdout.length, "stdout 不得为空（--json 面永不为空）").toBeGreaterThan(0);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        reports: unknown[];
        pathErrors?: Array<{ code: string; path: string; message: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.reports).toEqual([]);
      expect(env.pathErrors).toHaveLength(1);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-io");
      expect(env.pathErrors?.[0]?.path).toContain("u.js");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("人类面：message + fix: 提示（不是裸 errno）+ exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) return; // root
      const r = runCliTsx(["check", file]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("fix:");
      expect(r.stderr).toMatch(/Cannot read .*u\.js/);
      // 旧实现：stderr 只有一行裸 errno（「EACCES: permission denied, open …」）
      expect(r.stderr.trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对照：缺文件走既有 nudo:path-not-found 信封（不被本次改动影响）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const r = runCliTsx(["check", join(dir, "nope.js"), "--json"]);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        pathErrors?: Array<{ code: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// check --json --gitlab：GitLab 注解不再被丢弃
// ---------------------------------------------------------------------------
describe("check --json --gitlab：GitLab 注解不再被丢弃", () => {
/**
 * `nudo check --json --gitlab`：GitLab 注解数组被**整段丢弃**
 * （既不进 stdout 也不进 stderr）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：注解分派把 GitLab
 * 挂在 `--json` 的 `else` 上，而 `--json` 路径**恒**置 `jsonCollect`
 * （check-command.ts）⇒ `opts.json && opts.jsonCollect` 永远成立 ⇒
 * `opts.gitlab` 分支永不可达 ⇒ 注解被静默吞掉（CI 面板上该文件的告警消失，
 * 且没有任何提示说这个组合被忽略了）。
 *
 * 修法：两个注解通道（GitLab Code Quality / GHA 行内注解）**并列**，
 * 机器面（--json）两者都只写 stderr —— stdout 是 CheckJson 机器契约，
 * 注解不得混进去（与 --gha 的既有口径同形）。
 *
 * 本文件钉住：
 * - `--json --gitlab`：stdout 可解析为 CheckJson + stderr 可解析为
 * Code Quality 数组（`check_name` 字段在位）；
 * - `--json`（无 --gitlab）：stderr 不含任何注解（不回归泄漏）；
 * - `--gitlab`（无 --json）：stdout 仍是**恰好一份** Code Quality 数组
 * （旧口径不变）。
 */






/** 未约束入口 → L2 entry may-throw（error）+ entry-only（info） */
const BAD = `export function staticName(node) {
  return node.type;
}
`;

type CodeQualityRow = {
  check_name: string;
  fingerprint: string;
  severity: string;
  location: { path: string; lines: { begin: number } };
};

/** stderr 里最后一行非空内容（注解以单行 JSON 数组写出） */
function lastJsonLine(stderr: string): unknown {
  const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!);
}

describe("check --json --gitlab：GitLab 注解不再被丢弃", () => {
  it("--json --gitlab：stdout 是 CheckJson 契约，stderr 是 Code Quality 数组", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-gitlab-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--json", "--gitlab"]);
      // 门禁语义不变：L2 entry may-throw（error）⇒ exit 1
      expect(r.status).toBe(1);

      // stdout：CheckJson 机器契约（可解析，注解不得混进来）
      const envelope = JSON.parse(r.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.issues.map((i: { code: string }) => i.code)).toContain(
        "nudo:entry-may-throw",
      );
      expect(r.stdout).not.toContain("check_name");

      // stderr：GitLab Code Quality 数组（旧实现整段丢失 ⇒ 计数 0）
      const rows = lastJsonLine(r.stderr) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
      for (const row of rows) {
        expect(row.fingerprint).toBeTruthy();
        expect(row.severity).toBeTruthy();
        expect(row.location.lines.begin).toBeGreaterThanOrEqual(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json（无 --gitlab）：stderr 不含任何 CI 注解（不回归泄漏）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--json"]);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).ok).toBe(false);
      expect(r.stderr).not.toContain("check_name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--gitlab（无 --json）：stdout 仍是恰好一份 Code Quality 数组（旧口径不变）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-gitlab-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--gitlab"]);
      expect(r.status).toBe(1);
      const rows = JSON.parse(r.stdout) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// check — 模块装载问题族上屏（）
// ---------------------------------------------------------------------------
describe("check — 模块装载问题族上屏（）", () => {
/**
 * `nudo check` **从不报告模块装载问题族**
 * （`nudo:module-missing` / `nudo:missing-export` / `nudo:module-cycle` /
 * `nudo:module-depth`）：依赖解析失败的源文件**门禁绿灯、exit 0**。
 *
 * 根因：模块图装载问题（service `composeEvalModules` → `pushBModuleIssues`）
 * 只走**分析器诊断通道**；core `checkSource` 不装载依赖模块图 ⇒ 这些事实
 * 在 check 面完全没有出口。`domainIssuesFromDiagnostics` 的白名单此前**只**
 * 留 contract 家族两码 ⇒ 分析器产出的 module 族诊断被整条丢弃
 * ⇒ 「依赖解析失败」在 CI 门禁上不可见（fail-open）。
 *
 * 钉：
 * - 依赖文件缺失 ⇒ `nudo:module-missing` 上屏（error）+ **exit 1**（门禁红）；
 * - 依赖文件存在但缺导出 ⇒ `nudo:missing-export` 上屏（error）+ **exit 1**；
 * - `--json` 面同码同 severity（JSON 契约面不得比人面更弱）。
 *
 * 回归方向：把 `packages/nudojs/src/check-json-map.ts` 的
 * `CHECK_FACE_DIAG_CODES` 退回「只有 contract 家族两码」⇒ 本钉大面积失败。
 */






/** 最小 ESM 工程（type=module ⇒ .js 走 ESM 解析）。 */
function writeProject(dir: string, name: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "${name}", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
}

/** 从 `--json` 面解析出 issues（人面与 JSON 面必须同码同 severity）。 */
function jsonIssues(stdout: string): Array<{ severity: string; code: string; message: string }> {
  const parsed = JSON.parse(stdout) as {
    issues?: Array<{ severity: string; code: string; message: string }>;
  };
  return parsed.issues ?? [];
}

describe("check — 模块装载问题族上屏（）", () => {
  it("依赖文件缺失 ⇒ nudo:module-missing 上屏 + 门禁红（exit 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-missing-"));
    writeProject(dir, "b632-missing");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    // 人面：诊断码以 "(nudo:xxx)" 形式出现（docs 深链不是这个形态）
    expect(out).toContain("(nudo:module-missing)");
    // 门禁红（此前是 OK / exit 0）
    expect(r.status).toBe(1);
  });

  it("依赖文件存在但缺导出 ⇒ nudo:missing-export 上屏 + 门禁红（exit 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-export-"));
    writeProject(dir, "b632-export");
    writeFileSync(join(dir, "exists.js"), `export function g() { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./exists.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:missing-export)");
    expect(r.status).toBe(1);
  });

  it("--json 面同码同 severity（error）且 ok=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-json-"));
    writeProject(dir, "b632-json");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const hit = issues.find((i) => i.code === "nudo:module-missing");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(r.status).toBe(1);
  });

  it("不双报：mock 文件缺失（mock 通道 + 模块图通道同码同文）只报一条", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-dup-"));
    writeProject(dir, "b632-dup");
    writeFileSync(
      join(dir, "a.js"),
      `// @nudo:mock fs from "./definitely-missing-mock-file.js"\nexport function useFs() {\n  return 1;\n}\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe("error");
  });
});
});

// ---------------------------------------------------------------------------
// .js 里的 TS-only 语法不得判绿
// ---------------------------------------------------------------------------
describe(".js 里的 TS-only 语法不得判绿", () => {
/**
 * `nudo check` 对 `.js` 里的 **TS-only 语法**判 **OK / exit 0**
 * （CI 门禁假绿）：`node --check` 自己拒绝该文件（SyntaxError）。
 *
 * 修法（族 18 片 4）：
 * - core `parseSource` 新增 `filename` 选项 ⇒ **按扩展名**选解析插件
 * （`.js` / `.mjs` / `.cjs` / `.jsx` **不开** typescript 插件）；
 * - check 面按扩展名复核（`parseForCheck`）⇒ TS-only 语法走既有**语法错
 * 通道**（人类面 tsc 风格块 / `--json` 面 pathErrors + ok:false / `--fix`
 * 面残余 error ⇒ exit 1），不再静默判绿。
 *
 * oracle（改前 → 改后）：
 * 改前 `nudo check privfield.js` ⇒ OK / 0 error / exit 0
 * 改后 `nudo check privfield.js` ⇒ 语法错块（2:11 — syntax error:
 * TypeScript-only syntax is not valid in a .js file）/ exit 1
 */






/** `.js` 里的 TS-only 语法（Node 自己拒绝：`node --check` ⇒ SyntaxError） */
const TS_ONLY_JS = `export class A {
  private x = 0;
  m() { return this.x; }
}
`;

const PLAIN_JS = `export function f(x) {
  return x;
}
`;

function project(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b633-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b633", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), src, "utf-8");
  return dir;
}

describe(".js 里的 TS-only 语法不得判绿", () => {
  it("人类面：语法错块 + exit 1（此前 OK / exit 0）", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("syntax error");
    expect(out).toContain("TypeScript-only syntax");
    // 不得再出现「判绿」的签名面
    expect(out).not.toContain("A.m() => 0");
  });

  it("--json 面：信封 ok:false + pathErrors[0].code=syntax-error", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--json", join(dir, "lib.js")]);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.pathErrors?.[0]?.code).toBe("syntax-error");
    expect(json.pathErrors?.[0]?.message).toContain("TypeScript-only syntax");
    expect(r.status).toBe(1);
  });

  it("check --fix 不得静默跳过：残余 error ⇒ exit 1", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--fix", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("residual error");
    expect(out).toContain("TypeScript-only syntax");
  });

  it("磁盘缓存不得把「假绿」固化：连跑两轮都判红", { timeout: 90_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const cacheDir = mkdtempSync(join(tmpdir(), "nudo-b633-cache-"));
    const file = join(dir, "lib.js");
    const first = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(first.status, first.stdout + first.stderr).toBe(1);
    const second = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(second.status, second.stdout + second.stderr).toBe(1);
    expect(second.stdout + second.stderr).toContain("TypeScript-only syntax");
  });

  it("纯 JS 文件不受影响：仍判绿（exit 0）", { timeout: 60_000 }, () => {
    const dir = project(PLAIN_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("`.ts` 文件仍允许 TS 语法（按扩展名收紧，不误伤 TS 面）", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b633-ts-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "b633ts", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    writeFileSync(join(dir, "lib.ts"), TS_ONLY_JS, "utf-8");
    const r = runCli(["check", join(dir, "lib.ts")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).not.toContain("TypeScript-only syntax");
  });
});
});

// ---------------------------------------------------------------------------
// profile typo 告警文案按生效档位生成
// ---------------------------------------------------------------------------
describe("profile typo 告警文案按生效档位生成", () => {
/**
 * 非法 `nudo.check.profile` 的告警文案与**实际生效档位**脱节。
 *
 * 旧文案写死「using default strict」⇒ 诊断说假话：配置里同层还有显式
 * `check.entryThrows:"warning"` 时，实际生效档位是 warning（门禁放行、
 * exit 0），告警却说「using default strict」（用户以为自己的文件没过）。
 *
 * 修复：文案按**最终解析出的档位**生成（解析链 = CLI 显式 > CLI profile >
 * 配置 entryThrows > 配置 profile > 默认 strict）。
 */






/** L2-only：export 上未消化 may-throw ⇒ 档位可从 exit code 观测 */
const L2_SRC = "export function getName(user){ return user.name; }\n";

function makeProject(nudoCheck: string): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug637-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "bug637",
      version: "0.0.0",
      nudo: { check: JSON.parse(nudoCheck) },
    }),
    "utf-8",
  );
  const file = join(cwd, "a.js");
  writeFileSync(file, L2_SRC, "utf-8");
  return { cwd, file };
}

describe("profile typo 告警文案按生效档位生成", () => {
  it("profile:\"bogus\" + entryThrows:\"warning\" ⇒ 告警说 using warning（且不说 default strict）", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus","entryThrows":"warning"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using warning',
      );
      expect(r.stderr).not.toContain("using default strict");
      // 生效档位 = warning ⇒ L2 降级 ⇒ exit 0（文案与实际一致）
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("1 warning");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("profile:\"bogus\" 单独 ⇒ 仍是 using default strict（默认档文案不变）+ strict 门禁 exit 1", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using default strict',
      );
      expect(r.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI --entry-throws warning 压过配置 profile typo ⇒ 告警说 using warning", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCliTsx(["check", file, "--entry-throws", "warning"], { cwd });
      expect(r.stderr).toContain("— using warning");
      expect(r.stderr).not.toContain("using default strict");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// nudo:dual-entry 缓存命中轮不重复上屏
// ---------------------------------------------------------------------------
describe("nudo:dual-entry 缓存命中轮不重复上屏", () => {
/**
 * `nudo:dual-entry` 在**磁盘缓存命中轮**被**重复**上屏
 * （冷缓存 1 条 → 热缓存 2 条同文案）⇒ 机器可读面逐轮漂移
 * （诊断条数随缓存状态变化）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：该 issue 在**缓存
 * 之后**注入（保证命中轮也上屏），但**上一轮的注入结果被写进了磁盘缓存**
 * ⇒ 命中轮拿到的 report / cachedJson 已经含这条 issue，再把 live 的那一条
 * merge 上去 ⇒ 同文案重复两条（mergeCheckIssues / mergeJsonIssues 只追加、
 * 不去重）。
 *
 * 修法：与 env-unresolved / 配置形状诊断同一口径 —— **写盘前剥除 +
 * 读回后剥除**，由本轮 live 注入单一来源上屏 ⇒ miss 轮与命中轮的 issues
 * 数组逐条相同（不引入"热轮无该条"的反向漂移）。
 *
 * 本文件钉住：
 * - `--json` 面：冷 / 热 / 热三轮的 issues 数组与 summary 逐条相同，
 * dual-entry 各**恰好 1 条**；
 * - 人类面：热轮的 issues 段只有**一行** dual-entry；
 * - 写盘口径：磁盘缓存条目里**不含** nudo:dual-entry。
 */






/** 双入口包：browser / node 两个面解析到不同文件 */
const PKG = JSON.stringify({
  name: "dualp",
  version: "1.0.0",
  type: "module",
  exports: { ".": { browser: "./browser.js", default: "./node.js" } },
});

const BROWSER_JS = `export function browserOnly() {
  return 1;
}
`;
const NODE_JS = `export function nodeOnly() {
  return 2;
}
`;

type Issue = { code: string };
type CheckJsonLike = { ok: boolean; issues: Issue[]; summary: Record<string, number> };

/** 递归收集缓存目录下的所有文件（缓存条目按 <ns>/<xx>/<hash>.json 分层） */
function cacheFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("nudo:dual-entry 缓存命中轮不重复上屏", () => {
  it("--json 面：冷/热/热三轮 issues 逐条相同（dual-entry 各 1 条）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-json-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      const r1 = runCliTsx(["check", file, "--json"], { env });
      const r2 = runCliTsx(["check", file, "--json"], { env });
      const r3 = runCliTsx(["check", file, "--json"], { env });
      const j1 = JSON.parse(r1.stdout) as CheckJsonLike;
      const j2 = JSON.parse(r2.stdout) as CheckJsonLike;
      const j3 = JSON.parse(r3.stdout) as CheckJsonLike;
      const dual = (j: CheckJsonLike): Issue[] =>
        j.issues.filter((i) => i.code === "nudo:dual-entry");
      // 冷轮 1 条；热轮（旧实现 2 条）必须仍是 1 条
      expect(dual(j1).length).toBe(1);
      expect(dual(j2).length).toBe(1);
      expect(dual(j3).length).toBe(1);
      // 逐条相同（不只是条数）：机器面不得随缓存状态漂移
      expect(j2.issues).toEqual(j1.issues);
      expect(j3.issues).toEqual(j1.issues);
      expect(j2.summary).toEqual(j1.summary);
      expect(j3.summary).toEqual(j1.summary);
      expect(r2.stdout).toBe(r1.stdout);
      expect(r3.stdout).toBe(r1.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("人类面：热轮的 issues 段只有一行 dual-entry", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-human-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCliTsx(["check", file], { env });
      const hot = runCliTsx(["check", file], { env });
      const issueLines = hot.stdout
        .split("\n")
        .filter((l) => l.includes("(nudo:dual-entry)"));
      expect(issueLines.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("写盘口径：磁盘缓存条目里不含 nudo:dual-entry", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-cache-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCliTsx(["check", file, "--json"], { env });
      const files = cacheFiles(cache);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(readFileSync(f, "utf8")).not.toContain("nudo:dual-entry");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// --what-if 不再静默吞掉机器 / 观察旗标
// ---------------------------------------------------------------------------
describe("--what-if 不再静默吞掉机器 / 观察旗标", () => {
/**
 * `nudo check --json --what-if …` **静默吞掉 --json**（stdout 是人读文本）。
 *
 * 症状：--what-if 是早退分支 ⇒ --json/--abs/--gha/--gitlab/--from/--watch/--verbose
 * 全部被静默丢弃（stdout 变成 `Type of "raw": …` 的人读文本、exit 0 ⇒ 机器面
 * `JSON.parse(stdout)` 直接炸）；且多文件时**静默塌缩**成第 1 个（其余文件从未被分析）。
 * 修复：组合表显式拒绝（与 --fix 的拒绝表同款纪律）+ 多文件显式报错。
 */






const SRC = `const raw = 1;

export function useRaw() {
  return raw + 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-644-"));
  const file = join(dir, "a.js");
  const other = join(dir, "b.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd: dir, file, other };
}

describe("-what-if 不再静默吞掉机器 / 观察旗标", () => {
  it("CLI：--json --what-if ⇒ 显式 usage error（stdout 是机器可读信封）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, "--json", "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      // 旧症状：stdout 是 `Type of "raw": string` 的人读文本 ⇒ JSON.parse 炸
      expect(r.stdout).not.toContain('Type of "raw"');
      const doc = JSON.parse(r.stdout);
      expect(doc.kind).toBe("multi");
      expect(doc.ok).toBe(false);
      expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
      expect(doc.pathErrors[0].message).toContain("--what-if cannot be combined with --json");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--abs / --gha / --gitlab / --from / --watch 与 --what-if ⇒ 显式拒绝（exit 1）", () => {
    const { cwd, file, other } = makeProject();
    try {
      const combos: string[][] = [
        ["--abs"],
        ["--gha"],
        ["--gitlab"],
        ["--from", other],
        ["--watch"],
      ];
      for (const combo of combos) {
        const r = runCliTsx(
          ["check", file, ...combo, "--what-if", "raw:string", "--target", "raw"],
          { cwd },
        );
        expect(r.status, combo.join(" ")).toBe(1);
        const out = r.stdout + r.stderr;
        expect(out, combo.join(" ")).toContain("--what-if cannot be combined with");
        expect(out, combo.join(" ")).not.toContain('Type of "raw"');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：多文件 --what-if 不再静默塌缩成第 1 个（显式报错）", () => {
    const { cwd, file, other } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, other, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain("--what-if needs exactly one file (got 2)");
      expect(out).not.toContain('Type of "raw"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：单文件 + 无机器旗标的 --what-if 仍正常回答（旧口径不回归）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// 模块环不再丢弃整张依赖图（反向守护钉）
// ---------------------------------------------------------------------------
describe("模块环不再丢弃整张依赖图（反向守护钉）", () => {
/**
 * （**反向守护钉** · 报告说法的假阳性）：`nudo check` 遇**模块环**时
 * **不得**把整张依赖图丢弃。
 *
 * 报告原始描述：`packages/nudojs/src/commands/check.ts` 有
 * `const hasCycle = graph.issues.some(i => i.kind === "cycle")` ⇒ 有环时
 * `mergedMods` 被整个换成 `envMods` 或空 ⇒ 跨模块值塌成 `unknown` ⇒
 * L1 契约门禁**假绿**。
 *
 * **实测（HEAD）：报告说的现象已不成立** ⇒ 本条是**假阳性**，只写守护钉、
 * **零实现改动**（在 HEAD 上必须通过）。
 *
 * HEAD 上的真实链路：
 * - `packages/nudojs/src/commands/check.ts` 的 `buildCheckInjection` 注释明写
 * 「**不再**因为检出环就丢弃整张依赖图」——环内求值**有界**
 * （装载层：环内已部分求值的导出；求值层：调用/分支预算硬闸），
 * 无需「整图丢弃」这种有损降级；
 * - 环本身仍由诊断面报告（`nudo:module-cycle` warning）——**不靠丢图来「避免」环**。
 *
 * **为什么这条钉不是空转**：
 * - 门禁结果必须**逐字一致**：有环 / 无环两夹具的 `nudo check` exit code 与
 * 诊断文本相同 ⇒ 环没有改变分析结果；
 * - 一致结果里**仍有** `nudo:constraint-violated`（actual `5` ⊭ `> 999`）
 * ⇒ 跨模块的值**没有**塌成 `unknown`（塌成 unknown 时门禁会**假绿**，
 * exit code 变 0、约束违规消失 ⇒ 本钉必红）；
 * - 夹具**非空转**：有环夹具真被检出环（`nudo test` 面的 `nudo:module-cycle`），
 * 无环夹具没有 ⇒ 两夹具的差别只在「有没有环」。
 */






/** 入口：跨模块取 `outer()` 的值 */
const MAIN_JS = `import { outer } from "./a.js";
export function run() { return outer(); }
`;

/** 侧车契约：`run()` 的返回值必须 > 999（实际是 5 ⇒ 必须判违约） */
const MAIN_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const run = fn({}, number().gt(999));
`;

/** 有环：a.js ⇄ b.js（a imports b，b imports a） */
const CYCLE_MODULES: Record<string, string> = {
  "a.js": `import { helper } from "./b.js";
export function outer() { return 5; }
`,
  "b.js": `import { outer } from "./a.js";
export function helper() { return outer(); }
`,
};

/** 无环：a.js → b.js → c.js（同一形状，去掉环） */
const ACYCLIC_MODULES: Record<string, string> = {
  "a.js": `import { helper } from "./b.js";
export function outer() { return 5; }
`,
  "b.js": `import { outer } from "./c.js";
export function helper() { return outer(); }
`,
  "c.js": `export function outer() { return 5; }
`,
};

/** 造一个临时项目（入口 + 侧车 + 依赖模块） */
function makeProject(modules: Record<string, string>, name: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug-646-cycle-"));
  for (const [file, body] of Object.entries(modules)) {
    writeFileSync(join(cwd, file), body, "utf-8");
  }
  writeFileSync(join(cwd, "main.js"), MAIN_JS, "utf-8");
  writeFileSync(join(cwd, "main.nudo.js"), MAIN_NUDO_JS, "utf-8");
  writeFileSync(
    join(cwd, "package.json"),
    `{"name":"${name}","version":"0.0.0","type":"module"}\n`,
    "utf-8",
  );
  return cwd;
}

/**
 * 归一化 `nudo check` 人类面输出，供「有环 / 无环」两夹具**逐字**对比。
 *
 * 归一化三处**与分析结果无关**的差异：
 * 1. 夹具目录路径（两个夹具在不同目录）；
 * 2. 模块图**形状**诊断（`nudo:module-cycle` / `nudo:module-depth`）及其 docs 行
 * —— 环本身被诊断面报告是**期望**行为（模块装载问题族上屏），
 * 但它**不得**改变分析结果（签名 + L2 门禁判定）；
 * 3. 汇总行里的 warning 计数（形状诊断是 warning，会把计数带高）。
 */
function normalizeGateOutput(out: string, dir: string): string {
  return out
    .split(dir)
    .join("<DIR>")
    .split("\n")
    .filter((line) => !line.includes("nudo:module-cycle") && !line.includes("nudo:module-depth"))
    .join("\n")
    .replace(/\d+ warning/g, "N warning");
}

describe("模块环不再丢弃整张依赖图（反向守护钉）", () => {
  it("有环 / 无环：nudo check 的 exit code 逐字一致（门禁同判）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["check", "main.js"], { cwd: cyc });
      const b = runCli(["check", "main.js"], { cwd: acyc });
      // 契约被违反 ⇒ 两边都必须红
      expect(a.status).toBe(1);
      expect(b.status).toBe(1);
      // 环**不得**改变门禁判定
      expect(a.status).toBe(b.status);
      // 两边都不得有噪声（stderr 空）
      expect(a.stderr).toBe("");
      expect(b.stderr).toBe("");
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("有环 / 无环：nudo check 的诊断文本逐字一致（归一化模块图形状诊断后）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["check", "main.js"], { cwd: cyc });
      const b = runCli(["check", "main.js"], { cwd: acyc });
      expect(normalizeGateOutput(a.stdout, cyc)).toBe(normalizeGateOutput(b.stdout, acyc));
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("一致结果里仍有 constraint-violated（跨模块的值没有塌成 unknown）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      for (const cwd of [cyc, acyc]) {
        const r = runCli(["check", "main.js"], { cwd });
        // 跨模块的值仍是确定值 5（塌成 unknown 时这里是 unknown）
        expect(r.stdout).toContain("run() => 5");
        expect(r.stdout).not.toMatch(/run\(\) => unknown/);
        // L2 门禁真的判了违约（假绿 = 这条消失）
        expect(r.stdout).toContain("nudo:constraint-violated");
        expect(r.stdout).toContain("actual:   5  #exact");
        expect(r.stdout).toContain("expected: return > 999");
      }
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("夹具非空转：有环夹具真被检出环（nudo test 面），无环夹具没有", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["test", "main.js"], { cwd: cyc });
      const b = runCli(["test", "main.js"], { cwd: acyc });
      // 环被检出（诊断面报告环，但不因此丢图）
      expect(a.stdout).toContain("nudo:module-cycle");
      expect(a.stdout).toContain("Circular module load");
      expect(b.stdout).not.toContain("nudo:module-cycle");
      // 两边的跨模块值都求出来了（环内绑定解析到「已部分求值的类型」）
      expect(a.stdout).toContain("entry@");
      expect(a.stdout).toContain("() => 5");
      expect(b.stdout).toContain("entry@");
      expect(b.stdout).toContain("() => 5");
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// check --fix 的 diff 单份头 + 干净路径字段
// ---------------------------------------------------------------------------
describe("check --fix 的 diff 单份头 + 干净路径字段", () => {
/**
 * `nudo check --fix` 打印的 unified diff **非法且不可 apply**。
 *
 * 旧实现（check.ts 的 diff 打印段）：
 * - 自印一份 `--- <file>` / `+++ <file> ([fix] …)` **又**追加自带头的
 * `unifiedDiff(...)` ⇒ **双份头**；
 * - `+++` 行的**路径字段被说明文字污染**（`+++ <path> ([fix] …)`）⇒
 * 解析出的文件名不是合法路径；
 * - 传给 `unifiedDiff` 的是**绝对路径** ⇒ 头拼成 `a//abs` 的**双斜杠**
 * ⇒ `git apply -p1` 剥掉 `a/` 后仍是绝对路径 ⇒ git 拒绝（exit 1）。
 *
 * 修复：diff 头**只**由 `unifiedDiff` 产出；说明文字移到 diff **之外**的一行；
 * 路径取**相对 cwd**（与兄弟命令 `test --freeze --dry-run` 同口径）。
 */







const SRC = "export function getName(user) {\n  return user.name;\n}\n";

/** 头行：unified diff 的 `---` / `+++` 各恰好一份，且路径字段干净 */
function diffHeaderLines(stdout: string): { minus: string[]; plus: string[] } {
  const lines = stdout.split("\n");
  return {
    minus: lines.filter((l) => l.startsWith("--- ")),
    plus: lines.filter((l) => l.startsWith("+++ ")),
  };
}

describe("check --fix 的 diff 单份头 + 干净路径字段", () => {
  it("单份 ---/+++ 头 + 路径字段无说明文字 + 相对路径（无 a// 双斜杠）", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCliTsx(["check", "--fix", "lib.js"], { cwd });
      const { minus, plus } = diffHeaderLines(r.stdout);
      // 旧实现：--- 两份（自印 + unifiedDiff 自带）、+++ 两份
      expect(minus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      expect(plus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      // 头路径字段干净（无 `([fix] …)` 说明文字污染）
      expect(plus[0]).toMatch(/^\+\+\+ b\/\S+$/);
      expect(minus[0]).toMatch(/^--- a\/\S+$/);
      // 相对路径（不是绝对路径拼出的 a// 双斜杠）
      expect(plus[0]).not.toContain("a//");
      expect(plus[0]).not.toContain("b//");
      expect(plus[0].replace(/^\+\+\+ b\//, "")).not.toMatch(/^\//);
      // 新建文件的 hunk 头是标准形态 @@ -0,0 +1,N @@
      expect(r.stdout).toMatch(/^@@ -0,0 \+1,\d+ @@$/m);
      // 说明文字在 diff 之外（仍可见，但不污染路径字段）
      expect(r.stdout).toContain("[fix]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("diff 可被 `git apply --check -p1` 消费（相对路径 ⇒ 剥掉 a/ 后是仓库内相对路径）", () => {
    // 夹具放在**仓库外**的临时目录、且以该目录为 cwd ⇒ diff 里的路径是
    // 「相对 cwd」的（`a/lib.nudo.js`）⇒ `git apply -p1` 在该目录下按相对
    // 路径解析（不依赖「补丁基准目录 == git 仓库根」这一偶然前提）。
    // 旧实现传的是**绝对路径** ⇒ 头是 `a//<绝对路径>` ⇒ -p1 后仍是绝对路径
    // ⇒ git 拒绝（invalid path ⇒ 非零 exit）。
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-apply-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCliTsx(["check", "--fix", "lib.js"], { cwd });
      expect(r.stdout).toContain("--- a/lib.nudo.js");
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(
        g.status,
        `git apply --check -p1 应成功（stderr: ${g.stderr}）`,
      ).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
});
