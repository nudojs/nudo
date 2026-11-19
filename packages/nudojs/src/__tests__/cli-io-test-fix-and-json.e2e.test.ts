/**
 * 模块套件：cli-io-test-fix-and-json（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { repoRoot, runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { shouldAnalyzeFile, type PathError } from "@nudojs/service";
import { collectNudoFiles, collectExternalRecords } from "../commands/shared.ts";
import { tmpProject } from "./helpers/tmp-project.ts";
import { abs } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";


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


  it("module-missing（error）⇒ exit 1 且诊断上屏；--json：ok=false 且 summary.errors 反映 error 计数；干净文件：ok=true、errors=0、exit 0；warning 级诊断（模块环）不得把 test 判红", () => {
  {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCli(["test", join(dir, "m.js")]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[error]");
      expect(r.stdout).toContain("nudo:module-missing");
    } finally {
      cleanup(dir);
    }
  }
  {
    const dir = project({ "m.js": MISSING_MODULE });
    try {
      const r = runCli(["test", join(dir, "m.js"), "--json"]);
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
  }
  {
    const dir = project({ "ok.js": CLEAN });
    try {
      const r = runCli(["test", join(dir, "ok.js"), "--json"]);
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
  }
  {
    const dir = project({ "a.js": CYCLE_A, "b.js": CYCLE_B });
    try {
      const r = runCli(["test", join(dir, "a.js")]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:module-cycle");
    } finally {
      cleanup(dir);
    }
  }
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


  it("zod 入参槽 = z.array(z.unknown())（不是数组的数组）；standard 面 rest 槽节点只有一层 arr（与 dts 的 ...rest: unknown[] 同形）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const r = runCli(["export", join(dir, "rest.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rest: z.array(z.unknown())");
    expect(r.stdout).not.toContain("z.array(z.array(");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-std-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const all = runCli(["export", join(dir, "rest.js"), "--format", "all"]);
    expect(all.status).toBe(0);
    // rest 槽恒可选 ⇒ standard 槽带 "optional":true（一层数组不变）
    expect(all.stdout).toContain('{"key":"rest","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(all.stdout).not.toContain('{"key":"rest","node":{"k":"arr","element":{"k":"arr"');
    expect(all.stdout).toContain("...rest: unknown[]");
  }
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
  it("`check clean.js --only <code> broken.js` ⇒ 定向 usage error + exit 1；对照：把 variadic 旗标放在 `--` 前、路径放后面 ⇒ 正常检查（不误报）", () => {
  {
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
      const both = runCli(["check", "clean.js", "broken.js"], { cwd });
      expect(both.status).toBe(1);

      // 缺陷形态：--only 吞掉 broken.js ⇒ 旧实现 exit 0（文件没被检查）
      const swallow = runCli(
        ["check", "clean.js", "--only", "nudo:entry-may-throw", "broken.js"],
        { cwd },
      );
      expect(swallow.status).toBe(1);
      expect(swallow.stderr).toContain("consumed the following path(s): broken.js");
      expect(swallow.stderr).toContain("--");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug046-ok-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b46b", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "clean.js"), CLEAN, "utf-8");
      writeFileSync(join(cwd, "broken.js"), BROKEN, "utf-8");
      const r = runCli(
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
  it("第二份 diff 以第一份为基准（累积），不是又一份「新建文件」；dry-run 的 diff 可被 `git apply --check -p1` 消费；dry-run 与 --write 得到同一份侧车内容", () => {
  {
    const cwd = makeProject("nudo-bug047-");
    try {
      const r = runCli(["check", "helper.js", "--fix"], { cwd });
      const hunks = r.stdout.split("\n").filter((l) => l.startsWith("@@ "));
      expect(hunks.length).toBeGreaterThanOrEqual(2);
      // 第一份 = 新建（空 → 2 行）；第二份必须**基于第一份**（1,2 → 1,3）
      expect(hunks[0]).toBe("@@ -0,0 +1,2 @@");
      expect(hunks[1]).toBe("@@ -1,2 +1,3 @@");
      expect(r.stdout).toContain("staticLabel");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject("nudo-bug047-apply-");
    try {
      const init = spawnSync("git", ["init", "-q", "."], { cwd, encoding: "utf8" });
      expect(init.status, `git init 失败: ${init.stderr}`).toBe(0);
      const r = runCli(["check", "helper.js", "--fix"], { cwd });
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(g.status, `git apply --check -p1 应成功（stderr: ${g.stderr}）`).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const dryCwd = makeProject("nudo-bug047-dry-");
    const writeCwd = makeProject("nudo-bug047-write-");
    try {
      const dry = runCli(["check", "helper.js", "--fix"], { cwd: dryCwd });
      expect(dry.status).toBe(1); // 残余 error ⇒ 门禁红
      const written = runCli(["check", "helper.js", "--fix", "--write"], {
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
  it("拼错的码 ⇒ usage error + exit 1（不再静默 no-op）；合法码但本次无该诊断 ⇒ 末尾报「matched no diagnostic」", () => {
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "helper.js", "--fix", "--only", "nudo:bogus-code"], {
        cwd,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("unknown diagnostic code(s): nudo:bogus-code");
      // 不能退化成「0 edit(s) planned」的静默形态
      expect(r.stdout).not.toContain("0 edit(s)");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "helper.js", "--fix", "--only", "nudo:arg-count"], {
        cwd,
      });
      expect(r.stdout).toContain("--only nudo:arg-count matched no diagnostic");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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

      const r = runCli(
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

      const before = runCli(["check", "foo.mjs"], { cwd });
      expect(errorCount(before.stdout)).toBe(1);

      const fix = runCli(["check", ".", "--fix", "--write"], { cwd });
      // 拒绝落盘必须可见（旧实现只报「1 edit(s) written, 1 applied」）
      expect(fix.stderr).toContain("refuses to write sidecar");
      expect(fix.stderr).toContain("shared with");
      expect(fix.stdout).toContain("sidecar write(s) refused");
      // 共享侧车没有被写出来（写了就会污染兄弟模块）
      expect(existsSync(join(cwd, "foo.nudo.js"))).toBe(false);

      const after = runCli(["check", "foo.mjs"], { cwd });
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


  it("用户导出 `z` + zod 段 import ⇒ 产物可编译（tsc --strict rc 0）；用户导出 `__nudoCheck`（standard 段的非导出 helper 同名）⇒ 不重复声明", () => {
  {
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

    const r = runCli(["export", join(dir, "zname.js"), "--format", "all"]);
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
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b075-helper-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "helper.js"),
      "export function __nudoCheck(x) {\n  return x;\n}\n__nudoCheck(1);\n",
      "utf-8",
    );
    const r = runCli(["export", join(dir, "helper.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // helper 在前、用户导出在后 ⇒ 用户侧让位（`Dts` 后缀），helper 只声明一次
    const helperDecls = (r.stdout.match(/^function __nudoCheck\b/gm) ?? []).length;
    expect(helperDecls).toBe(1);
    const nameDecls = (r.stdout.match(/__nudoCheck/g) ?? []).length;
    expect(nameDecls).toBeGreaterThan(1);
    // 没有「同名两份顶层声明」：用户导出被改名后不再与 helper 撞名
    expect(r.stdout).not.toMatch(/^export declare function __nudoCheck\(/m);
  }
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


  it("主路径：完全无证据的导出函数 ⇒ 参数 unknown，stderr 点名提示；主路径：契约只覆盖部分形参时，未覆盖位同样是 unknown；窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示", () => {
  {
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
  }
  {
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
  }
  {
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
  }
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


  it("test 文本面与 --json 面都带 nudo:recursion-truncated；check 面同码同源（跨面口径一致，info 不挡门禁）", () => {
  {
    const file = writeFixture();

    const text = runCli(["test", file]);
    expect(text.stdout).toContain(`(${CODE})`);
    expect(text.stdout).toContain("Recursive evaluation of 'loop'");

    const json = runCli(["test", file, "--json"]);
    const parsed = JSON.parse(json.stdout) as TestJson;
    const trunc = parsed.diagnostics.filter((d) => d.code === CODE);
    expect(trunc).toHaveLength(1);
    expect(trunc[0]!.severity).toBe("info");
    // summary 计数来自同一条数组 ⇒ 两面自洽（此前恒为 0）
    expect(parsed.summary.diagnostics).toBe(parsed.diagnostics.length);
  }
  {
    const file = writeFixture();
    const r = runCli(["check", file]);
    expect(r.stdout).toContain(`(${CODE})`);
    // 门禁仍由 L2 may-throw 决定：截断诊断是 info，不是新错误
    expect(r.stdout).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  }
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

{
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

  it("collectNudoFiles 不收 dist/ 与 coverage/ 下的文件（改前：收进来）；CLI check <pkg> 的文件集合里没有 dist/（改前：多出 dist/lib.js）；CLI test <pkg> 不因陈旧构建产物而红（改前：exit 1 假红）；跨面一致：CLI 目录发现与 IDE/vite 的 service 闸门对同一批文件给出相同结论", () => {
  {
    const pkg = makeFixture();
    const names = collectNudoFiles(pkg)
      .map((f) => f.split("/").slice(-2).join("/"))
      .sort();
    expect(names).toEqual(["src/lib.js"]);
  }
  {
    const pkg = makeFixture();
    const r = runCli(["check", pkg]);
    expect(r.stdout).not.toContain("dist/lib.js");
    expect(r.stdout).not.toContain("coverage/cov.js");
    expect(r.stdout).toContain("src/lib.js");
  }
  {
    const pkg = makeFixture();
    const r = runCli(["test", pkg]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("stale");
    expect(r.stdout).toContain("ok");
  }
  {
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
  }
});



}
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

/** 夹具：finite() 谓词不可投影 ⇒ 有 dropped 记录（与 BUG-181 同源）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1050-"));
  dirs.push(dir);
  const file = join(dir, "finite.js");
  writeFileSync(file, "export function retFinite() { return 5; }\n", "utf-8");
  writeFileSync(
    join(dir, "finite.nudo.js"),
    `import { fn, number } from "@nudojs/core";\nexport const retFinite = fn({}, number().finite());\n`,
    "utf-8",
  );
  return file;
}

/** 出现次数。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}


  it("--format standard：台账标题不再宣称 zod（没有 zod 产物）；--format all：zod 台账与 standard 台账各一次（标题不再同名重复）；--format dts：无台账（dts 面不携带 dropped 记录）", () => {
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// dropped preds (not projected into standard):");
    expect(r.stdout).not.toContain("not projected into zod");
    // 内容仍在（有损投影的披露通道不能丢）
    expect(r.stdout).toContain("retFinite");
    expect(r.stdout).toContain("not projected");
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /not projected into zod/g)).toBe(1);
    expect(count(r.stdout, /not projected into standard/g)).toBe(1);
  }
  {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("dropped preds");
  }
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
  it("路径不存在 ⇒ ok:false + summary.pathErrors = 1（summary.errors 仍只数诊断）；绿运行 ⇒ 不带 pathErrors 字段（JSON 形态不漂移）", () => {
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "--json", "nope.js"], { cwd });
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
  }
  {
    const cwd = makeProject();
    try {
      const r = runCli(["check", "--json", "ok.js"], { cwd });
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout) as Envelope;
      expect(env.ok).toBe(true);
      expect("pathErrors" in env.summary).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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


  // 口径（覆盖 的槽名部分）：解构形参**没有公共名**，`_p0` 是
  // 求值占位 ⇒ 公共面只允许源码里写得出来的键。解构形参因此按**字段名**建顶层
  // 键（= `.d.ts` 明文声明的调用形态 `f({ a, b })`）；普通形参仍按形参名建键。
  it("zod：解构形参按**字段名**建顶层键（不再是内部占位 `_p0`）；standard：解构形参的顶层槽是字段名（无占位名）；负控制：数组解构的字段级契约仍是元组（Bug 394 口径不变）", () => {
  {
    const dir = fixture();
    const r = runCli(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/export const destrInput = z\.object\(\{ a:/);
    expect(r.stdout).not.toContain("_p0");
    // 普通形参：形参名 `o` ⇒ 值是该对象的形状
    expect(r.stdout).toMatch(/export const plainInput = z\.object\(\{ o: z\.object\(\{ a:/);
  }
  {
    const dir = fixture();
    const r = runCli(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(inputNode(r.stdout, "destrInput")).toContain('"key":"a"');
    expect(inputNode(r.stdout, "destrInput")).not.toContain("_p0");
    expect(inputNode(r.stdout, "plainInput")).toContain('"key":"o","node":{"k":"obj"');
  }
  {
    const dir = fixture({
      "arr.js": "export function f7([a, b]) { return a; }\n",
      "arr.nudo.js": 'import { fn, number } from "@nudojs/core";\nexport const f7 = fn({ a: number() }, number());\n',
    });
    const r = runCli(["export", join(dir, "arr.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
  }
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
  it("同一缺失路径给两次 ⇒ 只登记一条错误；同一现场文件给两次 ⇒ 记录不重复（按调用点身份各一条）", () => {
  {
    const dir = tmpProject("nudo-171-");
    const missing = join(dir, "nope.js");
    const sink: PathError[] = [];
    collectExternalRecords([missing, missing], sink);
    expect(sink).toHaveLength(1);
  }
  {
    const dir = tmpProject("nudo-171-dup-", {
      "site.js": 'import { f } from "./lib.js";\nexport const v = f(1);\n',
      "lib.js": "export function f(a) { return a + 1; }\n",
    });
    const site = join(dir, "site.js");
    const once = collectExternalRecords([site], []);
    const twice = collectExternalRecords([site, site], []);
    expect(twice?.length ?? 0).toBe(once?.length ?? 0);
  }
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


  it("standard 段的槽键是原形参名（导出名让位，数据不动）；负控制：--out 落盘的 standard 产物槽键同样是原形参名（两条投递路径同结论）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCli(["export", join(dir, "collide.js"), "--format", "all"]);
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
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-out-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "collide.js"), "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    const artifact = readFileSync(join(out, name!), "utf-8");
    expect(artifact).toContain('{"key":"f1Input","node"');
  }
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


  it("同名两个模块 + 同模块重导 ⇒ 无编号副本、无陈旧内容；幂等重导：内容不变时仍是一份产物", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) {\n  return x + 1;\n}\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) {\n  return x + 2;\n}\nbeta(1);\n", "utf-8");

    const exportDts = (file: string) =>
      runCli(["export", file, "--format", "dts", "--out", out]);

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
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-idem-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) { return x + 1; }\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) { return x + 2; }\nbeta(1);\n", "utf-8");
    for (const f of ["a", "b", "b", "a"]) {
      expect(runCli(["export", join(dir, f, "lib.js"), "--format", "dts", "--out", out]).status).toBe(0);
    }
    expect(readdirSync(out).filter((f) => f.endsWith(".d.ts"))).toHaveLength(2);
  }
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
