/**
 * 族 54 · service **协议面**（3 条缺口）的钉。
 *
 * 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）：
 *   env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`，
 *   **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支
 *   曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch
 *   门禁 ⇒ 不触发依赖源文件复分析）。
 *   mock 前缀支锚在 **basename** 起点（绝对路径的 `/` 或相对路径的起点）。
 *
 * 第 2 条 —— hover 的 throws 段（service 侧可观测面）：
 *   hover 只读 case 台账的 throws 证据（`AnalysisResult.functions[].cases[].throwsAbs`）
 *   ⇒ service 必须**产出**这份证据。两种状态下此前拿不到函数级 throws 域
 *   （check 签名行口径 = 入口求值的 hard throw ∪ soft may-throw）：
 *   ① **有调用点见证**：`settleEntryOnlyCandidates` 把 `entry@` 见证连同 throws
 *      证据一起撤掉、改由 `call@` 见证承担调用点域 ⇒ 证据随见证一起消失；
 *   ② **选中 case**：被选函数**不生成 `entry@` 见证**（域由选中的那条 case 声明）
 *      ⇒ 函数级 throws 域在 case 台账里无处安放。
 *   修复后：证据并进该函数**已有**的见证 ⇒ 见证数不变、推断域不变（产物面不动）。
 *
 * 第 3 条 —— `migrate verify` 库面整批 abort：**缺陷不在 service 包**。
 *   取证（见报告）：`migrateVerify`（`packages/nudojs/src/migrate.ts`）**已经**
 *   逐文件隔离（同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件
 *   照常返回）；仍整批 abort 的是同族的 `migrateStrip`（696 的库面半边）。
 *   两处都在 nudojs 包 ⇒ 不在本片（service）范围，本钉不含该例。
 */
import { describe, it, expect } from "vitest";
import { formatThrowsAbs } from "@nudojs/core/internal";
import { formatShape } from "@nudojs/core";
import { isEnvTemplatePath } from "../env-path-deps.ts";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject } from "./tmp-project.ts";

/** env 模板族的扩展名表（三支同表）。 */
const ENV_TEMPLATE_EXTS = ["js", "mjs", "ts", "cjs", "cts", "mts"] as const;

describe("族 54 · service 协议面", () => {
  describe("第 1 条 · env 模板族扩展名表", () => {
    it("mock-<name>.<ext> / <name>.mock.<ext> 对族内全部扩展名都判 true", () => {
      for (const ext of ENV_TEMPLATE_EXTS) {
        expect(isEnvTemplatePath(`/env/mock-fs.${ext}`), `mock-fs.${ext}`).toBe(true);
        expect(isEnvTemplatePath(`/env/fs.mock.${ext}`), `fs.mock.${ext}`).toBe(true);
      }
    });

    it(".env.<ext> 分支（族内另一支）判定的扩展名不变", () => {
      for (const ext of ENV_TEMPLATE_EXTS) {
        expect(isEnvTemplatePath(`/env/custom.env.${ext}`), `custom.env.${ext}`).toBe(true);
      }
    });

    it("mock 前缀支锚在 basename 起点（相对路径形态同样成立）", () => {
      expect(isEnvTemplatePath("mock-fs.js")).toBe(true);
      expect(isEnvTemplatePath("fs.mock.js")).toBe(true);
    });

    it("负控：非 env 模板路径逐字不变（仍为 false）", () => {
      for (const p of [
        "/env/lib.js",
        "/env/lib.ts",
        "/env/lib.mjs",
        "/env/mock-fs.json",
        "/env/fs.mock.json",
        "/env/custom.env.json",
        "/env/mock-fs.d.txt",
        "/env/mock-dir/lib.js",
        "/env/not-mock-fs.js",
        "/env/fs.mockish.js",
      ]) {
        expect(isEnvTemplatePath(p), p).toBe(false);
      }
    });
  });

  describe("第 2 条 · hover 的 throws 段（service 侧可观测面）", () => {
    /** 入口无约束参数 = any ⇒ `x.foo` 落 any 成员访问 ⇒ 函数级 throws 域 = TypeError */
    const MAY_THROW_SRC = `export function risky(x) {
  return x.foo;
}
`;

    it("有调用点见证：函数级 throws 证据落在**函数级承载位**（见证数与推断域不变）", () => {
      const dir = tmpProject("nudo-bug54-callsite-", {
        "main.js": `${MAY_THROW_SRC}export function run() {
  return risky({});
}
`,
      });
      const file = `${dir}/main.js`;
      const r = analyzeFile(file, `${MAY_THROW_SRC}export function run() {
  return risky({});
}
`);
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 调用点见证在场（entry@ 已被撤掉）
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L5"]);
      // 函数级 throws 证据在**函数级承载位** ⇒ hover 的 throws 段有内容
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // **负控**：调用点见证自己的 throwsAbs **不得**被函数级域污染 ——
      // `risky({})` 这次调用**没抛**（`{}.foo` 是 undefined）⇒ 该见证自己的
      // throws 域仍是 never。并进去 ⇒ 草稿面（按「这次调用抛了吗」筛返回义务）
      // 丢返回义务 ⇒ **契约产物变弱**（假绿方向）。
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      // 推断域仍是**调用点域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("有调用点见证（模块级调用点路径）：函数级承载位带函数级 throws 证据", () => {
      const src = `${MAY_THROW_SRC}risky({});
`;
      const dir = tmpProject("nudo-bug54-toplevel-", { "top.js": src });
      const file = `${dir}/top.js`;
      const r = analyzeFile(file, src);
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 这条路径从不产 entry@ 见证（调用点域直接接管）
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L4"]);
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // **负控**：调用点见证自己的 throws 域不被污染（这次调用没抛）
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      // 推断域仍是**调用点域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("选中 case：被选函数不产 entry@ 见证，函数级承载位带函数级 throws 证据", () => {
      const src = `/**
 * @nudo:case "c1" (1) => number()
 */
export function risky(x) {
  return x.foo;
}
`;
      const dir = tmpProject("nudo-bug54-selected-", { "sel.js": src });
      const file = `${dir}/sel.js`;
      const r = analyzeFile(file, src, new Map([["risky", 0]]), undefined, undefined, "selected");
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 选中态：只有选中的那条 case 见证（无 entry@）
      expect(fn.cases.map((c) => c.name)).toEqual(["c1"]);
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // 推断域仍是**case 声明的域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("负控：无调用点见证时 entry@ 见证的 throws 证据与推断域不变", () => {
      const dir = tmpProject("nudo-bug54-entry-", { "entry.js": MAY_THROW_SRC });
      const file = `${dir}/entry.js`;
      const r = analyzeFile(file, MAY_THROW_SRC);
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["entry@L1"]);
      expect(formatThrowsAbs(fn.cases[0]!.throwsAbs)).toBe("TypeError");
      expect(formatShape(fn.combinedAbs!)).toBe("any");
    });
  });
});
