/**
 * 模块套件：nudojs env/config/init/freeze/mock/threshold 面。
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, runCliNode as runCli } from "./helpers/run-cli.ts";
import { findProjectConfig } from "@nudojs/service";
import { runInit } from "../commands/init.ts";
import { attachPathErrors } from "../check-json-map.ts";

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

describe("`nudo test --freeze <path>` 不得把路径吞成取值", () => {
  it("旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）；白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误", () => {
(() => {

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
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-018b-"));
    try {
      const r = runCliTsx(["test", "--freeze", "update"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("needs at least one path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});;

  ;
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
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const { dir, file } = project(frozenFile(8, 1));
    try {
      const r = runCliTsx(["test", file]);
      // 之前会出现两条：冻结写回的指令见证 `call@L8` + 活调用点合成的 `call@L9`
      const caseLines = (r.stdout.match(/^ {2}call@L\d+/gm) ?? []).length;
      expect(caseLines).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;

  ;

  ;
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

describe("（CLI）— update 不得净删除活着的见证", () => {
  it("update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）；health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少；真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
});;

  ;

  ;
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

describe("重复的 nudo 成员 ⇒ 写入必须对生效配置有效", () => {
  it("重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline；单个非法值（对照）：同样落盘为基线且加载器可见", () => {
(() => {

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
  })();
(() => {

    const d = makePkg(`{\n  "name": "p14",\n  "version": "1.0.0",\n  "nudo": null\n}\n`);
    const r = init();
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf-8")).nudo).toEqual(BASELINE);
    expect(findProjectConfig(d)?.config).toEqual(BASELINE);
  })();
});;

  ;
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
(() => {

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
  })();
(() => {

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
  })();
});;

  ;
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
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=update", "--dry-run"], { cwd });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  })();
(() => {

    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=bogus", "--dry-run"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;

  ;
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

describe("init 的幂等判据 = 配置加载器的真值判据", () => {
  it("nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线；nudo 值为标量（形状非法）⇒ init 写入基线；nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）；nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写", () => {
(() => {

    const dir = pkgDir('{ "name": "x", "nudo": null }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  })();
(() => {

    const dir = pkgDir('{ "name": "x", "nudo": 42 }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  })();
(() => {

    const before = '{ "name": "x", "nudo": { "check": { "profile": "strict" } } }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  })();
(() => {

    const before = '{ "name": "x", "nudo": {} }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  })();
});;

  ;

  ;

  ;
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

describe("init 不得用 nudo 键遮蔽祖先配置", () => {
  it("祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变；拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1；没有祖先配置时 init 照常写基线（不得过度拦截）", () => {
(() => {

    const { sub } = monoRepo();
    const before = readFileSync(join(sub, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(sub, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("error:");
    expect(errors.join("\n")).toContain("inherits a nudo config from");
    expect(errors.join("\n")).toContain("fix:");
  })();
(() => {

    const { sub } = monoRepo();
    const before = runCliTsx(["check", join(sub, "a.js")]);
    expect(before.status, before.stderr).toBe(1);
    const init = runCliTsx(["init", sub]);
    expect(init.status, init.stderr).toBe(1);
    const after = runCliTsx(["check", join(sub, "a.js")]);
    expect(after.status, after.stderr).toBe(1);
    expect(after.stdout).toContain("nudo:entry-may-throw");
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-677-ok-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(dir, { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  })();
});;

  ;

  ;
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

describe("init 不得向上逃逸到仓库根", () => {
  it("未声明 workspace 的 monorepo（packages/* 形态）⇒ 不假拒绝（Bug 35 新口径）；pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘；package.json#workspaces ⇒ 同样拒绝写盘；单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）", () => {
(() => {

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
  })();
(() => {

    const { root, target } = monoRepo({ pnpmWorkspace: true });
    const before = readFileSync(join(root, "package.json"), "utf-8");
    expect(runInit(target, { out: () => {}, err: () => {} })).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
  })();
(() => {

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
  })();
(() => {

    const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-solo-"));
    dirs.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(join(root, "src"), { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  })();
});;

  ;

  ;

  ;
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

describe("init 的 IO 失败路径可区分", () => {
  it("package.json 不可读 ⇒ 「cannot read」（不是「不是合法 JSON」）+ exit 1；package.json 只读 ⇒ 「cannot write」+ fix 引导 + exit 1（不再抛裸 errno）；真·非法 JSON ⇒ 仍是「is not valid JSON」+ 解析错误位置（不被 IO 路径吞掉）", () => {
(() => {

    if (!canTestPermissions) return;
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
  })();
(() => {

    if (!canTestPermissions) return;
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
  })();
(() => {

    const dir = pkgDir('{ "name": "badjson", }\n');
    const errors: string[] = [];
    expect(runInit(dir, { out: () => {}, err: (l) => errors.push(l) })).toBe(1);
    expect(errors.join("\n")).toContain("is not valid JSON — nothing written");
    expect(errors.join("\n")).toContain("fix:  repair it first (parse error:");
    expect(errors.join("\n")).not.toContain("cannot read");
  })();
});;

  ;

  ;
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

describe("init 写盘只改目标键（最小改动）", () => {
  it("4 空格缩进 + 无尾换行 ⇒ 缩进与尾换行状态逐字保留，只多出 nudo 成员；整数样键的相对顺序不变（JSON.parse 会把它们重排）；紧凑单行文件 ⇒ 保持紧凑（不引入换行）；已有 nudo 键（形状非法）⇒ 只替换它的值，其余字节不动", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const dir = pkgDir('{"name":"up"}');
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe('{"name":"up","nudo":{"check":{"profile":"adoption"}}}');
  })();
(() => {

    const before = '{\n  "name": "x",\n  "nudo": null,\n  "version": "1.0.0"\n}\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    expect(written).toBe(
      '{\n  "name": "x",\n  "nudo": {\n    "check": {\n      "profile": "adoption"\n    }\n  },\n  "version": "1.0.0"\n}\n',
    );
  })();
});;

  ;

  ;

  ;
});
});

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

describe("信封 summary.errors = Σreports[] = 人类面计数", () => {
  it("单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）；CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]；CLI：无路径错误时信封计数 = 人类面计数（未回归）；CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
});;

  ;

  ;

  ;
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

describe("migrate strip --json 的失败面（stdout 永不为空 + 结果不丢）", () => {
  it("语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名；一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢；全成功 ⇒ stdout 仍是顶��数组（形状不变）；非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const dir = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  })();
(() => {

    const bad = dirWith({ "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", bad, good]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("good.ts");
    expect(r.stderr).toContain("bad.ts");
  })();
});;

  ;

  ;

  ;
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

describe("package.json#nudo.env 非数组：原生报告而非裸崩", () => {
  it("人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape；机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）；其它形状（布尔 / 对象）同样不裸崩 + 报告面可见；合法 env 数组：无 config-shape 告警（未回归）", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const { cwd, file } = makeProject('["node"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("config-shape");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;

  ;
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

describe("env 模块合并须走 mergeHarvestUnderEnv（harvest 填空位）", () => {
  it("check 面：harvest 的非冲突导出不再被丢弃（unknown ⇒ string）；check 面与 test 面结论一致（同一文件、同一个精确签名）", () => {
(() => {

    const dir = project();
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("harvested(a: any) => string");
    expect(out).not.toContain("harvested(a: any) => unknown");
    // 误导诊断（真 unknown）必须消失
    expect(out).not.toContain("nudo:unknown-inference");
  })();
(() => {

    const dir = project();
    const file = join(dir, "lib.js");
    const c = runCli(["check", file]);
    const t = runCli(["test", file]);
    // check 面签名表：harvested(a: any) => string（改前是 => unknown）
    expect(c.stdout + c.stderr).toContain("harvested(a: any) => string");
    // test 面 case 表：(any) => string
    expect(t.stdout + t.stderr).toContain("(any) => string");
    expect(c.stdout + c.stderr).not.toContain("=> unknown");
  })();
});;

  ;
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

describe("check — env-harvest-conflict 上屏（）", () => {
  it("人面上屏 nudo:env-harvest-conflict（warning，不挡门禁）；--json 面同码同 severity（warning）", () => {
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:env-harvest-conflict)");
    // 告警级 ⇒ 门禁不红（exit 0）
    expect(r.status).toBe(0);
  })();
(() => {

    const dir = mkdtempSync(join(tmpdir(), "nudo-bug1038-json-"));
    writeHarvestConflictFixture(dir);

    const r = runCli(["check", join(dir, "lib.js"), "--json"]);
    const parsed = JSON.parse(r.stdout) as {
      issues?: Array<{ severity: string; code: string }>;
    };
    const hit = (parsed.issues ?? []).find((i) => i.code === "nudo:env-harvest-conflict");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
  })();
});;

  ;
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

describe("init 的祖先继承口径 = 加载器口径（不得死锁）", () => {
  it("加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）；死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）；死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）；反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）；显式 init <容器根>：写盘 + 作用域告警（不越界）；从容器根的子目录 init：拒绝越界写盘（exit 1）", () => {
(() => {

    const { sub } = ancestorWithInvalidChild();
    // 加载器：本包的 nudo 键存在 ⇒ 截断祖先搜索 ⇒ 无配置
    expect(findProjectConfig(sub)).toBeNull();
  })();
(() => {

    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(sub, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
    expect(errors.join("\n")).toContain("replaced with the adoption baseline");
  })();
(() => {

    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(errors.join("\n")).not.toContain("it inherits a nudo config from");
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
});;

  ;

  ;

  ;

  ;

  ;
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

describe("CLI：nudo:mock-invalid 严重度对齐文档（warning）", () => {
  it("mock 表达式解析失败 ⇒ warning（不红门禁）；mock 文件缺失仍是 error（不引入假绿）；负控制：文件面只出现一条 mock-invalid（无重复报告）", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

    const dir = fixture(MOCK_EXPR);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      const mockInvalid = json.issues.filter((i) => i.code === "nudo:mock-invalid");
      expect(mockInvalid).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;
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

describe("CLI：nudo 键形状非法 ⇒ 报告面可见（不静默）", () => {
  it("check --json：config-shape warning 进 issues 段；check 人类面：issues 段看得见 config-shape；health 人类面：config 提示行可见；health --json：configShape 字段可见；936：假值 nudo 键（false）同样可见（且措辞说 falsy）；负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断", () => {
(() => {

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
  })();
(() => {

    const dir = projectWithNudo(true);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
(() => {

    const dir = projectWithNudo(true);
    try {
      const r = runCli(["health", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config:");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
(() => {

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
  })();
(() => {

    const dir = projectWithNudo(false);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("falsy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
(() => {

    const dir = projectWithNudo({ check: { ignoreThrows: ["RangeError"] } });
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as { issues: { code: string }[] };
      expect(json.issues.filter((i) => i.code === "config-shape")).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});;

  ;

  ;

  ;

  ;

  ;
});

describe("CLI：配置形状诊断是 live 事实（磁盘缓存不得留痕/重复）", () => {
  it("缓存命中轮：config-shape 仍恰 1 条（不重复）；键被改好后：陈旧的 config-shape 告警不得留在缓存里", () => {
(() => {

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
  })();
(() => {

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
  })();
});;

  ;
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

describe("nudo.env 写成字符串：不展成逐字符 env 名列表（反向守护钉）", () => {
  it("字符串 env：不裸崩 + 人类面产出 config-shape 形状告警；字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved；env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条；env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:[\"node\"] ⇒ Buffer 可用；env 无关型代码：", () => {
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
(() => {

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
  })();
});;

  ;

  ;

  ;

  ;
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

describe("项目级 path env 按项目根解析（子目录文件也拿得到）", () => {
  it("子目录文件：拿到 env ⇒ magic() => 42、无 env 告警、exit 0；根目录文件：口径不变（magic() => 42、exit 0）；项目级 env 文件真缺时仍必须可见（nudo:env-unresolved 不许被过滤掉）", () => {
(() => {

    const dir = project();
    const r = runCli(["check", join(dir, "src", "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("never");
    // 不得报 check 面从未请求过的路径（分析器通道按文件目录解析的旧记录）
    expect(out).not.toContain("env-unresolved");
  })();
(() => {

    const dir = project();
    const r = runCli(["check", join(dir, "rootlib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).toContain("magic() => 42");
    expect(out).not.toContain("env-unresolved");
  })();
(() => {

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
  })();
});;

  ;

  ;
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
(() => {

    const { cwd } = makeProject();
    try {
      const r = runCliTsx(["check"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo check` needs at least one path.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  })();
(() => {

    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--watch"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--fix cannot be combined with");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  })();
});;

  ;
});
});
