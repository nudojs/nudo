/**
 * 模块套件：`nudo check <被调方> --from <调用方>` 的**静态**调用点通道。
 *
 * 同一份被调方（同一侧车契约 `ms > 0`），唯一变量 = 现场文件的**导入形态**：
 *
 * | 现场写法 | core 报的被调名 | 旧通道 |
 * |---|---|---|
 * | `import { setDelay }` | `setDelay` | ✅ 命中（键值巧合） |
 * | `import { setDelay as sd }` | `setDelay` | ❌ 零命中 |
 * | `import * as space` + `space.setDelay(…)` | `setDelay` | ❌ 零命中 |
 * | `import d from …`（`export default function setDelay`） | `setDelay` | ❌ 零命中 + 整份现场文件被跳过 |
 *
 * 根因是**键的口径**：旧表是「本地名 → 导入名」，而 core 的
 * `nudo:constraint-violated` 报的是**解析后的被调名**（别名 / 命名空间成员 /
 * 默认导入三种形态都已解析成目标导出名），只有「本地名 == 导出名」因巧合匹配。
 * 默认导入更要命：`ImportDefaultSpecifier` 根本不入表 ⇒ 表空 ⇒ 整份现场文件
 * `continue`（连带丢掉同文件其它调用的证据）。
 *
 * 现在按**目标导出名**建面（命名导入记 imported 名、命名空间开闸、默认导入
 * 按目标默认导出的声明名），四种形态都归因到被调方。
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultLoadModule } from "@nudojs/service";
import { staticFromDomainIssues, type FromCallsiteFile } from "../check-json-map.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SHAPES = `import { number } from "@nudojs/core";
export const delay = number().gt(0);
`;

const NAMED = `/// @nudo:import { delay } from "./shapes.nudo.js"
/** @nudo:contract ms delay */
export function setDelay(ms) { return ms; }
`;

const DEFAULT = `/// @nudo:import { delay } from "./shapes.nudo.js"
/** @nudo:contract ms delay */
export default function setDelay(ms) { return ms; }
`;

/** 现场文件四种导入形态（唯一变量 = 导入写法） */
const SITES: Record<string, string> = {
  "named.js": `import { setDelay } from "./lib-named.js";\nexport function bad() { return setDelay(-101); }\n`,
  "aliased.js": `import { setDelay as sd } from "./lib-named.js";\nexport function bad() { return sd(-102); }\n`,
  "namespace.js": `import * as space from "./lib-named.js";\nexport function bad() { return space.setDelay(-103); }\n`,
  "default.js": `import d from "./lib-default.js";\nexport function bad() { return d(-104); }\n`,
};

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-import-forms-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "shapes.nudo.js"), SHAPES, "utf-8");
  writeFileSync(join(dir, "lib-named.js"), NAMED, "utf-8");
  writeFileSync(join(dir, "lib-default.js"), DEFAULT, "utf-8");
  for (const [name, src] of Object.entries(SITES)) writeFileSync(join(dir, name), src, "utf-8");
  return dir;
}

/** 相对说明符解析：只有**真实存在**的文件才算一条 import 边 */
function resolveModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const abs = resolve(dirname(fromFile), spec);
  return existsSync(abs) ? abs : undefined;
}

function siteOf(dir: string, name: string, src: string): FromCallsiteFile {
  return { path: join(dir, name), source: src };
}

function actuals(dir: string, target: string, site: FromCallsiteFile, targetSource: string): string[] {
  const issues = staticFromDomainIssues({
    targetPath: join(dir, target),
    targetSource,
    callsites: [site],
    resolveModule,
    loadModule: defaultLoadModule,
  });
  return issues.map((i) => `${i.code}|${i.fn}|${i.actual ?? ""}`);
}

describe("--from 静态通道：四种导入形态都要归因到被调方", () => {
  it("命名 / 别名 / 命名空间 / 默认导入 ⇒ 同一被调方、同一码、各自的违约值", () => {
    const dir = makeFixture();
    const expected: Array<[string, string, string]> = [
      ["named.js", "-101", "lib-named.js"],
      ["aliased.js", "-102", "lib-named.js"],
      ["namespace.js", "-103", "lib-named.js"],
      ["default.js", "-104", "lib-default.js"],
    ];
    for (const [name, actual, target] of expected) {
      const issues = actuals(dir, target, siteOf(dir, name, SITES[name]!), target === "lib-named.js" ? NAMED : DEFAULT);
      expect(issues, `${name} 应产出恰好一条跨文件证据`).toEqual([
        `nudo:contract-domain-exceeds|setDelay|${actual}`,
      ]);
    }
  });

  it("不涉及的导入边 ⇒ 零证据（不造门禁）", () => {
    const dir = makeFixture();
    // 现场文件 import 的是**另一个模块**（不是被调方）⇒ 静态通道没有边
    const other = `import { setDelay } from "./other.js";\nexport function bad() { return setDelay(-9); }\n`;
    writeFileSync(join(dir, "other.js"), `export function setDelay(ms) { return ms; }\n`, "utf-8");
    expect(actuals(dir, "lib-named.js", siteOf(dir, "other.js", other), NAMED)).toEqual([]);
  });

  it("命名空间导入只归因**目标真实导出**的名字（别的模块的违约不得算到被调方头上）", () => {
    const dir = makeFixture();
    // 另一份契约模块：`other` 只在这个模块里导出（被调方 lib-named.js 没有）
    const otherSrc = `/// @nudo:import { delay } from "./shapes.nudo.js"
/** @nudo:contract ms delay */
export function other(ms) { return ms; }
`;
    writeFileSync(join(dir, "other-contract.js"), otherSrc, "utf-8");
    // 现场文件同时 import 被调方（命名空间）与别的契约模块 ⇒ checkSource 会
    // 报两条约束违例。旧口径「有命名空间导入 ⇒ 任意被调名都归因」把
    // `other(-5)` 也算到 lib-named.js（它根本不导出 other）⇒ 假门禁。
    const site = `import * as space from "./lib-named.js";
import { other } from "./other-contract.js";
export function bad() { space.setDelay(-103); return other(-5); }
`;
    expect(actuals(dir, "lib-named.js", siteOf(dir, "uses-two-imports.js", site), NAMED)).toEqual([
      "nudo:contract-domain-exceeds|setDelay|-103",
    ]);
  });

  it("默认导入的归因依赖目标默认导出的声明名（`export { f as default }` 同口径）", () => {
    const dir = makeFixture();
    // `export { hidden as default }`：默认导出值是本地绑定 hidden
    const src = `/// @nudo:import { delay } from "./shapes.nudo.js"
/** @nudo:contract ms delay */
function hidden(ms) { return ms; }
export { hidden as default };
`;
    writeFileSync(join(dir, "lib-reexp.js"), src, "utf-8");
    const site = `import h from "./lib-reexp.js";\nexport function bad() { return h(-105); }\n`;
    expect(actuals(dir, "lib-reexp.js", siteOf(dir, "uses-reexp.js", site), src)).toEqual([
      "nudo:contract-domain-exceeds|hidden|-105",
    ]);
  });
});
