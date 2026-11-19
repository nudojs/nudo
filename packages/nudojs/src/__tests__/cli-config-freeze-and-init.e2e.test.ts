/**
 * 模块套件：cli-config-freeze-and-init（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, runCliNode as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { findProjectConfig } from "@nudojs/service";
import { runInit } from "../commands/init.ts";


// ---------------------------------------------------------------------------
// `nudo test --freeze <path>` 不得把路径吞成取值
// ---------------------------------------------------------------------------
describe("`nudo test --freeze <path>` 不得把路径吞成取值", () => {
/**
 * `nudo test --freeze <path>`（旗标在前、路径在后——CLI 的惯用形式）
 * 把路径吞成 `--freeze` 的**取值** ⇒ 必然报「needs at least one path」⇒ 该功能
 * 在文档/惯例给出的调用形式下**不可达**。
 *
 * 根因：`commands/test.ts` 的 `.option("--freeze [mode]")` 是 commander 的
 * **可选取值**形式（全 CLI 唯一一处）⇒ 紧跟其后的非选项参数被当成取值。
 *
 * 修复：取值加**白名单**（`update` / `add`，与 `--help` 承诺一致）——白名单外
 * 的字符串**不是模式**，它是**路径** ⇒ 还原成路径 + 省略取值（默认 add）。
 */






const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;


  it("旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）；白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-018-"));
    const file = join(dir, "lib.js");
    try {
      writeFileSync(file, SRC, "utf-8");
      const r = runCliTsx(["test", "--freeze", file], { cwd: dir });
      expect(r.stderr, `stderr=${r.stderr}`).not.toContain("needs at least one path");
      expect(r.status, `stderr=${r.stderr}`).toBe(0);
      // 见证真的写回了源码（不是「静默什么都不做」）
      expect(readFileSync(file, "utf-8")).toContain('@nudo:case "call@L4"');
      expect(r.stdout).toContain("freeze →");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-018b-"));
    try {
      const r = runCliTsx(["test", "--freeze", "update"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("needs at least one path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});


// ---------------------------------------------------------------------------
// --freeze=update 的见证坐标
// ---------------------------------------------------------------------------
describe("--freeze=update 的见证坐标", () => {
/**
 * `nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回：
 *
 * - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的
 * 调用点在第 5 行，但写回的文件里它在第 8 行；
 * - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；
 * - ③ `--freeze` 运行里报告的行号相对真实文件整体偏移（少掉被剥离的行数）；
 * - ④ 已冻结的指令 case 在 `--freeze` 运行里整个消失（剥离后再没被分析）。
 *
 * 契约：写盘文本里的 `call@L<n>` 必须指向**该文件**里真实的调用点行号；
 * 更新幂等（第二次不改写）；更新运行的展示面必须含已冻结的指令 case
 * （不是剥离坐标系的 entry@ 偏移视图）。
 */






const CALL = "add(1, 2);";

const BASE = `export function add(a, b) {
  return a + b;
}
${CALL}
`;

/** 直接在源文件里造一个「已冻结」块（3 行） + 可选空行把调用点推远。 */
function frozenFile(claimedLine: number, blankLinesAfterDecl = 0): string {
  const blanks = "\n".repeat(blankLinesAfterDecl);
  return `/**
 * @nudo:case "call@L${claimedLine}" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
${blanks}${CALL}
`;
}

function project(text: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug19-"));
  const file = join(dir, "add.js");
  writeFileSync(file, text);
  return { dir, file };
}

/** 文件里真实调用点的行号（1-based） */
function callLine(text: string): number {
  return text.split("\n").findIndex((l) => l.trim() === CALL) + 1;
}

/** 生成块里声明的见证行号（无 ⇒ undefined） */
function claimedLine(text: string): number | undefined {
  const m = /@nudo:case "call@L(\d+)"/.exec(text);
  return m ? Number(m[1]) : undefined;
}

describe("-freeze=update 的见证坐标", () => {
  it("首轮 add 之后的 update 把见证名改成真实行号，且再跑一次幂等；已正确的见证不被改错（写盘污染回归）；过期见证被刷新（不再「no changes」）；update 运行的展示面含已冻结的指令 case（不退回剥离坐标系的 entry@）；普通 test 对同一次调用只记一条（指令见证与合成调用点不并存）", () => {
  {
    const { dir, file } = project(BASE);
    try {
      expect(runCliTsx(["test", file, "--freeze"]).status).toBe(0);
      const afterAdd = readFileSync(file, "utf-8");
      // 首轮 add 的块插在声明上方 ⇒ 名字（基源坐标）必然过期
      expect(claimedLine(afterAdd)).not.toBe(callLine(afterAdd));

      const upd = runCliTsx(["test", file, "--freeze=update"]);
      expect(upd.status).toBe(0);
      const afterUpdate = readFileSync(file, "utf-8");
      expect(claimedLine(afterUpdate)).toBe(callLine(afterUpdate));

      // ② 幂等：第二次 update 不改写、不报 diff
      const again = runCliTsx(["test", file, "--freeze=update", "--dry-run"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("freeze: no changes.");
      expect(readFileSync(file, "utf-8")).toBe(afterUpdate);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const file = frozenFile(8, 1); // 调用点真的在第 8 行
    const { dir, file: path } = project(file);
    try {
      const text = readFileSync(path, "utf-8");
      expect(callLine(text)).toBe(8);
      const r = runCliTsx(["test", path, "--freeze=update", "--dry-run"]);
      expect(r.stdout).toContain("freeze: no changes.");
      expect(claimedLine(readFileSync(path, "utf-8"))).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, file } = project(frozenFile(4, 1)); // 名字 L4，真实调用在 L8
    try {
      expect(callLine(readFileSync(file, "utf-8"))).toBe(8);
      const r = runCliTsx(["test", file, "--freeze=update"]);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("freeze: no changes.");
      expect(claimedLine(readFileSync(file, "utf-8"))).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, file } = project(frozenFile(8, 1));
    try {
      const r = runCliTsx(["test", file, "--freeze=update"]);
      expect(r.stdout).toContain(`case "call@L8"`);
      expect(r.stdout).toContain("[unchecked]");
      // ④ 旧行为：剥离后看不到指令 case ⇒ 只剩 entry@ 行（行号还偏移）。
      // 钉「entry@ 见证行」（entry@L<n>），不是 token 任意出现——提示文本里
      // 可以引用 `call@/entry@` 这类字面。
      expect(r.stdout).not.toMatch(/entry@L\d/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, file } = project(frozenFile(8, 1));
    try {
      const r = runCliTsx(["test", file]);
      // 之前会出现两条：冻结写回的指令见证 `call@L8` + 活调用点合成的 `call@L9`
      const caseLines = (r.stdout.match(/^ {2}call@L\d+/gm) ?? []).length;
      expect(caseLines).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});




});
});


// ---------------------------------------------------------------------------
// （CLI）— update 不得净删除活着的见证
// ---------------------------------------------------------------------------
describe("（CLI）— update 不得净删除活着的见证", () => {
/**
 * （CLI 面）：`nudo test --freeze=update` **静默删除**一条**仍然活着**的
 * 见证（`call@site.js:L2`），删除汇总还谎报「0 directive(s)」，事后 health 转绿
 * （假绿）；而 `nudo health --from` 推荐的刷新动作正是这个破坏动作。
 *
 * 契约：
 * - update 后**仍活着**的调用点见证一条都不少（剥离 → 重算 → 回写往返闭合）；
 * - 真的发生删除时，汇总如实报出条数与名字（不再印「0 directive(s)」）。
 */






// ⚠ cwd 必须留在 repo 根：tsx 按 **cwd** 找 tsconfig 的 paths 别名；
// cwd 指向临时目录 ⇒ `@nudojs/service/emit` 落回 package.json exports 的
// **dist**（陈旧产物）⇒ 测试验的不是本次源码。路径一律用绝对路径。

const LIB = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

const SITE = `import { add } from "./lib.js";
const r = add(5, 6);
console.log(r);
`;

function project(libSource = LIB): { dir: string; lib: string; site: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-119-cli-"));
  writeFileSync(join(dir, "lib.js"), libSource, "utf-8");
  writeFileSync(join(dir, "site.js"), SITE, "utf-8");
  return { dir, lib: join(dir, "lib.js"), site: join(dir, "site.js") };
}


  it("update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）；health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少；真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）", () => {
  {
    const { dir, lib, site } = project();
    try {
      const dry = runCliTsx(["test", lib, "--from", site, "--freeze=update", "--dry-run"]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("freeze: no changes.");
      // 旧行为：diff 里删掉 `call@site.js:L2`
      expect(dry.stdout).not.toContain("- * @nudo:case \"call@site.js:L2\"");

      const upd = runCliTsx(["test", lib, "--from", site, "--freeze=update"]);
      expect(upd.status, upd.stderr).toBe(0);
      const after = readFileSync(lib, "utf-8");
      expect(after).toBe(LIB);
      expect(after).toContain('@nudo:case "call@site.js:L2" (5, 6)');
      expect(after).toContain('@nudo:case "mine" (3, 4) => 7');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, lib, site } = project();
    try {
      const h = runCliTsx(["health", lib, "--from", site]);
      // health 可能仍报 drift（drift 口径是既有实现，本条只修「照做即丢证据」）
      expect(h.stdout).toMatch(/Result: (OK|FAIL)/);
      const upd = runCliTsx(["test", lib, "--from", site, "--freeze=update"]);
      expect(upd.stdout).toContain("freeze: no changes.");
      // 旧行为：这一步删掉 call@site.js:L2（不可恢复）⇒ 事后 health 转绿（假绿）
      expect(readFileSync(lib, "utf-8")).toBe(LIB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    // 该块**没有**手写 case ⇒ update 照常重同步：陈旧见证（行号已漂）被改写
    const { dir, lib } = project(`/**
 * @nudo:case "call@L1" (1, 2)
 */
export function add(a, b) { return a + b; }
add(3, 4);
`);
    try {
      const upd = runCliTsx(["test", lib, "--freeze=update"]);
      expect(upd.status, upd.stderr).toBe(0);
      const after = readFileSync(lib, "utf-8");
      expect(after).toContain("call@L5");
      // 旧行为：只数新写出的条数 ⇒ 净删除被印成「0 directive(s)」/完全不出现在汇总里
      expect(upd.stdout).toContain("removed");
      expect(upd.stdout).toContain("call@L1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// 重复的 nudo 成员 ⇒ 写入必须对生效配置有效
// ---------------------------------------------------------------------------
describe("重复的 nudo 成员 ⇒ 写入必须对生效配置有效", () => {
/**
 * `nudo init` 的最小改动写盘只替换**第一个**同名 `"nudo"` 成员，而
 * 加载器按 `JSON.parse`（**后者胜**）读 ⇒ init 报「已写入 adoption baseline」
 * 并引导跑 adoption 档，但**生效的配置仍是旧的非法值**（陈述与事实相反）；
 * init 还主动写出一个带**重复键**的 package.json。
 *
 * 修复：改**生效成员（最后一个）**并把其余重复成员删掉 ⇒ 落盘只剩一个
 * `nudo` 成员，且「init 声称写入 ⇒ 加载器读到的配置 == adoption baseline」。
 */







const BASELINE = { check: { profile: "adoption" } };

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function makePkg(content: string): string {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-229-"));
  writeFileSync(join(dir, "package.json"), content);
  return dir;
}

/** init 的进程内直驱（捕获输出面） */
function init(): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runInit(dir as string, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out, err };
}


  it("重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline；单个非法值（对照）：同样落盘为基线且加载器可见", () => {
  {
    const d = makePkg(`{\n  "name": "p14",\n  "version": "1.0.0",\n  "nudo": null,\n  "nudo": null\n}\n`);
    const r = init();
    expect(r.code, r.err.join("\n")).toBe(0);
    expect(r.out.join("\n")).toContain("wrote adoption baseline");
    const written = readFileSync(join(d, "package.json"), "utf-8");
    // 旧行为：两个 "nudo" 成员并存，JSON.parse 取后者（null）⇒ 写入无效
    expect((written.match(/"nudo"/g) ?? []).length).toBe(1);
    expect(JSON.parse(written).nudo).toEqual(BASELINE);
    // 陈述 == 事实：加载器读到的配置就是写入的基线
    expect(findProjectConfig(d)?.config).toEqual(BASELINE);
  }
  {
    const d = makePkg(`{\n  "name": "p14",\n  "version": "1.0.0",\n  "nudo": null\n}\n`);
    const r = init();
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf-8")).nudo).toEqual(BASELINE);
    expect(findProjectConfig(d)?.config).toEqual(BASELINE);
  }
});


});


// ---------------------------------------------------------------------------
// --help 承诺的 --freeze 模式必须都被实现接受
// ---------------------------------------------------------------------------
describe("--help 承诺的 --freeze 模式必须都被实现接受", () => {
/**
 * `nudo test --help` 宣称 `--freeze` 的模式是 `update | add`，
 * 但 `--freeze=add` 是**用法错误** exit 1 ⇒ **帮助面承诺 vs 实现矛盾**
 * （用户照 `--help` 写就命令失败）。
 *
 * 修复：解析器**接受** `--freeze=add`（帮助文本已经承诺了它 ⇒ 改实现的
 * 成本更低、对用户更友好），并把错误文案里的合法取值集合同步成与帮助
 * 一致。
 *
 * 本钉钉的是**契约本身**：帮助文本列出的每个模式都必须被实现接受
 * （帮助 ↔ 实现同源），而不只是「某几个取值能跑」。
 */






const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-654-"));
  const file = join(cwd, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

/** 从 `--freeze [mode]` 的帮助文案里取出承诺的模式集合。 */
function advertisedModes(help: string): string[] {
  const flat = help.replace(/\s+/g, " ");
  const m = /mode: ([a-z |]+);/.exec(flat);
  expect(m, `help 未声明 --freeze 的模式集合：${flat}`).not.toBeNull();
  return (m![1] ?? "").split("|").map((s) => s.trim()).filter((s) => s.length > 0);
}

describe("-help 承诺的 --freeze 模式必须都被实现接受", () => {
  it("帮助文本承诺 update | add，且两个模式都能被实现接受；非法取值仍被拒（且错误文案列出的合法取值与帮助一致）", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const help = runCli(["test", "--help"], { cwd });
      expect(help.status).toBe(0);
      const modes = advertisedModes(help.stdout);
      expect(modes).toContain("update");
      expect(modes).toContain("add");
      // 帮助承诺的每个模式 ⇒ 实现都必须接受（旧行为：--freeze=add 被拒）
      for (const mode of modes) {
        const r = runCli(["test", file, `--freeze=${mode}`, "--dry-run"], { cwd });
        expect(r.status, `--freeze=${mode} 被拒：${r.stderr}`).toBe(0);
        expect(r.stderr).not.toContain("Invalid --freeze value");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const help = runCli(["test", "--help"], { cwd });
      const modes = advertisedModes(help.stdout);
      const r = runCli(["test", file, "--freeze=bogus", "--dry-run"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid --freeze value");
      // 错误文案里的合法取值集合必须覆盖帮助承诺的每个模式
      for (const mode of modes) {
        expect(r.stderr, `错误文案未列出 ${mode}`).toContain(`=${mode}`);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

});
});


// ---------------------------------------------------------------------------
// --freeze=add 被接受（与省略取值同义）
// ---------------------------------------------------------------------------
describe("--freeze=add 被接受（与省略取值同义）", () => {
/**
 * `nudo test --freeze=add` 被**拒绝**（exit 1 + 「Invalid --freeze
 * value: add」），而 `nudo test --help` **明写** `--freeze [mode]` 的合法
 * 取值是「**update | add**」⇒ 用户照 `--help` 写就命令失败。
 *
 * 修复（与 同根因、同片一次修完）：解析器接受 `--freeze=add`
 * ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。
 *
 * 本钉只钉**实现侧**：`=add` 可用 + 与省略值同义 + 非法取值仍被拒。
 */






const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-656-"));
  const file = join(cwd, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

describe("-freeze=add 被接受（与省略取值同义）", () => {
  it("--freeze=add --dry-run：exit 0（旧行为：exit 1 + Invalid --freeze value）；--freeze=add 与省略取值（默认 add）产出逐字一致；--freeze=update 仍是 update 模式（不回归）；非法取值仍被拒 + exit 1", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=add", "--dry-run"], { cwd });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("Invalid --freeze value");
      // add 模式：把调用点见证固化成 @nudo:case 指令（dry run ⇒ 只打 diff）
      expect(r.stdout).toContain("freeze: would write cases");
      expect(r.stdout).toContain("@nudo:case");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const explicit = runCli(["test", file, "--freeze=add", "--dry-run"], { cwd });
      const implicit = runCli(["test", file, "--freeze", "--dry-run"], { cwd });
      expect(explicit.status).toBe(0);
      expect(implicit.status).toBe(0);
      expect(explicit.stdout).toBe(implicit.stdout);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=update", "--dry-run"], { cwd });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=bogus", "--dry-run"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});
});


// ---------------------------------------------------------------------------
// init 的幂等判据 = 配置加载器的真值判据
// ---------------------------------------------------------------------------
describe("init 的幂等判据 = 配置加载器的真值判据", () => {
/**
 * `nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。
 *
 * 真源：packages/service/src/evaluator/config.ts 的 readNudoKey ——
 * `nudo` 键存在（自有属性）**且**值是「非 null 的非数组对象」才算**有效配置**；
 * 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按
 * 「无配置」处理并**不继承**祖先）。
 *
 * 改前：init 用「键存在」判「已配置」⇒ `"nudo": null` 的包**永远**拿不到
 * 基线（加载器却在提示「去跑 nudo init」⇒ 死循环）。
 * 改后：只有**有效**配置才算「已配置」；形状非法的值被替换成 adoption 基线。
 *
 * 反向闸（断言非永真）：把 init.ts 换回 HEAD 只读副本 ⇒ 本文件两条
 * 「null / 标量 ⇒ 写入基线」断言**必红**（HEAD 打印「already has a nudo
 * config」且一个字节不写）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-676-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

const io = { out: () => {}, err: () => {} };


  it("nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线；nudo 值为标量（形状非法）⇒ init 写入基线；nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）；nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写", () => {
  {
    const dir = pkgDir('{ "name": "x", "nudo": null }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  }
  {
    const dir = pkgDir('{ "name": "x", "nudo": 42 }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  }
  {
    const before = '{ "name": "x", "nudo": { "check": { "profile": "strict" } } }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  }
  {
    const before = '{ "name": "x", "nudo": {} }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  }
});




});


// ---------------------------------------------------------------------------
// init 不得用 nudo 键遮蔽祖先配置
// ---------------------------------------------------------------------------
describe("init 不得用 nudo 键遮蔽祖先配置", () => {
/**
 * `nudo init` 在 monorepo 子包写 `nudo` 键 ⇒ **遮蔽**仓库根配置，
 * 门禁由红翻绿（假绿）。
 *
 * 加载器的查找口径（packages/service/src/evaluator/config.ts）：取「最近的、
 * **含 nudo 键**的 package.json」⇒ 子包一旦有了自己的 `nudo` 键，根配置
 * 整段不可见（文档 packages/website/docs/reference/config.md:10 承诺根配置
 * 对「无自有 nudo 键」的子包保持可见）。
 *
 * 改前：`nudo init packages/foo` 静默写入 `nudo` 键 ⇒ 根的 strict 档消失、
 * L2 由 error 变 warning ⇒ 红的 CI 门禁被**静默**解除。
 * 改后：祖先已有可继承的 nudo 配置 ⇒ **拒绝写遮蔽键**（error:/fix: 引导 +
 * exit 1），根配置继续生效。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「init exit=1」「子包 package.json 未被写」
 * 「check 仍然 exit 1」三条断言**必红**（HEAD 写入子包 ⇒ check 变 exit 0）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** monorepo：根有 strict nudo 配置，子包没有 nudo 键 */
function monoRepo(): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-677-"));
  dirs.push(root);
  const sub = join(root, "packages", "foo");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{ "name": "root", "nudo": { "check": { "profile": "strict" }, "env": ["node"] } }\n',
    "utf-8",
  );
  writeFileSync(join(sub, "package.json"), '{ "name": "foo" }\n', "utf-8");
  writeFileSync(join(sub, "a.js"), "export function getName(user){ return user.name; }\n", "utf-8");
  return { root, sub };
}


  it("祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变；拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1；没有祖先配置时 init 照常写基线（不得过度拦截）", () => {
  {
    const { sub } = monoRepo();
    const before = readFileSync(join(sub, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(sub, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("error:");
    expect(errors.join("\n")).toContain("inherits a nudo config from");
    expect(errors.join("\n")).toContain("fix:");
  }
  {
    const { sub } = monoRepo();
    const before = runCliTsx(["check", join(sub, "a.js")]);
    expect(before.status, before.stderr).toBe(1);
    const init = runCliTsx(["init", sub]);
    expect(init.status, init.stderr).toBe(1);
    const after = runCliTsx(["check", join(sub, "a.js")]);
    expect(after.status, after.stderr).toBe(1);
    expect(after.stdout).toContain("nudo:entry-may-throw");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-677-ok-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(dir, { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  }
});



});


// ---------------------------------------------------------------------------
// init 不得向上逃逸到仓库根
// ---------------------------------------------------------------------------
describe("init 不得向上逃逸到仓库根", () => {
/**
 * `nudo init` 向上逃逸：目标目录**没有自己的 package.json** ⇒
 * 基线写到**仓库根**（整个 monorepo 的门禁档被改），而用户以为只初始化了
 * 一个包。
 *
 * 改前：`findPackageJsonUp` 无条件沿父目录链上溯 ⇒ `nudo init
 * packages/newpkg/src` 把 `"nudo"` 键写进**仓库根**的 package.json。
 * 改后：最近的 package.json 若是 **workspace / 容器根**（`pnpm-workspace.yaml`
 * / `lerna.json` / `package.json#workspaces`）⇒ **拒绝写盘**（error:/fix:
 * 引导 + exit 1），并提示「先给目标包建 package.json」。
 *
 * 口径修订：真源信号**缺失**时，仅凭 `packages/<pkg>/package.json`
 * 这类常规目录名**不再**反推容器根——普通仓也可能有同样的目录形态，
 * 据此拒写是假红（且引导用户去造一个并不需要的嵌套 package.json）。
 * 因此第一个用例从「拒绝」改为「照常写盘」；其余三条真源用例仍钉住
 * 拒绝行为。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** monorepo：根 package.json + 一个兄弟包；目标目录没有自己的 package.json */
function monoRepo(extra?: { pnpmWorkspace?: boolean }): { root: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-"));
  dirs.push(root);
  const target = join(root, "packages", "newpkg", "src");
  mkdirSync(target, { recursive: true });
  mkdirSync(join(root, "packages", "sibling"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "name": "mono-root", "private": true }\n', "utf-8");
  writeFileSync(join(root, "packages", "sibling", "package.json"), '{ "name": "sibling" }\n', "utf-8");
  if (extra?.pnpmWorkspace) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  }
  return { root, target };
}


  it("未声明 workspace 的 monorepo（packages/* 形态）⇒ 不假拒绝（Bug 35 新口径）；pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘；package.json#workspaces ⇒ 同样拒绝写盘；单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）", () => {
  {
    const { root, target } = monoRepo();
    const errors: string[] = [];
    const code = runInit(target, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    expect(errors.join("\n")).not.toContain("workspace / container root");
    expect(errors.join("\n")).not.toContain("fix:");
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  }
  {
    const { root, target } = monoRepo({ pnpmWorkspace: true });
    const before = readFileSync(join(root, "package.json"), "utf-8");
    expect(runInit(target, { out: () => {}, err: () => {} })).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
  }
  {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-ws-"));
    dirs.push(root);
    const target = join(root, "packages", "newpkg");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      '{ "name": "root", "workspaces": ["packages/*"] }\n',
      "utf-8",
    );
    const before = readFileSync(join(root, "package.json"), "utf-8");
    expect(runInit(target, { out: () => {}, err: () => {} })).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
  }
  {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-solo-"));
    dirs.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(join(root, "src"), { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  }
});




});


// ---------------------------------------------------------------------------
// init 的 IO 失败路径可区分
// ---------------------------------------------------------------------------
describe("init 的 IO 失败路径可区分", () => {
/**
 * `nudo init` 的 IO 失败路径：**读失败被误报成「不是合法 JSON」**；
 * **写失败抛未捕获异常**（裸 errno、无 `error:` / `fix:` 引导）。
 *
 * 改前：readFileSync 与 JSON.parse 共用一个 catch ⇒ EACCES 也被报成
 * 「is not valid JSON」；writeFileSync 无 catch ⇒ 异常冒泡（stderr 只有一行
 * 裸 errno，没有 error:/fix: 引导）。
 * 改后：读失败 ⇒ 「cannot read …」；解析失败 ⇒ 「is not valid JSON …」；
 * 写失败 ⇒ 「cannot write …」+ `fix:` 引导；三条路径都 exit 1。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「cannot read」「cannot write」两条断言
 * **必红**（HEAD 报「is not valid JSON」/ 抛裸 errno）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-680-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

/** root 跑起来时权限测试无意义（root 无视 chmod） */
const canTestPermissions = typeof process.getuid !== "function" || process.getuid() !== 0;


  it("package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1；package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）；真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）", () => {
__scenario_1: {
    if (!canTestPermissions) break __scenario_1;
    const dir = pkgDir('{ "name": "noread" }\n');
    const pkgPath = join(dir, "package.json");
    chmodSync(pkgPath, 0o000);
    const errors: string[] = [];
    let code = 0;
    try {
      code = runInit(dir, { out: () => {}, err: (l) => errors.push(l) });
    } finally {
      chmodSync(pkgPath, 0o644);
    }
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("error: cannot read");
    expect(errors.join("\n")).not.toContain("is not valid JSON");
    expect(errors.join("\n")).toContain("fix:");
  }
__scenario_2: {
    if (!canTestPermissions) break __scenario_2;
    const dir = pkgDir('{ "name": "ro" }\n');
    const pkgPath = join(dir, "package.json");
    chmodSync(pkgPath, 0o444);
    const errors: string[] = [];
    let code = 0;
    try {
      code = runInit(dir, { out: () => {}, err: (l) => errors.push(l) });
    } finally {
      chmodSync(pkgPath, 0o644);
    }
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("error: cannot write");
    expect(errors.join("\n")).toContain("fix:");
    // 文件内容未被改动
    expect(readFileSync(pkgPath, "utf-8")).toBe('{ "name": "ro" }\n');
  }
  {
    const dir = pkgDir('{ "name": "badjson", }\n');
    const errors: string[] = [];
    expect(runInit(dir, { out: () => {}, err: (l) => errors.push(l) })).toBe(1);
    expect(errors.join("\n")).toContain("is not valid JSON — nothing written");
    expect(errors.join("\n")).toContain("fix:  repair it first (parse error:");
    expect(errors.join("\n")).not.toContain("cannot read");
  }
});



});


// ---------------------------------------------------------------------------
// init 写盘只改目标键（最小改动）
// ---------------------------------------------------------------------------
describe("init 写盘只改目标键（最小改动）", () => {
/**
 * `nudo init` 整文件重写：**缩进被规范化成 2 空格**、**整数样键
 * 被重排**、**尾换行被强制添加** ⇒ 写盘保真度被破坏（非目标键的字节变了）。
 *
 * 改前：`JSON.parse` → 改对象 → `JSON.stringify(pkg, null, 2)` 整份重写。
 * 改后：**最小改动**——在原文本上定位顶层 `nudo` 键并插入/替换，其余字节
 * 逐字保留（缩进单位 / 冒号后空格 / 键序 / 换行风格 / 尾换行状态）。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「4 空格缩进逐字保留」「整数样键顺序不变」
 * 「尾换行状态不变」三条断言**必红**（HEAD 全部规范化成 2 空格 + 重排 +
 * 补尾换行）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-681-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

const io = { out: () => {}, err: () => {} };


  it("4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员；整数样键的相对顺序不变（JSON.parse 会把它们重排）；紧凑单行文件 ⇒ 保持紧凑（不引入换行）；已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动", () => {
  {
    const before = '{\n    "name": "s1",\n    "version": "1.0.0"\n}';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe(
      '{\n    "name": "s1",\n    "version": "1.0.0",\n    "nudo": {\n        "check": {\n            "profile": "adoption"\n        }\n    }\n}',
    );
    // 非目标键的字节逐字不变（把新插入的成员切掉 ⇒ 与原文件相同）
    expect(written.replace(/,\n {4}"nudo": \{[\s\S]*?\n {4}\}\n\}$/, "\n}")).toBe(before);
    expect(written.endsWith("\n")).toBe(false);
  }
  {
    const dir = pkgDir('{\n  "name": "s2",\n  "2": "two",\n  "1": "one",\n  "10": "ten",\n  "b": true\n}\n');
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    const order = written
      .split("\n")
      .filter((l) => /^ {2}"/.test(l))
      .map((l) => /^ {2}"([^"]+)"/.exec(l)![1]);
    expect(order).toEqual(["name", "2", "1", "10", "b", "nudo"]);
    // 原文件的键序字节不变
    expect(written.startsWith('{\n  "name": "s2",\n  "2": "two",\n  "1": "one",\n  "10": "ten",\n  "b": true,\n')).toBe(
      true,
    );
  }
  {
    const dir = pkgDir('{"name":"up"}');
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe('{"name":"up","nudo":{"check":{"profile":"adoption"}}}');
  }
  {
    const before = '{\n  "name": "x",\n  "nudo": null,\n  "version": "1.0.0"\n}\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe(
      '{\n  "name": "x",\n  "nudo": {\n    "check": {\n      "profile": "adoption"\n    }\n  },\n  "version": "1.0.0"\n}\n',
    );
  }
});




});

// ---------------------------------------------------------------------------
// 超预算调用点：默认档 freeze 必须单次收敛、且不写聚合见证
// ---------------------------------------------------------------------------
describe("超预算调用点：默认档 freeze 单次收敛、聚合见证不落盘", () => {
/**
 * `callSiteBudget`（默认 3）之外的调用点被分析面折成**一条**聚合见证
 * `call@symbolic`——它是「余量折叠」的伪见证，不是调用点。
 *
 * 旧行为：默认档把它当指令写盘，下一轮又把被折叠掉的**逐点**见证当「新增
 * 调用点」追加（它永远不在已固化名单里）⇒ 单次 freeze 不收敛，文件从 4 条
 * 长到 6 条；而 `--freeze=update` / `nudo health` 从**全量记录**重建（按预算
 * 截断，只写 3 条逐点）⇒ 同一文件上三面红绿乒乓，CI 门禁永远对不上。
 *
 * 钉（唯一变量 = 命令面）：
 * - 默认档第 1 轮写出的就是「预算内那批逐点见证」（3 条），文件里**没有**
 *   `call@symbolic`；
 * - 第 2 轮 `freeze: no changes.`，文件逐字不变；
 * - `--freeze=update --dry-run --exit-on-diff`、`--freeze --dry-run
 *   --exit-on-diff`、`nudo health` 三面在同一文件上全部 exit 0、0 drift；
 * - `call@symbolic` 仍出现在**报告面**（精度提示的依据），只是不落盘。
 */
const INC_LIB = `export function inc(x) { return x + 1; }\n`;
/** 5 个调用点 > 默认预算 3 ⇒ 后两个被折成聚合见证 */
const INC_USE = `import { inc } from "./lib.js";
export const a = inc(1);
export const b = inc(2);
export const c = inc(3);
export const d = inc(4);
export const e = inc(5);
`;

  it("默认档连跑两轮：第 2 轮 freeze: no changes.；三面（默认 / =update / health）同一文件全部 exit 0 且 0 drift；聚合见证只在报告面（BUG-170）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-freeze-budget-"));
    try {
      writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`, "utf-8");
      // 子进程 CLI 按 cwd 的 tsconfig 解析 @nudojs/*（否则会测到陈旧 dist）
      writeSrcTsconfig(dir);
      writeFileSync(join(dir, "lib.js"), INC_LIB, "utf-8");
      writeFileSync(join(dir, "use.js"), INC_USE, "utf-8");

      const run = (args: string[]) => runCliTsx(args, { cwd: dir });
      const read = () => readFileSync(join(dir, "lib.js"), "utf-8");

      // ---- 第 1 轮：只写预算内的逐点见证 ----
      const round1 = run(["test", "lib.js", "--from", "use.js", "--freeze"]);
      expect(round1.status, `stderr=${round1.stderr}`).toBe(0);
      const first = read();
      expect(first).toContain('@nudo:case "call@use.js:L2" (1)');
      expect(first).toContain('@nudo:case "call@use.js:L3" (2)');
      expect(first).toContain('@nudo:case "call@use.js:L4" (3)');
      // 聚合伪见证**不得**成为指令（它是余量折叠，不是调用点）
      expect(first).not.toContain("call@symbolic");
      // 报告面仍然看得见它（精度提示的依据不受影响）
      expect(round1.stdout).toContain("call@symbolic");
      expect(round1.stdout).toContain("3 directive(s)");

      // ---- 第 2/3 轮：单次收敛后逐字不变 ----
      for (const round of [2, 3]) {
        const again = run(["test", "lib.js", "--from", "use.js", "--freeze"]);
        expect(again.status, `round ${round} stderr=${again.stderr}`).toBe(0);
        expect(again.stdout, `round ${round}`).toContain("freeze: no changes.");
        expect(read(), `round ${round} 文件必须逐字不变`).toBe(first);
      }

      // ---- 三面同源：默认档 / =update 门禁 / health ----
      const updateGate = run([
        "test", "lib.js", "--from", "use.js", "--freeze=update", "--dry-run", "--exit-on-diff",
      ]);
      expect(updateGate.status, `stderr=${updateGate.stderr}`).toBe(0);
      expect(updateGate.stdout).toContain("freeze: no changes.");

      const defaultGate = run([
        "test", "lib.js", "--from", "use.js", "--freeze", "--dry-run", "--exit-on-diff",
      ]);
      expect(defaultGate.status, `stderr=${defaultGate.stderr}`).toBe(0);
      expect(defaultGate.stdout).toContain("freeze: no changes.");

      const health = run(["health", "lib.js", "--from", "use.js"]);
      expect(health.status, `stderr=${health.stderr}`).toBe(0);
      expect(health.stdout).toContain("0 case drift");
      expect(health.stdout).toContain("Result: OK");

      // 门禁跑完不得改动文件（dry-run / health 都是只读面）
      expect(read()).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000); // 6 个 CLI 子进程（tsx 冷启动）
});
