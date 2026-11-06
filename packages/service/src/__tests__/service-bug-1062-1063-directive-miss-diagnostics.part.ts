/**
 * Bug 1062 / Bug 1063 —— 指令的**语义前提被违反**时，引擎**静默失效、零诊断**
 * ⇒ 唯一的信号是**归因错误**的 `nudo:unknown-inference`（把「你的指令没生效」
 * 说成「推断精度不够」）⇒ 假红 / 假绿。
 *
 * ── Bug 1062（`@nudo:replace` 的目标文本在源码里不存在）────────────────────
 * 病灶：`packages/service/src/eval-injection.ts` 的**收集面**把「目标文本在
 * 本语句作用域内无对应节点」降级成一条**无作用域**登记项（`stmtStart/stmtEnd`
 * 缺省）⇒ 转译面（core 的 `matchReplacement`）恒跳过 ⇒ 声明的类型覆盖
 * **静默蒸发**、零诊断。
 * 改前：`a2-miss`（目标写错一个字母）与 `a3-nodirective`（根本没有这条指令）
 * 的诊断集**逐字相同**（都为空）⇒ 「写错目标」与「没写指令」**不可区分**。
 * 改后：收集面发一条**点名目标文本**的 `nudo:directive-syntax`（warning）⇒
 * ② 与 ③ 可区分；①（目标命中）**零**该诊断。
 *
 * ── Bug 1063（`@nudo:mock-module` 对同一模块重复声明）──────────────────────
 * 病灶：`packages/service/src/mock-module.ts` 的**叠加面**对同一 `d.source`
 * **逐条整块覆写**（后者胜出、无比较、无告警）⇒ 先声明者独有的导出名**静默
 * 消失** ⇒ 该导出名的调用点退化成 `unknown`（wrong-exact）。
 * 改后：重复声明 ⇒ 一条**点名两条来源**的 `nudo:mock-invalid`（warning）；
 * 导出表取**并集**（同名后者胜出）⇒ 先声明者的导出名**不再消失**。
 *
 * 断言非永真：改前 1062 的三种情况诊断集**全为空**；1063 的重复声明 `errors`
 * 为空、且先声明者的 `readFile` 从导出表里**消失**（只剩后声明者的名字）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { $call, $lit, formatAbs } from "@nudojs/core";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements } from "../eval-run.ts";
import { applyMockModuleDirectivesFromSource } from "../mock-module.ts";
import { collectCheckSupplementIssues, directiveDiagIssues } from "../check-issues.ts";
import { tmpProject, writeTmpFile } from "./tmp-project.ts";

// ── Bug 1062 夹具（三份只差「目标文本」/「有没有指令」）──────────────────────

/** ② 目标写错一个字母（源码里是 `JSON.parse(input)`）。 */
const REPLACE_MISS = `export function g(input) {
  // @nudo:replace JSON.parse(inpt) shape({ name: string() })
  const data = JSON.parse(input);
  return data;
}
`;

/** ① 目标写对（其余与 ② 逐字相同）。 */
const REPLACE_HIT = `export function g(input) {
  // @nudo:replace JSON.parse(input) shape({ name: string() })
  const data = JSON.parse(input);
  return data;
}
`;

/** ③ 根本没有 `@nudo:replace`（其余与 ② 逐字相同）。 */
const REPLACE_NONE = `export function g(input) {
  const data = JSON.parse(input);
  return data;
}
`;

/** 收集诊断（行内指令通道）。 */
function diagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags;
}

/** 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。 */
function replaceMissDiags(src: string): DirectiveDiag[] {
  return diagsOf(src).filter(
    (d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:replace"),
  );
}

describe("Bug 1062 — @nudo:replace 目标文本在源码里不存在 ⇒ 显式诊断", () => {
  it("② 目标写错 ⇒ 有一条点名目标文本的诊断", () => {
    const diags = replaceMissDiags(REPLACE_MISS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    // 诊断必须**点名目标文本** ⇒ 用户能看出是哪个字写错了
    expect(diags[0]!.message).toContain("JSON.parse(inpt)");
    expect(diags[0]!.message).toContain("no effect");
  });

  it("① 目标写对 ⇒ 零该诊断（且指令确实命中了节点）", () => {
    expect(replaceMissDiags(REPLACE_HIT)).toEqual([]);
    const reps = collectEvalReplacements(REPLACE_HIT);
    expect(reps.targets).toHaveLength(1);
    // 命中 ⇒ 登记了**节点身份**（字符区间）；未命中才会缺这两个字段
    expect(typeof reps.targets[0]!.stmtStart).toBe("number");
    expect(typeof reps.targets[0]!.stmtEnd).toBe("number");
  });

  it("③ 根本没有该指令 ⇒ 零该诊断（不许误报）", () => {
    expect(replaceMissDiags(REPLACE_NONE)).toEqual([]);
    expect(diagsOf(REPLACE_NONE)).toEqual([]);
  });

  it("② 与 ③ 可区分（改前两者的诊断集逐字相同）", () => {
    const miss = replaceMissDiags(REPLACE_MISS);
    const none = replaceMissDiags(REPLACE_NONE);
    expect(miss.length).toBeGreaterThan(none.length);
    expect(none).toHaveLength(0);
  });

  it("门禁面可见：warning 级（不挡 exit），且文案点名目标", () => {
    const issues = directiveDiagIssues(diagsOf(REPLACE_MISS));
    const hit = issues.filter((i) => i.code === "nudo:directive-syntax");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.severity).toBe("warning");
    expect(hit[0]!.message).toContain("JSON.parse(inpt)");
  });
});

// ── Bug 1063 夹具 ───────────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-1063-");
  writeTmpFile(dir, "mock-fs.js", `export const readFile = (p) => "mock1:" + p;\n`);
  writeTmpFile(dir, "mock-fs3.js", `export const writeFile = (p, d) => "w:" + p;\n`);
});

/** ② 同一模块声明两次（后者只导出 writeFile ⇒ readFile 会被前者顶掉）。 */
const DUP_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
/// @nudo:mock-module "fs" from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ① 单条声明（其余与 ② 逐字相同）。 */
const SINGLE_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

describe("Bug 1063 — @nudo:mock-module 对同一模块重复声明 ⇒ 显式诊断", () => {
  it("② 重复声明 ⇒ 有一条点名两条来源的诊断", () => {
    const r = applyMockModuleDirectivesFromSource(DUP_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    const dups = r.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"));
    expect(dups).toHaveLength(1);
    // 诊断必须点名**两条**指令的来源
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
    expect(dups[0]!.message).toContain('"fs"');
    expect(dups[0]!.code).toBe("nudo:mock-invalid");
  });

  it("① 单条声明 ⇒ 零该诊断（不许误报）", () => {
    const r = applyMockModuleDirectivesFromSource(SINGLE_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(true);
  });

  it("② 重复后先声明者的导出名不得静默消失（不退化成 unknown）", () => {
    const r = applyMockModuleDirectivesFromSource(DUP_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    const named = r.modules.fs!.named;
    // 改前：整块覆写 ⇒ readFile 从导出表里**消失**（调用点退化成 unknown）
    expect(Object.keys(named).sort()).toEqual(["readFile", "writeFile"]);
    // 且先声明者的导出**仍是精确值**（不是 unknown）
    const readFile = named.readFile!;
    expect(formatAbs($call(readFile, [$lit("/x")]))).toContain("mock1:/x");
  });

  it("门禁面可见：warning 级（不挡 exit）", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const issues = collectCheckSupplementIssues(file, DUP_SRC);
    const dups = issues.filter((i) => i.code === "nudo:mock-invalid");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.severity).toBe("warning");
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
  });

  it("重复声明不影响单条声明的既有口径（局部形态：未点名的名字回落原模块）", () => {
    const src = `/// @nudo:mock-module "fs" { readFile } from "./mock-fs.js"
/// @nudo:mock-module "fs" { writeFile } from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;
    const r = applyMockModuleDirectivesFromSource(src, {}, {
      fromFile: join(dir, "app.js"),
    });
    // 重复声明被点名（同一 specifier 两条指令）
    expect(r.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"))).toHaveLength(1);
    // 两条指令点名的名字**都在**（并集）⇒ 导出名不消失
    expect(Object.keys(r.modules.fs!.named).sort()).toEqual(["readFile", "writeFile"]);
  });
});
