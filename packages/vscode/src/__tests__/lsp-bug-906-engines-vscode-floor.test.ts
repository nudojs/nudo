/**
 * Bug 906 —— VS Code 扩展的 `engines.vscode: "^1.85.0"` 与
 * `vscode-languageclient@10.1.2` 的**硬要求 `^1.91.0`** 冲突 ⇒ 扩展在
 * **自己声明允许**的 VS Code 版本（1.85 ~ 1.90）上**根本不激活**。
 *
 * 根因：依赖在 `LanguageClient` **构造函数体**里硬校验宿主版本
 * （`lib/node/main.js` 的 `REQUIRED_VSCODE_VERSION` + `semverSatisfies`
 * ⇒ `throw`）⇒ 抛在 `activate()` 里 ⇒ 扩展**完全不激活**（无 hover /
 * 无诊断 / 无 quickfix），而用户只看到「扩展未激活」，**看不到**版本冲突
 * 的原因。
 *
 * 修法：把 `packages/vscode/package.json` 的 `engines.vscode` 提到
 * **`^1.91.0`**（与依赖对齐，撤销对 1.85–1.90 的承诺）。
 *
 * 原生 oracle：清单的 `engines.vscode` 是对 Marketplace / 用户的**机器可读
 * 承诺** ⇒ 它承诺的**每一个**版本都必须满足依赖的构造期硬校验 ⇒
 * `engines.vscode` 必须是依赖 `REQUIRED_VSCODE_VERSION` 的**子集**。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { vscodeDir } from "./vscode-bundle-harness.ts";

const require = createRequire(import.meta.url);

const manifest = JSON.parse(
  readFileSync(join(vscodeDir, "package.json"), "utf8"),
) as { engines?: { vscode?: string }; dependencies?: Record<string, string> };

/** 依赖在运行时硬校验的最低宿主版本（读**真实**安装的依赖，不抄版本号）。 */
function requiredVscodeVersion(): string {
  // `vscode-languageclient` 的 `exports` 不暴露 `lib/node/main.js` ⇒
  // 先解析包入口（`lib/common/api.js`），再走到 `lib/node/main.js`。
  const entry = require.resolve("vscode-languageclient");
  const mainJs = join(dirname(entry), "..", "node", "main.js");
  const src = readFileSync(mainJs, "utf8");
  const found = /const REQUIRED_VSCODE_VERSION = '([^']+)'/.exec(src);
  if (!found) throw new Error("REQUIRED_VSCODE_VERSION not found");
  return found[1]!;
}

/** 解析 `^x.y.z` 形式的**下界**（本族两个区间都是 caret 形式）。 */
function floorOf(range: string): [number, number, number] {
  const m = /^\^?(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!m) throw new Error(`cannot parse range: ${range}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe("Bug 906 —— engines.vscode 必须满足依赖的构造期硬校验", () => {
  const required = requiredVscodeVersion();

  it("依赖的硬要求被读到了（vscode-languageclient 的构造函数校验）", () => {
    expect(required).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it("engines.vscode 的下界落在依赖要求的下界之上", () => {
    const declared = manifest.engines?.vscode;
    expect(declared, "packages/vscode/package.json 缺少 engines.vscode").toBeTruthy();
    const [dmaj, dmin, dpatch] = floorOf(declared!);
    const [rmaj, rmin, rpatch] = floorOf(required);
    const ok =
      dmaj > rmaj ||
      (dmaj === rmaj &&
        (dmin > rmin || (dmin === rmin && dpatch >= rpatch)));
    expect(
      ok,
      `engines.vscode ${declared} does not satisfy REQUIRED_VSCODE_VERSION ${required}`,
    ).toBe(true);
  });

  it("依赖版本与硬要求互相印证（清单里的依赖就是被读的那一个）", () => {
    expect(manifest.dependencies?.["vscode-languageclient"]).toBeTruthy();
    const installed = JSON.parse(
      readFileSync(
        join(dirname(require.resolve("vscode-languageclient")), "..", "..", "package.json"),
        "utf8",
      ),
    ) as { version: string; engines?: { vscode?: string } };
    expect(installed.engines?.vscode).toBe(required);
  });

  it("构造期校验点在 LanguageClient 构造函数体里（不是可选路径）", () => {
    const entry = require.resolve("vscode-languageclient");
    const src = readFileSync(
      join(dirname(entry), "..", "node", "main.js"),
      "utf8",
    );
    expect(src).toMatch(/this\.checkVersion\(\)/);
    expect(src).toMatch(/semverSatisfies\(codeVersion, REQUIRED_VSCODE_VERSION\)/);
  });
});
