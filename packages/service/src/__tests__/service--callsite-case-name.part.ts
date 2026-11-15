/**
 * Bug 465：固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号
 * ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。
 *
 * 根因：
 * - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在
 *   同一行调用同一函数 → 同名 `call@L2`；行号在被分析文件里无意义。
 * - `insertGeneratedCaseDirectives` 的 `already-generated` 判定以「该函数已有
 *   case 指令」为条件 ⇒ 函数级的已有见证吞掉其它调用点的新见证。
 *
 * 修法（命名规则，service 侧统一口径）：
 * - 调用点在本文件内 → `call@L<行号>`（行号在被分析文件里可核对；与既有
 *   已固化名字兼容，不引起 freeze 抖动）。
 * - 调用点在别的文件（`--from` 现场）→ `call@<现场文件相对路径>:L<行号>`
 *   （名字自带来源限定 ⇒ 不撞名；行号落在具名文件里可核对）。
 * - emitter 的 `already-generated` 判定改为**按见证身份（名字）逐条**比对：
 *   同名不重复写，新调用点照写。
 *
 * 钉：两个现场文件同行的调用 → 见证名不同；本地调用点 → 名字不变（兼容）；
 * 二次 freeze：新见证能追加（emitter 层）；负控制：本地见证名保持 `call@L<n>`。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { collectCallRecords } from "../analyzer-orchestrate-calls.ts";
import { insertGeneratedCaseDirectives } from "../emit/case-emitter.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const LIB = `export function add(a, b) { return a + b; }
`;
const SITE_A = `import { add } from "./lib.js";
const x = add(1, 2);
`;
const SITE_B = `import { add } from "./lib.js";
const y = add(3, 4);
`;

function callNames(result: ReturnType<typeof analyzeFile>, name: string): string[] {
  const fn = result.functions.find((f) => f.name === name);
  return (fn?.cases ?? []).map((c) => c.name);
}

describe("Bug 465：call@ 见证名带来源限定；二次 freeze 不丢新见证", () => {
  it("两个现场文件同行的调用 → 见证名不同（改前都是 call@L2）", () =>
    withTmpProject("nudo-b465-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      const a = writeTmpFile(dir, "a.js", SITE_A);
      const b = writeTmpFile(dir, "b.js", SITE_B);
      const external = [
        ...collectCallRecords(a, readFileSync(a, "utf-8")),
        ...collectCallRecords(b, readFileSync(b, "utf-8")),
      ];
      const result = analyzeFile(lib, readFileSync(lib, "utf-8"), undefined, external);
      const names = callNames(result, "add").filter((n) => n.startsWith("call@"));
      expect(names.length).toBe(2);
      expect(new Set(names).size).toBe(2);
      // 名字自带来源文件（相对被分析文件）
      expect(names.every((n) => n.includes("a.js:L2") || n.includes("b.js:L2"))).toBe(true);
    }));

  it("负控制：本地调用点的见证名保持 call@L<n>（与既有已固化名字兼容）", () =>
    withTmpProject("nudo-b465b-", (dir) => {
      const src = `export function add(a, b) { return a + b; }
const z = add(7, 8);
`;
      const file = writeTmpFile(dir, "local.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = callNames(result, "add").filter((n) => n.startsWith("call@"));
      expect(names).toEqual(["call@L2"]);
    }));

  it("emitter：已有同名见证不重复写；新见证照写（不再整函数丢弃）", () =>
    withTmpProject("nudo-b465c-", (dir) => {
      // 用带本地调用点的源码 ⇒ 合成 case 的实参是可序列化的字面量
      const src = `export function add(a, b) { return a + b; }
const z = add(7, 8);
`;
      const file = writeTmpFile(dir, "lib.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "add")!;
      const base = fn.cases.find((c) => c.source === "callsite")!;
      expect(base).toBeDefined();
      // 手工造一个「已固化」的分析结果：同名见证 + 一个新见证
      const frozen = { ...base, name: "call@a.js:L2" };
      const fresh = { ...base, name: "call@b.js:L2" };
      const analysis = {
        ...result,
        functions: [{ ...fn, cases: [frozen, fresh] }],
      };
      const withFrozen = insertGeneratedCaseDirectives(
        `/**
 * @nudo:case "call@a.js:L2" (7, 8)
 */
export function add(a, b) { return a + b; }
const z = add(7, 8);
`,
        analysis,
      );
      // 同名的 call@a.js:L2 不重复写；新的 call@b.js:L2 被追加
      expect(withFrozen.source).toContain('"call@b.js:L2"');
      expect(withFrozen.source.match(/call@a\.js:L2/g)?.length).toBe(1);
      expect(withFrozen.written.map((w) => w.fn)).toEqual(["add"]);
    }));

  it("接线：已固化函数的**新增外部调用点**也合成 call@ 见证", () =>
    withTmpProject("nudo-b465d-", (dir) => {
      // 分片 H 的 synthesizeFrozenCallSiteCases 只认**外部**记录 ⇒ 依赖
      // caseEnv 收到 externalCallRecords（接线项 2）；未接时该功能惰性
      // 无副作用（新增外部调用点看不见 ⇒ 二次 freeze 丢新见证）。
      const libSrc = `/**
 * @nudo:case "call@a.js:L2" (1, 2)
 */
export function add(a, b) { return a + b; }
`;
      const lib = writeTmpFile(dir, "lib.js", libSrc);
      const a = writeTmpFile(dir, "a.js", SITE_A);
      const b = writeTmpFile(dir, "b.js", SITE_B);
      const external = [
        ...collectCallRecords(a, readFileSync(a, "utf-8")),
        ...collectCallRecords(b, readFileSync(b, "utf-8")),
      ];
      const result = analyzeFile(lib, libSrc, undefined, external);
      const names = callNames(result, "add");
      // 已固化的 call@a.js:L2 不重复合成；新增现场 b.js 的调用点合成新见证
      expect(names).toContain("call@b.js:L2");
    }));
});
