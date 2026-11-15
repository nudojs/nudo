/**
 * 模块套件：VS Code 扩展面（palette/highlight/CRLF/VSIX/server ESM）。
 */
import { describe, it, expect } from "vitest";
import { computeCaseDecorationSpans } from "../case-decorations.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { externalPackageImports, runBundler, runIsolated, vscodeDir } from "./vscode-bundle-harness.ts";

// ---------------------------------------------------------------------------
// VS Code 扩展：case 装饰 endChar 必须是行可见长度
// ---------------------------------------------------------------------------
describe("VS Code 扩展：case 装饰 endChar 必须是行可见长度", () => {
/**
 * VS Code 扩展的 case 高亮装饰在 **CRLF 源文件**上把 `endChar`
 * 推到**行可见长度之外 1 列**。
 *
 * 根因（`packages/vscode/src/case-decorations.ts` 的 `computeCaseDecorationSpans`）：
 * 行切分用 `source.split("\n")` ⇒ 每行末尾的 `\r` 留在行内容里 ⇒ 行长被多算 1；
 * 而 VS Code / LSP 的 `Position.character` 语义是**行可见长度**（行终止符
 * 不属于该行）⇒ `endChar` 越界 1 列（函数档与 case-comment 档**同时**中招）。
 *
 * 原生 oracle：`vscode.Position(line, character)` 的 `character` = 该行**可见
 * 长度**（行终止符不属于该行）⇒ 装饰区间的 `endChar` 必须 ≤ 该行可见长度，
 * 且覆盖整行时恰等于该长度。
 */



const SRC = `\
/**
 * @nudo:case "test" (42)
 */
function double(x) {
  return x * 2;
}
`;

/** 选中 double 的 "test" case ⇒ 函数档 + case-comment 档各一条。 */
const state = new Map([["double", { caseIndex: 0, caseName: "test" }]]);

/** 夹具的 EOL 变体（LF / CRLF / 老 Mac 的 lone-CR）。 */
const EOLS = [
  { label: "LF", eol: "\n" },
  { label: "CRLF", eol: "\r\n" },
] as const;

/** 行可见长度 = 行终止符不属于该行 ⇒ 切行后该行的字符数。 */
const visibleLines = (src: string): string[] => src.split(/\r\n|\r|\n/);

describe("VS Code 扩展：case 装饰 endChar 必须是行可见长度", () => {
  for (const { label, eol } of EOLS) {
    it(`${label} 源文件上函数档与 case-comment 档的 endChar 都等于该行可见长度`, () => {
      const src = SRC.replace(/\n/g, eol);
      const lines = visibleLines(src);
      const spans = computeCaseDecorationSpans(src, state);
      expect(spans).toHaveLength(2);

      const fn = spans.find((s) => s.kind === "function")!;
      // 函数体末行（`}`）的可见长度 —— CRLF 下旧实现多算了一个 `\r`
      expect(fn.endChar).toBe(lines[fn.endLine]!.length);
      expect(fn.endChar).toBe(1);

      const comment = spans.find((s) => s.kind === "case-comment")!;
      // ` * @nudo:case "test" (42)` 所在行的可见长度
      expect(comment.endChar).toBe(lines[comment.endLine]!.length);
      expect(comment.endChar).toBe(' * @nudo:case "test" (42)'.length);
    });

    it(`${label} 源文件上没有任何 span 的 endChar 越过行可见长度`, () => {
      const src = SRC.replace(/\n/g, eol);
      const lines = visibleLines(src);
      for (const span of computeCaseDecorationSpans(src, state)) {
        expect(span.endChar).toBeLessThanOrEqual(lines[span.endLine]!.length);
      }
    });
  }

  it("CRLF 与 LF 的 span 几何完全一致（只有 EOL 不同）", () => {
    const lf = computeCaseDecorationSpans(SRC, state);
    const crlf = computeCaseDecorationSpans(SRC.replace(/\n/g, "\r\n"), state);
    expect(crlf).toEqual(lf);
  });

  it("行号不受行尾影响（切行口径与 Babel 的 loc 行号仍对齐）", () => {
    const lf = computeCaseDecorationSpans(SRC, state);
    const crlf = computeCaseDecorationSpans(SRC.replace(/\n/g, "\r\n"), state);
    expect(crlf.map((s) => [s.startLine, s.endLine])).toEqual(
      lf.map((s) => [s.startLine, s.endLine]),
    );
  });
});
});

// ---------------------------------------------------------------------------
// VSIX 里的 LSP server 必须自包含
// ---------------------------------------------------------------------------
describe("VSIX 里的 LSP server 必须自包含", () => {
/**
 * 发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器
 * **启动即崩** `ERR_MODULE_NOT_FOUND`；而 CI 的 smoke 门禁在 monorepo 布局里
 * 跑 ⇒ **假绿放行**。
 *
 * 三层叠加（缺一不可）：
 * 1. `packages/lsp/tsup.config.ts` 的 `noExternal` 不含 `@babel/*`
 * ⇒ `packages/lsp/dist/server.js` 尾部有 **6 条裸 `@babel/*` import**；
 * 2. `packages/vscode/scripts/bundle-server.mjs` 原来**只 `cp` 不重打包**
 * ⇒ 外部 import 原样进 VSIX；
 * 3. `packages/vscode/.vscodeignore` 排 `node_modules/` +
 * `vsce package --no-dependencies` ⇒ 外部依赖**确定不在包里**。
 *
 * 修法（**只改 `packages/vscode/scripts/bundle-server.mjs`**，`packages/lsp`
 * 零改动）：对 `packages/lsp/dist/server.js` **再打一次 esbuild bundle**
 * （`bundle: true`；除 node 内置外全部内联）⇒ 产物是**自包含单文件**。
 *
 * 原生 oracle：**VSIX 的实际布局 = 没有 node_modules 的目录** ⇒ 产物在那里
 * 必须能起来。本钉用**假仓库布局**跑**真实**的打包脚本（不依赖任何构建
 * 产物），断言：
 * 1. 产物里**裸包 import = 0**（自包含）；
 * 2. 产物在**没有 node_modules 的目录**里能启动。
 */





describe("VSIX 里的 LSP server 必须自包含", () => {
  const run = runBundler();

  it("打包脚本成功产出 server artifact", () => {
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(run.artifact)).toBe(true);
  });

  it("产物里没有任何裸包 import（自包含 ⇒ 0 条外部依赖）", () => {
    expect(externalPackageImports(run.artifact)).toEqual([]);
  });

  it("产物在**没有 node_modules 的目录**（VSIX 布局）里能启动", () => {
    const isolated = runIsolated(run.artifact, run.manifest);
    expect(isolated.stderr).not.toMatch(/Cannot find package|ERR_MODULE_NOT_FOUND/);
    expect(isolated.stdout).toContain("NUDO_FAKE_LSP_SERVER");
    expect(isolated.status).toBe(0);
  });

  it("打包脚本是**再打一次 bundle**（不再只是 cp）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/bundle:\s*true/);
    expect(src).toMatch(/esbuild/);
  });

  it("自检面：打包脚本自己在隔离布局里验过产物（构建期即失败）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/assertSelfContained/);
    expect(src).toMatch(/mkdtemp/);
  });
});
});

// ---------------------------------------------------------------------------
// VSIX 里的 LSP server 必须保住 ESM 身份
// ---------------------------------------------------------------------------
describe("VSIX 里的 LSP server 必须保住 ESM 身份", () => {
/**
 * 发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json`
 * 没有 `"type": "module"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上
 * 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module`
 * ⇒ 整个 IDE 侧产品零功能；而 CI **从不测 VSIX** ⇒ **恒绿**。
 *
 * 根因：Node 判定模块类型**只看最近的 `package.json` 的 `type` 字段**（或
 * `.mjs` 后缀），**不看文件内容** ⇒ `packages/lsp/package.json` 的
 * `"type": "module"` 不会跟着 `cp` 走。
 *
 * 修法（**只改 `packages/vscode/scripts/bundle-server.mjs`**）：在 `server/`
 * 目录里**额外写一个 `package.json`（`{"type":"module"}`）** ⇒ Node 只看
 * **最近的** `package.json` ⇒ 产物拿到 ESM 身份。
 *
 * ⚠ **不能**在 `packages/vscode/package.json` **根**上加 `"type": "module"`：
 * 根清单加它会让 `out/extension.js`（tsup 打的 **CJS** 包，
 * `main: "./out/extension.js"`）变成 ESM 解释 ⇒ **扩展直接加载失败**。
 * ⇒ 本钉把「根清单保持 CommonJS」也钉住，避免回归成根改法。
 *
 * 原生 oracle：`node --no-experimental-detect-module`（Node < 22.18 的判定
 * 语义）下，产物仍必须能启动 ⇒ 它必须有**显式**的 ESM 身份。
 */





/** Node ≥ 22.18 支持 `--no-experimental-detect-module`（关闭模块语法检测）。 */
const noDetect = process.allowedNodeEnvironmentFlags.has(
  "--no-experimental-detect-module",
)
  ? ["--no-experimental-detect-module"]
  : [];

describe("VSIX 里的 LSP server 必须保住 ESM 身份", () => {
  const run = runBundler();

  it("打包脚本成功产出 server artifact", () => {
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(run.artifact)).toBe(true);
  });

  it("产物旁有 {\"type\":\"module\"} 的清单（Node 只看最近的 package.json）", () => {
    expect(existsSync(run.manifest)).toBe(true);
    const manifest = JSON.parse(readFileSync(run.manifest, "utf8"));
    expect(manifest.type).toBe("module");
  });

  it("根清单**没有**把整个包翻成 ESM（CJS 扩展包 out/extension.js 不受影响）", () => {
    const manifest = JSON.parse(
      readFileSync(join(vscodeDir, "package.json"), "utf8"),
    );
    expect(manifest.type).toBeUndefined();
    expect(manifest.main).toBe("./out/extension.js");
  });

  it("node --no-experimental-detect-module 下产物仍能启动（ESM 身份是显式的）", () => {
    const isolated = runIsolated(run.artifact, run.manifest, noDetect);
    expect(isolated.stderr).not.toMatch(
      /Cannot use import statement outside a module|MODULE_TYPELESS_PACKAGE_JSON/,
    );
    expect(isolated.stdout).toContain("NUDO_FAKE_LSP_SERVER");
    expect(isolated.status).toBe(0);
  });

  it("没有 ESM 清单时，同一份产物在同样的 Node 语义下**起不来**（钉住因果）", () => {
    // 把清单拿走 ⇒ Node 只剩「模块语法检测」这条兜底 ⇒
    // 在关闭检测的语义下必须失败（否则本钉的第一条断言就没有约束力）。
    const isolated = runIsolated(run.artifact, null, noDetect);
    expect(isolated.stdout).not.toContain("NUDO_FAKE_LSP_SERVER");
  });

  it("打包脚本负责写 ESM 清单（不是靠根清单）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/type:\s*"module"/);
  });
});
});
