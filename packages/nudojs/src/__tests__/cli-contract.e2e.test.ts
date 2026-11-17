/**
 * 模块套件：CLI 契约/守卫/health 协议面。
 *
 * 14 个原 part/entry 的用例按命令面归并：contract 装载/冲突/参数/返回契约、
 * guard 三面一致性、health 漂移、abs 侧车。缺陷编号只保留在 it 标题。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli, runCliTsx, repoRoot } from "./helpers/run-cli.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

// ---------------------------------------------------------------------------
// check --abs 必须与签名表同源地应用契约
// ---------------------------------------------------------------------------
describe("check --abs 必须与签名表同源地应用契约", () => {
/**
 * `nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` /
 * 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型：
 *
 * check → g(x: number) => string
 * check --abs → g(any) => any （旧行为）
 *
 * 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值
 * （core `effectiveContract` + `constraintToEntryAbs`，与 `checkSource`
 * 的侧车施加点同口径）。
 */







const LIB_JS = `export function g(x) { return x.toFixed(2); }\n`;
const LIB_NUDO = `import { fn, number, string } from "@nudojs/core";\nexport const g = fn({ x: number() }, string());\n`;
const PLUS_JS = `export function f(x) { return x + 1; }\n`;
const PLUS_NUDO = `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number());\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-692-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("侧车契约的形参进求值（不再回落 any）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO, "utf-8");
      const file = join(dir, "lib.js");
      const abs = await runAbsViewCaptured(file);
      expect(abs.stdout).toContain("g(number)");
      expect(abs.stdout).not.toContain("g(any)");
      expect(abs.stdout).toContain("string");
    });
  });

  it("算术函数的返回值随契约收窄（旧行为 number | string）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "plus.js"), PLUS_JS, "utf-8");
      writeFileSync(join(dir, "plus.nudo.js"), PLUS_NUDO, "utf-8");
      const file = join(dir, "plus.js");
      const abs = await runAbsViewCaptured(file);
      expect(abs.stdout).toContain("f(number)");
      expect(abs.stdout).not.toContain("f(any)");
      expect(abs.stdout).not.toContain("number | string");
    });
  });

  it("没有契约的文件：--abs 行为不变（不误伤）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "plain.js"), PLUS_JS, "utf-8");
      const abs = await runAbsViewCaptured(join(dir, "plain.js"));
      expect(abs.stdout).toContain("f(any)");
    });
  });

  it("CLI 级：签名表与 --abs 面给出同一个形参类型", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO, "utf-8");
      const file = join(dir, "lib.js");
      const sig = runCli(["check", file], { cwd: dir });
      expect(sig.stdout).toContain("g(x: number) => string");
      const abs = runCli(["check", file, "--abs"], { cwd: dir });
      expect(abs.stdout).toContain("g(number)");
      expect(abs.stdout).not.toContain("g(any)");
    });
  }, 30000);

});

// ---------------------------------------------------------------------------
// 只读 contract 不因 contract-conflict 改退出码
// ---------------------------------------------------------------------------
describe("只读 contract 不因 contract-conflict 改退出码", () => {
/**
 * 缺陷分册 04-contract-command · CLI 回归（）。
 *
 * 复现工程一律建在 /tmp 独立目录；CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx
 * 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物），
 * 目标文件用绝对路径传给 CLI。
 */






let root: string;
const p = (...parts: string[]): string => join(root, ...parts);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nudo-bug-contract-"));
  writeFileSync(
    p("package.json"),
    '{"name":"nudo-bug-contract","version":"1.0.0","type":"module"}\n',
  );

  // 手写契约合取不可满足（x > 0 ∧ x < 0）
  writeFileSync(p("b34.js"), "export function f(x) { return x; }\n");
  writeFileSync(p("b34.nudo.js"), "export const f = fn({ x: number().gt(0).lt(0) });\n");

  // 正常侧车 / 语法损坏的侧车（分两个文件，避免互相干扰）
  for (const tag of ["good", "bad"]) {
    writeFileSync(p(`${tag}.js`), "export function add(a, b) { return a + b; }\n");
  }
  writeFileSync(
    p("good.nudo.js"),
    'import { fn, number } from "@nudojs/core";\nexport const add = fn({ a: number(), b: number() });\n',
  );
  writeFileSync(p("bad.nudo.js"), "export const add = fn({ a: number().gt(0)  // broken\n");

  // 两个顶层导出
  writeFileSync(
    p("b101.js"),
    "export function add(a, b) { return a + b; }\n" +
      "export function word(s) { return s.toUpperCase(); }\n",
  );

  // 目录模式（两个 .d.ts）+ 单文件模式
  mkdirSync(p("dts"), { recursive: true });
  writeFileSync(p("dts", "a.d.ts"), "export declare function alpha(n: number): number;\n");
  writeFileSync(p("dts", "b.d.ts"), "export declare function beta(s: string): string;\n");
  mkdirSync(p("single"), { recursive: true });
  writeFileSync(p("single", "a.d.ts"), "export declare function alpha(n: number): number;\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));


  it("print：stderr 报同码 error，但 exit 0（§1.3 只在用法 / IO 错误时 exit 1）", () => {
    const print = runCliTsx(["contract", p("b34.js")]);
    expect(print.status).toBe(0);
    expect(print.stderr).toContain("nudo:contract-conflict");
    expect(print.stdout).toContain("[unsatisfiable: x]");
  }, 120000);

  it("--json：同样 exit 0，conflict 字段照旧透出", () => {
    const json = runCliTsx(["contract", p("b34.js"), "--json"]);
    expect(json.status).toBe(0);
    expect(json.stderr).toContain("nudo:contract-conflict");
    expect(json.stdout).toContain('"conflict"');
  }, 120000);


describe("坏侧车三面透出 nudo:contract-load（与 check/export 同裁决）", () => {
  it("好侧车对照：exit 0 + [handwritten]，stderr 无 contract-load", () => {
    const r = runCliTsx(["contract", p("good.js")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[handwritten]");
    expect(r.stderr).not.toContain("nudo:contract-load");
  }, 120000);

  it("print：stderr 报同码 + exit 1", () => {
    const pr = runCliTsx(["contract", p("bad.js")]);
    expect(pr.status).toBe(1);
    expect(pr.stderr).toContain("nudo:contract-load");
  }, 120000);

  it("--json：stderr + exit 1，载荷带 diagnostics 字段", () => {
    const js = runCliTsx(["contract", p("bad.js"), "--json"]);
    expect(js.status).toBe(1);
    expect(js.stderr).toContain("nudo:contract-load");
    expect(js.stdout).toContain('"diagnostics"');
    expect(js.stdout).toContain("nudo:contract-load");
  }, 120000);

  it("--draft：stderr 报同码 + exit 1（不再按「无契约」静默起草）", () => {
    const dr = runCliTsx(["contract", "--draft", p("bad.js")]);
    expect(dr.status).toBe(1);
    expect(dr.stderr).toContain("nudo:contract-load");
  }, 120000);
});

describe("打印面 --fn / --all 生效（不再静默忽略）", () => {
  it("--fn add 只输出 add；--all 全量", () => {
    const f = p("b101.js");
    const json = runCliTsx(["contract", f, "--json", "--fn", "add"]);
    expect(json.status).toBe(0);
    expect(json.stdout).toContain('"add"');
    expect(json.stdout).not.toContain('"word"');

    const pr = runCliTsx(["contract", f, "--fn", "add"]);
    expect(pr.status).toBe(0);
    expect(pr.stdout).toContain("  add  ");
    expect(pr.stdout).not.toContain("  word  ");

    const all = runCliTsx(["contract", f, "--json", "--all"]);
    expect(all.status).toBe(0);
    expect(all.stdout).toContain('"word"');
  }, 120000);

  it("--fn 未命中 / --fn + --all 组合：显式 usage error + exit 1", () => {
    const f = p("b101.js");
    const miss = runCliTsx(["contract", f, "--json", "--fn", "nope"]);
    expect(miss.status).toBe(1);
    expect(miss.stdout).toContain("nudo:usage-error");

    const both = runCliTsx(["contract", f, "--json", "--fn", "add", "--all"]);
    expect(both.status).toBe(1);
    expect(both.stdout).toContain("nudo:usage-error");
  }, 120000);
});

describe("多 .d.ts 合并草稿逐导出点名接受目标", () => {
  it("--write：beta 指向 b.d.ts 自己的模块侧车，不再只给第一个文件", () => {
    const draft = p("dts", "a.nudo.draft.ts");
    if (existsSync(draft)) rmSync(draft);
    const r = runCliTsx(["contract", "--from-dts", p("dts"), "--write"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no single accept target");
    expect(r.stdout).toContain("beta");
    expect(r.stdout).toContain("b.d.ts");
    expect(r.stdout).toContain("b.nudo.ts");
    expect(r.stdout).toContain("alpha");
    expect(r.stdout).toContain("a.d.ts");
    // 旧提示「copy accepted exports into <anchor>」不再出现
    expect(r.stdout).not.toContain("copy accepted exports into");
  }, 120000);

  it("单文件模式：next 提示逐字不变（既有钉不回退）", () => {
    const draft = p("single", "a.nudo.draft.ts");
    if (existsSync(draft)) rmSync(draft);
    const r = runCliTsx(["contract", "--from-dts", p("single", "a.d.ts"), "--write"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("copy accepted exports into");
    expect(r.stdout).not.toContain("no single accept target");
  }, 120000);
});
});

// ---------------------------------------------------------------------------
// export — 契约合取不可满足时报错退出（）
// ---------------------------------------------------------------------------
describe("export — 契约合取不可满足时报错退出（）", () => {
/**
 * 契约**合取不可满足**（源码 `@nudo:contract` 与同名侧车约束互相
 * 矛盾）时，export 面照样发布产物：zod 面只编码了**一半**契约（源码侧那条
 * 约束被丢掉），消费方拿到一个**永远校验不过**的输入校验器；stderr 零提示。
 *
 * 根因：export 面不看契约冲突（`nudo:contract-conflict` 只在 check 面产出）。
 *
 * 钉：契约冲突 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */






/** 源码契约（正数）与同名侧车（非正数）矛盾 ⇒ 合取不可满足。 */
function writeConflictFixture(dir: string): void {
  writeFileSync(
    join(dir, "shapes.nudo.js"),
    `import { string } from "@nudojs/core";
export const txt = string();
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "conflict.nudo.js"),
    `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() });
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "conflict.js"),
    `/// @nudo:import { txt } from "./shapes.nudo.js"
/**
 * @nudo:contract x txt
 */
export function f(x) {
  return x;
}
`,
    "utf-8",
  );
}


  it("stderr 上屏 nudo:contract-conflict 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-"));
    writeConflictFixture(dir);

    const r = runCli(["export", join(dir, "conflict.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-conflict");
    // 真实诊断带上函数名与冲突的参数位
    expect(r.stderr).toContain("f");
    expect(r.stderr).toContain("x");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-out-"));
    writeConflictFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "conflict.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-conflict");
    expect(existsSync(out)).toBe(false);
  });

  it("诊断码与 check 面同码", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-check-"));
    writeConflictFixture(dir);

    const check = runCli(["check", join(dir, "conflict.js")]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("nudo:contract-conflict");

    const exp = runCli(["export", join(dir, "conflict.js"), "--format", "dts"]);
    expect(exp.status).toBe(1);
    expect(exp.stderr).toContain("nudo:contract-conflict");
  });

});

// ---------------------------------------------------------------------------
// export — 有参数契约无返回契约的返回面（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 有参数契约无返回契约的返回面（族 17 · S1 · ）", () => {
/**
 * 有**参数契约、无返回契约**时，返回面回退到**无约束**的 `entry@`
 * 观测（缺 dts 面的种子重算）⇒ 返回位毫无信息，且与 dts / check 面矛盾。
 *
 * 症状（改前）：`@nudo:contract x num`（无返回契约）的函数，zod 面的
 * `<fn>Output` = `z.union([z.number()…, z.string()])`（**无约束入口**观测）
 * 而 dts 面（做了契约种子重算）是 `g(x: number): number` ⇒ 两个产物面矛盾，
 * 运行时校验器还会拒掉合法返回值。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面在无返回契约时直接
 * 取 `fn.combinedAbs`（无约束入口观测），没有走 dts 面的**契约域种子重算**。
 *
 * 修法（族 17 · S1）：无返回契约但**有参数契约**时，先用契约参数作种子重算
 * 一次返回位（与 dts 面 / check 面同一条路径），重算失败才回落观测面。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-612-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;


  it("zod 返回面不再是「无约束入口」观测（不再是 number | string）", () => {
    const dir = fixture({
      "c612.nudo.js": NUM,
      "paronly612.js": [
        `/// @nudo:import { num } from "./c612.nudo.js"`,
        `/** @nudo:contract x num */`,
        `export function g(x) { return x + 1; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "paronly612.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gOutput");
    // 契约域种子重算 ⇒ 返回位是 number（改前是无约束入口观测 number | string）
    expect(r.stdout).not.toContain("z.string()");
    expect(r.stdout).toContain("z.number()");
  }, 30000);

  it("dts 面与 zod 面同口径（返回位都是契约域的 number）", () => {
    const dir = fixture({
      "c612b.nudo.js": NUM,
      "paronly612b.js": [
        `/// @nudo:import { num } from "./c612b.nudo.js"`,
        `/** @nudo:contract x num */`,
        `export function g(x) { return x + 1; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "paronly612b.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function g(x: number): number;");
  }, 30000);

});

// ---------------------------------------------------------------------------
// export — 侧车装载失败时报错退出（）
// ---------------------------------------------------------------------------
describe("export — 侧车装载失败时报错退出（）", () => {
/**
 * 侧车（`*.nudo.js`）装载失败时，export 面**静默降级**：契约整条
 * 丢失 ⇒ 产物面把「未申报」当「无约束」发布（zod 面落 `z.unknown()`），而
 * stderr **零提示**、exit 0 ⇒ 消费方拿到一份比「没有契约」更危险的校验器。
 *
 * 根因：export 面不看 check 面的 `nudo:contract-load` 诊断 ⇒ 装载失败无人上屏。
 *
 * 钉：侧车装载失败 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */






/** 侧车在装载期抛错 ⇒ `nudo:contract-load`（契约整条丢失）。 */
function writeBrokenSidecarFixture(dir: string): void {
  writeFileSync(
    join(dir, "badload.nudo.js"),
    `import { number } from "@nudojs/core";
export const num = number();
throw new Error("sidecar boom");
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "badload.js"),
    `/// @nudo:import { num } from "./badload.nudo.js"
/**
 * @nudo:contract a num
 */
export function f(a) {
  return a;
}
`,
    "utf-8",
  );
}


  it("stderr 上屏 nudo:contract-load 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-"));
    writeBrokenSidecarFixture(dir);

    const r = runCli(["export", join(dir, "badload.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-load");
    // 真实原因上屏（侧车路径 + 失败原因）
    expect(r.stderr).toContain("badload.nudo.js");
    expect(r.stderr).toContain("sidecar boom");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-out-"));
    writeBrokenSidecarFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "badload.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-load");
    expect(existsSync(out)).toBe(false);
  });

  it("诊断文案与 check 面同码同因（nudo check 也报 contract-load）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-check-"));
    writeBrokenSidecarFixture(dir);

    const check = runCli(["check", join(dir, "badload.js")]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("nudo:contract-load");

    const exp = runCli(["export", join(dir, "badload.js"), "--format", "dts"]);
    expect(exp.status).toBe(1);
    expect(exp.stderr).toContain("nudo:contract-load");
  });

});

// ---------------------------------------------------------------------------
// export — 契约形参名与形参表不匹配时报错退出（）
// ---------------------------------------------------------------------------
describe("export — 契约形参名与形参表不匹配时报错退出（）", () => {
/**
 * 契约形参名与声明形参表**对不上**时，export 面照样发布产物
 * （zod 面把契约位的名字原样搬进 `<fn>Input` ⇒ 消费方拿到一个**参数名与函数
 * 签名不一致**的校验器），且 stderr **一个字都没有**。
 *
 * 根因：export 面不看 check 面的契约一致性诊断（`nudo:contract-param-mismatch`
 * 只在 check 面产出）⇒ 契约与产物面对不上时无人上屏。
 *
 * 钉：契约形参名不在形参表 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */







  it("stderr 上屏 nudo:contract-param-mismatch 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug607-"));
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
      "utf-8",
    );
    // 契约说 a，函数签名是 y ⇒ 形参名对不上
    writeFileSync(
      join(dir, "mismatch.js"),
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(y) {
  return y;
}
`,
      "utf-8",
    );

    const r = runCli(["export", join(dir, "mismatch.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-param-mismatch");
    // 真实诊断带上函数名与错位的形参名
    expect(r.stderr).toContain("g");
    expect(r.stderr).toContain("x");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug607-out-"));
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "mismatch.js"),
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(y) {
  return y;
}
`,
      "utf-8",
    );

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "mismatch.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:contract-param-mismatch");
    expect(existsSync(out)).toBe(false);
  });

});

// ---------------------------------------------------------------------------
// guard 面消费契约返回域（不再按单次 case 字面量收窄）
// ---------------------------------------------------------------------------
describe("guard 面消费契约返回域（不再按单次 case 字面量收窄）", () => {
/**
 * `nudo export --format guard` 忽略**契约返回域**，按单次 case 字面量出守卫。
 *
 * 症状（改前）：函数声明了 `@nudo:contract return unit01`（返回域 = number
 * 区间 [0,1]），同一文件 `@nudo:case` 见证返回 `0.5` ⇒ guard 生成
 * `return data === 0.5;` —— 一个对**所有合法返回值**（0.7 / 0 / 1）都会拒绝的
 * 守卫；而同一次导出的 zod 面按契约投影（`z.number().gte(0).lte(1)`）⇒ 两个
 * 产物面口径分裂。
 *
 * 根因：guard 分支另起炉灶取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`），
 * 完全绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。
 *
 * 修法（族 17 · S2）：`export/guard-face.ts` 的 `guardFaceChunk` 改为消费调度器
 * 传入的**统一返回面**（`outputAbs`）⇒ 与 zod / standard / dts 三个面同口径。
 *
 * 注：夹具的实现**满足**返回契约（返回 0.5，契约域 = number [0,1]）⇒ 契约面
 * 是出口域；若实现**违约**（返回域与实现矛盾），族 17 · S1 的违约复核
 * （）会让**四个面**一起回落实现实际的返回形态（那时不存在跨面分裂）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-599-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/**
 * 夹具：返回契约 = number 区间 [0,1]（`unit01`），实现返回 0.5（**满足**契约）。
 *
 * 改前 guard = `data === 0.5`（观测字面量）；改后 = 契约域
 * （`data >= 0 && data <= 1`）。
 */
const CONTRACT_RETURN_FILES = {
  "tpl.nudo.js": `export const unit01 = number().ge(0).le(1);\n`,
  "lib.js": [
    `/// @nudo:import { unit01 } from "./tpl.nudo.js"`,
    ``,
    `/**`,
    ` * @nudo:case "c" (0.5) => 0.5`,
    ` * @nudo:contract return unit01`,
    ` */`,
    `export function clamp01(x) {`,
    `  return 0.5;`,
    `}`,
    ``,
  ].join("\n"),
};


  it("guard 不再收窄成观测字面量（改前：data === 0.5）", () => {
    const dir = fixtureDir(CONTRACT_RETURN_FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export function isclamp01Output");
    expect(r.stdout).not.toContain("data === 0.5");
    // 契约域 = number [0,1] ⇒ 守卫按区间判定
    expect(r.stdout).toContain("data >= 0");
    expect(r.stdout).toContain("data <= 1");
  }, 30000);

  it("guard 与 zod 面同一出口域（zod = 契约域，guard = 契约域）", () => {
    const dir = fixtureDir(CONTRACT_RETURN_FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const schema = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
    // zod 面（契约域）：Output = number [0,1]
    expect(schema.stdout).toContain("export const clamp01Output = z.number()");
    expect(schema.stdout).toContain(".gte(0)");
    expect(schema.stdout).toContain(".lte(1)");
    // guard 面（契约域）：同一出口域，不再是单点字面量
    expect(guard.stdout).not.toContain("data === 0.5");
    expect(guard.stdout).toContain("data >= 0");
    expect(guard.stdout).toContain("data <= 1");
  }, 30000);

});

// ---------------------------------------------------------------------------
// guard 面与 zod 面同一出口域（同一次导出、同一裁决）
// ---------------------------------------------------------------------------
describe("guard 面与 zod 面同一出口域（同一次导出、同一裁决）", () => {
/**
 * `nudo export` 的 **guard 面无视契约**：守卫取「单次调用点字面量」
 * 而 zod / standard 取「契约域」⇒ 同一次导出里两个面**对同一个值给出相反裁决**。
 *
 * 症状（改前，夹具 = 返回契约 number[0,1] + case 见证 0.5）：
 * zod 面 → `clamp01Output = z.number().gte(0).lte(1)`（契约域）
 * guard 面 → `return data === 0.5;`（观测字面量）
 * ⇒ 值 0.7：zod **接受**、guard **拒绝**（同一命令、同一个函数、同一个值）。
 *
 * 根因：guard 分支取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`），
 * 绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。
 *
 * 修法（族 17 · S2）：`export/guard-face.ts` 的 `guardFaceChunk` 消费调度器传入
 * 的 `outputAbs` ⇒ guard 与 zod / standard / dts 三个面同一出口域。
 *
 * 本钉把「同一次导出、两个面、同一个值」的裁决**真的跑一遍**（把生成的守卫
 * 去掉类型标注后用 `new Function` 求值），而不是只比字符串。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-613-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 夹具：返回契约 = number[0,1]；实现返回 0.5（满足契约 ⇒ 契约面是出口域） */
const FILES = {
  "tpl.nudo.js": `export const unit01 = number().ge(0).le(1);\n`,
  "lib.js": [
    `/// @nudo:import { unit01 } from "./tpl.nudo.js"`,
    ``,
    `/**`,
    ` * @nudo:case "c" (0.5) => 0.5`,
    ` * @nudo:contract return unit01`,
    ` */`,
    `export function clamp01(x) {`,
    `  return 0.5;`,
    `}`,
    ``,
  ].join("\n"),
};

/** 从导出产物里取出守卫函数源码（`export function is<fn>Output(…) { … }`）。 */
function guardSource(stdout: string): string {
  const m = /export function is\w+Output\(value: unknown\): boolean \{[\s\S]*?\n\}/.exec(stdout);
  if (!m) throw new Error(`产物里没有守卫函数：\n${stdout}`);
  return m[0];
}

/**
 * 守卫产物是 TS 源码 ⇒ 去掉类型标注后求值（只为把「裁决」跑出来）。
 * 产物形态固定：`export function isXOutput(value: unknown): boolean { const data = value as T; … }`
 */
function evalGuard(src: string): (value: unknown) => boolean {
  const js = src
    .replace(/export\s+function\s/, "function ")
    .replace(/\(\s*value:\s*unknown\s*\)\s*:\s*boolean/, "(value)")
    .replace(/value as [^;]+;/, "value;");
  return new Function(`return (${js});`)() as (value: unknown) => boolean;
}


  it("契约允许的值（0.7）guard 接受（改前：guard 拒绝，zod 接受）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    const isOutput = evalGuard(guardSource(r.stdout));
    // 契约域 number[0,1] ⇒ 0.7 / 0 / 1 合法，2 / "0.5" 非法
    expect(isOutput(0.7)).toBe(true);
    expect(isOutput(0)).toBe(true);
    expect(isOutput(1)).toBe(true);
    expect(isOutput(2)).toBe(false);
    expect(isOutput("0.5")).toBe(false);
  }, 30000);

  it("zod 面判同一组值 ⇒ 与 guard 面裁决一致（不再一个接受一个拒绝）", () => {
    const dir = fixtureDir(FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const schema = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
    // zod 面 = 契约域（number[0,1]）
    expect(schema.stdout).toContain("export const clamp01Output = z.number()");
    expect(schema.stdout).toContain(".gte(0)");
    expect(schema.stdout).toContain(".lte(1)");
    // guard 面 = 同一出口域（改前是 `data === 0.5` ⇒ 对 0.7 拒绝）
    const isOutput = evalGuard(guardSource(guard.stdout));
    expect(isOutput(0.7)).toBe(true);
  }, 30000);

  it("守卫源码不再是单点字面量判定（改前：data === 0.5）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.stdout).not.toContain("data === 0.5");
    expect(r.stdout).toContain("data >= 0");
    expect(r.stdout).toContain("data <= 1");
  }, 30000);

});

// ---------------------------------------------------------------------------
// guard 面守导出面闸门（内部函数不出守卫）
// ---------------------------------------------------------------------------
describe("guard 面守导出面闸门（内部函数不出守卫）", () => {
/**
 * `nudo export --format guard` **不守导出面闸门** ⇒ 被裁剪掉的模块内部
 * 函数照样产出运行时守卫（`isinternalHelperOutput`），而同一��导出里 .d.ts 面
 * 静默没有这个函数 ⇒ 产物面互相矛盾（内部实现泄漏成对外承诺）。
 *
 * 根因：导出面过滤（`onExportFace`）此前只装在 **dts 分支**，guard 分支不裁剪。
 *
 * 修法：**导出面闸门装在循环入口**（`export/selection.ts` 的
 * `selectPublicFunctions` —— 四个产物面共用一道闸门，安装点归族 17 · S3）⇒
 * guard 分支收到的函数已是导出面函数。本片（族 17 · S2）不另装闸门，只**消费**
 * 循环入口那道闸门 ⇒ 本钉是回归钉。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-628-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 夹具：一个导出函数 + 一个**未导出**的模块内部函数（两者都有 case 见证） */
const FILES = {
  "lib.js": [
    `/**`,
    ` * @nudo:case "c" (1) => "Ada"`,
    ` */`,
    `export function getName(user) {`,
    `  return user.name;`,
    `}`,
    ``,
    `/**`,
    ` * @nudo:case "c" (3) => 4`,
    ` */`,
    `function internalHelper(x) {`,
    `  return x + 1;`,
    `}`,
    ``,
  ].join("\n"),
};


  it("guard 产物只有导出面函数的守卫（改前：内部函数也出守卫）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export function isgetNameOutput");
    expect(r.stdout).not.toContain("isinternalHelperOutput");
    expect(r.stdout).not.toContain("internalHelper");
  }, 30000);

  it("guard 面与 dts 面口径一致（都只认导出面）", () => {
    const dir = fixtureDir(FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const dts = runCliTsx(["export", "lib.js", "--format", "dts"], { cwd: dir });
    expect(dts.stdout).toContain("getName");
    expect(dts.stdout).not.toContain("internalHelper");
    expect(guard.stdout).not.toContain("internalHelper");
  }, 30000);

});

// ---------------------------------------------------------------------------
// contract drift 摘要数与明细行同量纲（槽数）
// ---------------------------------------------------------------------------
describe("contract drift 摘要数与明细行同量纲（槽数）", () => {
/**
 * `nudo health` 的 `contract drift` 摘要数用**文件数**、明细行用
 * **槽数** ⇒ 同一份报告里两个 N 量纲不同（多文件时更明显）。
 *
 * 修复：摘要数 = Σ 各文件的槽数（与明细行、与 `files[].contractDrift` 同口径）。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

const LIB = `export function f(x) { return x; }
export function g(x) { return x; }
f(1);
g(1);
`;

/** 同文件两个 `@generated` 段都陈旧（各 2 个槽 ⇒ 4 个槽） */
const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
export const f = fn({ x: number().gt(0) }, number().gt(0));
// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:g
export const g = fn({ x: number().gt(0) }, number().gt(0));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-039-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("lib.nudo.js"), SIDECAR);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("文本面：Summary 的 N == 明细行「N @generated slot(s)」", () => {
    const r = runCliTsx(["health", p("lib.js")], { cwd: dir });
    expect(r.status).toBe(1);
    const detail = /contract drift: (\d+) @generated slot\(s\)/.exec(r.stdout);
    const summary = /(\d+) contract drift/.exec(r.stdout);
    expect(detail, r.stdout).not.toBeNull();
    expect(summary, r.stdout).not.toBeNull();
    const detailN = Number(detail![1]);
    const summaryN = Number(summary![1]);
    expect(detailN).toBeGreaterThan(0);
    // 旧行为：明细 4 / 摘要 1（「1 个文件」被印成「1 个槽」）
    expect(summaryN).toBe(detailN);
  }, 60_000);

  it("--json 面：summary.contractDrift == files[].contractDrift（同一数字）", () => {
    const r = runCliTsx(["health", "--json", p("lib.js")], { cwd: dir });
    const json = JSON.parse(r.stdout) as {
      files: Array<{ contractDrift?: number }>;
      summary: { contractDrift: number };
    };
    expect(json.files[0]?.contractDrift).toBeGreaterThan(0);
    expect(json.summary.contractDrift).toBe(json.files[0]?.contractDrift);
  }, 60_000);

});

// ---------------------------------------------------------------------------
// health --from 的契约漂移判定与 check 同口径
// ---------------------------------------------------------------------------
describe("health --from 的契约漂移判定与 check 同口径", () => {
/**
 * `nudo health --from` 的 **contract-drift** 闸门拿不到 `--from` 证据
 * ⇒ 同一份陈旧生成段：`nudo check` 报 `nudo:contract-drift`，`nudo health` 报
 * 「0 contract drift」并 exit 0（跨动词结论矛盾 + 假绿）。
 *
 * 修复：`countContractDrift` 把 `--from` 的可归因调用点记录接进
 * `checkSource` 的 `opts.from`（与 `nudo check` 的 `checkSourceOptions.from` 同源）。
 */






let dir: string;
const p = (f: string): string => join(dir, f);

const LIB = `export function addOne(x) {
  return String(x) + "!";
}
`;

/** 陈旧的生成段：返回仍是 lit(6)，今日应是 "5!" */
const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:addOne
export const addOne = fn({ x: lit(5) }, lit(6));
`;

/** 调用点在**另一个文件**里（--from 证据） */
const USAGE = `import { addOne } from "./lib.js";
addOne(5);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-054-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("lib.nudo.js"), SIDECAR);
  writeFileSync(p("usage.js"), USAGE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("跨文件调用点证据在场 ⇒ 报 contract drift + exit 1（旧行为：0 drift / exit 0）", () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")], { cwd: dir });
    expect(r.stdout, r.stdout).toMatch(/contract drift: [1-9]\d* @generated slot\(s\)/);
    expect(r.stdout).not.toContain("0 contract drift");
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.status).toBe(1);
  }, 60_000);

  it("--json 面：summary.contractDrift > 0（机器面同源）", () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage.js")], { cwd: dir });
    const json = JSON.parse(r.stdout) as { ok: boolean; summary: { contractDrift: number } };
    expect(json.ok).toBe(false);
    expect(json.summary.contractDrift).toBeGreaterThan(0);
  }, 60_000);

});

// ---------------------------------------------------------------------------
// health 的契约漂移判定必须走 mock 通道
// ---------------------------------------------------------------------------
describe("health 的契约漂移判定必须走 mock 通道", () => {
/**
 * `nudo health` 的**契约漂移判定**不施加 **mock 通道** ⇒ 同一份陈旧
 * 生成段，`nudo check` 报 `nudo:contract-drift`，`nudo health` 报 0 contract
 * drift / OK / exit 0（假绿 + 跨动词自相矛盾）。
 *
 * 口径：health 的契约漂移判定与 `nudo check` **同口径**（同一注入包装配：
 * 模块图 + mocks + env 全局 + replace/as）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

/** mock 通道：`fetch` 被 mock ⇒ 返回 { id } ⇒ 推断返回 number */
const MOCKED = `// @nudo:mock fetch = (url) => ({ id: url })
export function f(n) {
  return fetch(n).id;
}
f(2);
`;

/** 陈旧生成段：断言返回 lit(99)，与今日推断不符 */
const STALE_SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: m.js:f
export const f = fn({ n: lit(2) }, lit(99));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-691-"));
  writeFileSync(p("m.js"), MOCKED);
  writeFileSync(p("m.nudo.js"), STALE_SIDECAR);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("文本面：报 contract drift + exit 1（不得 0 contract drift / Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("m.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stdout).toContain("contract drift");
  });

  it("--json 面：contractDrift ≥ 1", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("m.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ contractDrift?: number }>;
      summary: { contractDrift: number };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.files[0].contractDrift ?? 0).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.contractDrift).toBeGreaterThanOrEqual(1);
  });

  it("跨动词同口径：nudo check 对同一文件同样报 nudo:contract-drift", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", p("m.js")]);
    expect(r.stdout).toContain("nudo:contract-drift");
  });

});

// ---------------------------------------------------------------------------
// export — 返回契约不影响参数面（回归钉）
// ---------------------------------------------------------------------------
describe("export — 返回契约不影响参数面（回归钉）", () => {
/**
 * `nudo export --format standard` 在「**只有返回契约**」时整份参数面
 * 丢失（standard 面一个 `<fn>_<param>` 导出都不产）⇒ 同一次导出里 zod / dts /
 * standard 三个方言的**参数个数互相矛盾**。
 *
 * 该缺陷已修（standard 面的参数位统一取统一参数面 `paramExps`，契约返回位不再
 * 压掉观测参数位）——本文件只补**跨方言一致性回归钉**，防止再次回退。
 *
 * 钉：zod `<fn>Input` 槽数 == dts 形参数 == standard `<fn>_<param>` 导出数。
 */






/** 有返回契约 + 一个形参的导出函数。 */
function writeReturnContractFixture(dir: string): void {
  // 契约段必须是**合法**约束名（`num`）；`number()` 是调用式，会被判
  // `nudo:contract-syntax`，而 之后那条诊断会阻断 export（本用例的
  // 意图是参数面，不是非法契约，所以给一份合法契约 + 侧车定义）。
  writeFileSync(
    join(dir, "withRet.nudo.js"),
    "export const num = number();\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "withRet.js"),
    `/// @nudo:import { num } from "./withRet.nudo.js"
/**
 * @nudo:case "one" (1) => number()
 * @nudo:contract return num
 */
export function withRet(a) {
  return a;
}
`,
    "utf-8",
  );
}


  it("standard 面仍产出参数位（<fn>_<param>）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug615-"));
    writeReturnContractFixture(dir);

    const r = runCli(["export", join(dir, "withRet.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("withRet_a");
  });

  it("跨方言参数个数一致（zod 槽数 == dts 形参数 == standard 参数导出数）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug615-parity-"));
    writeReturnContractFixture(dir);

    const r = runCli(["export", join(dir, "withRet.js"), "--format", "all"]);
    expect(r.status).toBe(0);

    // zod 面：<fn>Input 的槽数 = 1（形参 a）
    const input = /export const withRetInput = z\.object\(\{([\s\S]*?)\}\)/.exec(r.stdout);
    expect(input).not.toBeNull();
    const zodSlots = (input![1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(zodSlots).toHaveLength(1);

    // dts 面：形参数 = 1
    const dts = /export declare function withRet\(([^)]*)\)/.exec(r.stdout);
    expect(dts).not.toBeNull();
    const dtsFormals = (dts![1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(dtsFormals).toHaveLength(1);

    // standard 面：`<fn>_<param>` 导出数 = 1
    const stdParams = [...r.stdout.matchAll(/export const withRet_([A-Za-z_$][\w$]*) =/g)].map(
      (m) => m[1]!,
    );
    expect(stdParams).toHaveLength(1);
    expect(stdParams[0]!.startsWith("a")).toBe(true);

    // 三个方言的参数个数一致
    expect(zodSlots).toHaveLength(dtsFormals.length);
    expect(stdParams).toHaveLength(dtsFormals.length);
  });

});

// ---------------------------------------------------------------------------
// export — 返回契约投影前复核实现（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 返回契约投影前复核实现（族 17 · S1 · ）", () => {
/**
 * 导出面把**契约返回约束**当「已证成的事实」直接投影：投影前没有
 * 复核实现 ⇒ 产物声明一个实现**可被证否**的返回类型。
 *
 * 症状（改前）：`@nudo:contract return txt`（string）而实现返回入参（number）
 * ⇒ zod 面产出 `fOutput = z.string()`、dts 面产出
 * `export declare function f(x: number): string;`
 * —— 与实现矛盾（运行时校验器会把合法返回值判非法）。而 check 面在同一份源码
 * 上报 `nudo:constraint-violated`（返回位 ⊭ 契约）⇒ 门禁与产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面在有返回契约时直接
 * 返回契约 Abs，**不复核实现**。
 *
 * 修法（族 17 · S1）：投影前复核实现（契约域种子重算 / 观测返回 vs 契约约束的
 * 决定性比较）⇒ 实现违约时**不投影契约**，回落实现实际的返回形态。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-626-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：string 的纯数据形态 */
const TXT = `export const txt = { __nudoConstraint: true, prim: "string", preds: [] };\n`;

const SOURCE = [
  `/// @nudo:import { txt } from "./c626.nudo.js"`,
  `/** @nudo:contract return txt */`,
  `export function f(x) { return x; }`,
  `f(1);`,
  ``,
].join("\n");


  it("zod 返回面：违约的契约不投影（回落实现实际返回）", () => {
    const dir = fixture({ "c626.nudo.js": TXT, "violate626.js": SOURCE });
    const r = runCliTsx(["export", join(dir, "violate626.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("fOutput = z.string()");
    expect(r.stdout).toContain("fOutput = z.literal(1)");
  }, 30000);

  it("dts 返回类型与实现一致（不是被证否的契约）", () => {
    const dir = fixture({ "c626.nudo.js": TXT, "violate626.js": SOURCE });
    const r = runCliTsx(["export", join(dir, "violate626.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(x: number): number;");
  }, 30000);

});
