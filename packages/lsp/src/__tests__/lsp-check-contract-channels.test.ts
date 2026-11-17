/**
 * 模块套件：lsp-check-contract-channels（LSP 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer, withTempDir, createMockConnection } from "./helpers.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkToLspDiagnostics } from "../validation.ts";
import { applyEdits, codeActionParams, mountCodeActions, missingFieldDiag, docEdits } from "./lsp-harness-code-actions.ts";
import { contractEmitTool } from "../agent-tools.ts";
import { parse } from "@nudojs/parser";
import { pathToFileURL } from "node:url";
import { createNudoServer } from "../server.ts";
import { decodeSemanticTokens } from "./lsp-harness-semantic-tokens.ts";


// ---------------------------------------------------------------------------
// 调用点插入点必须是对象字面量实参（不是字符串里的 `{`）
// ---------------------------------------------------------------------------
describe("调用点插入点必须是对象字面量实参（不是字符串里的 `{`）", () => {
/**
 * A6「Add missing field 'X' to call」的插入点用**行内文本启发式**
 * 定位（`indexOf("{")` + 行内 `{` 计数 == 1）⇒ 诊断所在行的第一个 `{` 落在
 * **字符串 / 模板串**里时，字段被插进字面量内部 ⇒ 源码语义被改坏。
 *
 * 钉：插入点由 **AST** 定位（诊断所在调用的对象字面量实参的 `{` 之后），
 * 字符串字面量里的 `{` 不再被当成插入点。
 */






/** 调用起始行只有一个 `{`，且它在字符串字面量里；对象字面量的 `{` 在下一行 */
const GREET_JS_737 = `export function greet(u) {
  return u.name + "!";
}

greet("a{b",
  { id: 1 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;


  it("插入点落进对象字面量，字符串字面量原样保留；同一行既有字符串 `{` 又有对象字面量时也落进对象字面量", () => {
  {
    withTempDir("nudo-lsp-737-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS_737, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS_737);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBe(1);
      const e = edits[0]!;
      // 对象字面量的 `{` 在第 5 行第 2 列 ⇒ 插入点 = 第 5 行第 3 列
      expect(e.range.start).toEqual({ line: 5, character: 3 });
      const applied = applyEdits(GREET_JS_737, edits);
      // 字符串字面量没被插字段
      expect(applied).toContain('greet("a{b",');
      expect(applied).not.toContain('"a{ name');
      // 字段落进对象字面量
      expect(applied).toContain("{ name: null,  id: 1 });");
    });
  }
  {
    const src = `export function greet(u) {
  return u.name + "!";
}

greet("{", { id: 1 });
`;
    withTempDir("nudo-lsp-737b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), src, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, src);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBe(1);
      const applied = applyEdits(src, edits);
      expect(applied).toContain('greet("{", { name: null,  id: 1 });');
    });
  }
});


});


// ---------------------------------------------------------------------------
// agent nudo/check 并入 mock 装载失败通道
// ---------------------------------------------------------------------------
describe("agent nudo/check 并入 mock 装载失败通道", () => {
/**
 * LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。
 *
 * 症状（改前）：夹具 `@nudo:mock helper from "./no-such-mock.js"`（mock 文件
 * 不存在）⇒ CLI `nudo check --json` 报 **error 级 `nudo:module-missing`**
 * （判红），agent 工具面**整条通道消失**（判绿）——同一文件两个面两种结论。
 *
 * 根因：agent 工具只调 core 的 `checkSource` + `serializeCheckJson`，而
 * mock 装载失败在**旁路通道**里（CLI 侧由 `mergeCheckIssues` 显式并入）。
 *
 * 本钉走**真 LSP server**（mock connection + 真协议请求），断言 slash 形式
 * 与 dot 形式都能看到这条 error 级通道。
 */



const MOCKONLY = `/**
 * @nudo:mock helper from "./no-such-mock.js"
 */
export function add(a) {
  return a + 1;
}
`;


  it("slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）；dot 形式：同一条通道同样可见（协议别名不降级）；文本面：error 级通道上屏（不再是「0 error」判绿）", async () => {
  {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/mockonly.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:module-missing",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("error");
      expect(issue.message).toContain("no-such-mock.js");
      expect(json.ok).toBe(false);
      expect(json.summary.errors).toBeGreaterThanOrEqual(1);
    });
  }
  {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/mockonly.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:module-missing");
    });
  }
  {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/mockonly.js` });
      const text = r.content[0].text;
      expect(text).toContain("nudo:module-missing");
      expect(text).toContain("FAILED");
    });
  }
});



});


// ---------------------------------------------------------------------------
// contract.emit 走 root 驱动下行推导
// ---------------------------------------------------------------------------
describe("contract.emit 走 root 驱动下行推导", () => {
/**
 * `nudo.contract.emit` 必须走 **root 驱动下行推导**
 * （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。
 *
 * 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒
 * - CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面**永远不产生**；
 * - 结果文本只报「no contract changes / skipped add4 (name-clash)」，
 * 把「引擎没做的那一步」说成「本地侧车被手写占用」——误导性诊断。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */







const STD = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
`;
const ADD_JS = `export function add2(x) {
  return x + 2;
}
`;
const LIB_JS = `import { add2 } from "./add.js";

export function add4(x) {
  return add2(x + 1) + 1;
}
`;
const LIB_NUDO = `import { fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";

export const add4 = fn({ x: positive }, positive4);
`;

const FIXTURE = {
  "std.nudo.js": STD,
  "add.js": ADD_JS,
  "lib.js": LIB_JS,
  "lib.nudo.js": LIB_NUDO,
};


  it("工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from；工具面：dry-run 只预览、不写下游侧车；协议面：nudo.contract.emit 同样产出下游侧车", async () => {
  {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const libJs = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file: libJs, functionName: "add4", mode: "update" },
        { workspaceRoots: [dir] },
      );
      const text = r.content[0].text;
      // 结果文本必须有下游侧车这一行（CLI 口径：Updated <root> → <sidecar> (derived-from …)）
      expect(text).toContain("add.nudo.js");
      expect(text).toContain("derived-from add4");
      // 下游侧车真的落盘了
      const side = join(dir, "add.nudo.js");
      expect(existsSync(side)).toBe(true);
      const sideText = readFileSync(side, "utf-8");
      expect(sideText).toContain("derived-from: lib.js:add4");
      expect(sideText).toContain("export const add2 = fn(");
      // 本地侧车（手写 name-clash）的诊断**仍在**（没被推导步吞掉）
      expect(text).toContain("name-clash");
    });
  }
  {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const libJs = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file: libJs, functionName: "add4", mode: "update", dryRun: true },
        { workspaceRoots: [dir] },
      );
      expect(r.content[0].text).toContain("dry-run");
      expect(existsSync(join(dir, "add.nudo.js"))).toBe(false);
    });
  }
  {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const mock = createMockConnection();
      const { createNudoServer } = await import("../server.ts");
      createNudoServer(mock as unknown as never);
      await mock.requests.get("initialize")!({
        processId: null,
        rootUri: pathToFileURL(dir).href,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: "root" }],
      });
      const res = await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.contract.emit",
        arguments: [pathToFileURL(join(dir, "lib.js")).href, "add4", "update"],
      });
      expect(res.content[0].text).toContain("add.nudo.js");
      expect(res.content[0].text).toContain("derived-from add4");
      expect(existsSync(join(dir, "add.nudo.js"))).toBe(true);
    });
  }
});



});


// ---------------------------------------------------------------------------
// emit 写盘边界按路径分量判定
// ---------------------------------------------------------------------------
describe("emit 写盘边界按路径分量判定", () => {
/**
 * emit 写盘边界按**路径分量**判定，不按字符串前缀。
 *
 * 症状（改前）：`pathInsideRoot` 用 `rel.startsWith("..")` 判逃逸 ⇒
 * `..dotted.js` / `...triple.js` / `..cfg/x.js` 这些**合法**的相对路径
 * （组件名以 `..` 开头）被误判成逃逸 ⇒ IDE 拒绝对**工作区内**的合法文件
 * 写侧车，而 CLI（无 workspace root 闸门）接受。
 *
 * 修法：逃逸判据 = 「整段等于 `..`」或「以 `..` + 分隔符开头」。
 * 真正的逃逸（root 外的兄弟目录、指向 root 外的符号链接）**仍必须拒**。
 */






const SRC = `export function f() {
  return 1;
}
`;


  it("root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车；root 外的文件 ⇒ 仍然拒绝；指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）", async () => {
  {
    await withLspServer(
      {
        "..dotted.js": SRC,
        "...triple.js": SRC,
      },
      async ({ dir }) => {
        // `..cfg/` 子目录（组件名以 `..` 开头）在回调里现落
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(join(dir, "..cfg"), { recursive: true });
        writeFileSync(join(dir, "..cfg", "x.js"), SRC, "utf-8");
        // workspace root = 临时目录本身（..cfg 是它的子目录）
        for (const rel of ["..dotted.js", "...triple.js", join("..cfg", "x.js")]) {
          const file = join(dir, rel);
          const r = await contractEmitTool(
            { file, functionName: "f", mode: "add" },
            { workspaceRoots: [dir] },
          );
          expect(r.isError, `${rel} 不该被拒：${r.content[0].text}`).toBeFalsy();
        }
        expect(existsSync(join(dir, "..dotted.nudo.js"))).toBe(true);
        expect(existsSync(join(dir, "...triple.nudo.js"))).toBe(true);
        expect(existsSync(join(dir, "..cfg", "x.nudo.js"))).toBe(true);
      },
    );
  }
  {
    await withLspServer({ "in.js": SRC }, async ({ dir }) => {
      const root = join(dir, "root");
      mkdirSync(root, { recursive: true });
      const outside = join(dir, "outside", "secret.js");
      mkdirSync(join(dir, "outside"), { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outside, SRC, "utf-8");
      const r = await contractEmitTool(
        { file: outside, functionName: "f", mode: "add" },
        { workspaceRoots: [root] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("outside allowed roots");
      expect(existsSync(join(dir, "outside", "secret.nudo.js"))).toBe(false);
    });
  }
  {
    await withLspServer({ "in.js": SRC }, async ({ dir }) => {
      const root = join(dir, "root");
      const outsideDir = join(dir, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(outsideDir, "secret.js"), SRC, "utf-8");
      const link = join(root, "link.js");
      symlinkSync(join(outsideDir, "secret.js"), link);
      const r = await contractEmitTool(
        { file: link, functionName: "f", mode: "add" },
        { workspaceRoots: [root] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("outside allowed roots");
      expect(existsSync(join(outsideDir, "secret.nudo.js"))).toBe(false);
    });
  }
});



});


// ---------------------------------------------------------------------------
// agent nudo/check + nudo/test 的分析目标闸门
// ---------------------------------------------------------------------------
describe("agent nudo/check + nudo/test 的分析目标闸门", () => {
/**
 * LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」
 * 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对
 * 同一文件 exit 1「Not an analysis target」；`nudo/test` 还把契约 **DSL
 * 构造器**（`fn(...)` / `shape(...)` / `string()`）当成真实调用点报成 case。
 *
 * 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 /
 * `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target`
 * 码 + 与 CLI 逐字一致的消息）。
 */



const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;


  it("nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）；nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case；普通 .js 目标不受闸门影响（仍能分析）；dot 形式同样过闸门", async () => {
  {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo/check")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.ok).toBe(false);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-target");
      expect(json.pathErrors[0].message).toContain("Not an analysis target");
    });
  }
  {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-target");
      // 「0 fn · 3 case」（fn/shape/string 三个 DSL 构造器当成了调用点）
      expect(json.summary.cases).toBe(0);
      expect(json.functions).toEqual([]);
      expect(json.externalFunctions ?? []).toEqual([]);
    });
  }
  {
    await withLspServer(
      { "lib.nudo.js": SIDECAR, "lib.js": "export function getName(u) { return u.name; }\n" },
      async ({ req, dir }) => {
        const r = await req("nudo/check")({ file: `${dir}/lib.js`, format: "json" });
        expect(r.isError).toBeUndefined();
        const json = JSON.parse(r.content[0].text);
        expect(json.pathErrors).toBeUndefined();
        expect(json.signatures.length).toBe(1);
      },
    );
  }
  {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo.check")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
    });
  }
});




});


// ---------------------------------------------------------------------------
// 早退守卫的 else 分支不得被当成「其后非空」
// ---------------------------------------------------------------------------
describe("早退守卫的 else 分支不得被当成「其后非空」", () => {
/**
 * hover 的「早退守卫去 nullish」**忽略 `else` 分支**
 * ⇒ 窄化出**不成立**的类型（与 `nudo check` 自相矛盾）。
 *
 * 改前：`applyStmtFact` 只看 `if` 的 then 分支是否以 return/throw 结束 ⇒
 * `if (!p) { return 0; } else { void 0; }` 之后也置 `nonNullish` ⇒
 * hover 把 `p` 窄化成非空（`p: number()`）——**else 分支会继续往下走**，
 * 该路径上 `p` 仍可能是 nullish。
 *
 * oracle（协议面 `textDocument/hover`）：
 * - 带 else 的 `f`：`return p;` 处的形参**不得**被剥掉 nullish 包装；
 * - 不带 else 的 `g`（对照组）：早退守卫成立 ⇒ 剥离是对的（保持原行为）。
 */



const SRC = `export function f(p) {
  if (!p) {
    return 0;
  } else {
    void 0;
  }
  return p;
}

export function g(p) {
  if (!p) {
    return 0;
  }
  return p;
}
`;

const SIDECAR = `import { fn, number, nullable } from "@nudojs/core";
export const f = fn({ p: nullable(number()) }, number());
export const g = fn({ p: nullable(number()) }, number());
`;

/** hover 协议响应的纯文本（```nudo 围栏内的内容） */
function hoverText(value: string | undefined): string {
  return value ?? "";
}


  it("带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）；对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）", async () => {
  {
    await withLspServer(
      { "hover773.js": SRC, "hover773.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // f 的 `return p;`（第 7 行，列 9）
        const res = (await hover({
          textDocument: { uri: uri("hover773.js") },
          position: { line: 6, character: 9 },
        })) as { contents: { value: string } } | null;
        const text = hoverText(res?.contents?.value);
        expect(text).toContain("p: nullable(number())");
        // 改前这里是 `p: number()`（else 分支被忽略 ⇒ 窄化不成立）
        expect(text).not.toMatch(/p: number\(\)/);
      },
    );
  }
  {
    await withLspServer(
      { "hover773.js": SRC, "hover773.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // g 的 `return p;`（第 14 行，列 9）
        const res = (await hover({
          textDocument: { uri: uri("hover773.js") },
          position: { line: 13, character: 9 },
        })) as { contents: { value: string } } | null;
        const text = hoverText(res?.contents?.value);
        expect(text).toContain("p: number()");
      },
    );
  }
});


});


// ---------------------------------------------------------------------------
// 契约形参的 hover 文本与 `nudo check` 同口径
// ---------------------------------------------------------------------------
describe("契约形参的 hover 文本与 `nudo check` 同口径", () => {
/**
 * hover 的侧车契约面用**声明形态**、`nudo check` 用**推断形态**
 * ⇒ 同一函数两套参数类型文本（IDE 说的是侧车 DSL 原文，CLI 说的是类型）。
 *
 * 改前（协议面 hover 签名块）：
 * `addc(x: number().gt(0), y: number().gt(0)) => number`
 * 而 `nudo check` 的签名行是：
 * `addc(x: number, y: number) => number`
 *
 * 修法（hover.ts）：契约形参的展示文本改用 **check 同口径**的推断 shape
 * （core `check-signatures.formatEntryParamShape` 同公式：showLits +
 * nullish 字面量名）——**union（和类型）契约参数除外**：判别联合的
 * `formatShape` 展开可达数万字符且臂的身份只由用户自己的类型名承载 ⇒
 * 保留声明形态（折叠的原始意图，见 PUBLIC_API.md 的 hoverProvider 行）。
 */



const SRC = `export function addc(x, y) {
  return x + y;
}
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const addc = fn({ x: number().gt(0), y: number().gt(0) }, number().gt(0));
`;

/** union 契约参数 ⇒ 保留声明形态（判别联合的展开不可读） */
const UNION_SRC = `export function addn(p) {
  return p;
}
`;

const UNION_SIDECAR = `import { fn, number, nullable } from "@nudojs/core";
export const addn = fn({ p: nullable(number()) }, number());
`;


  it("签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）；形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）；union 契约参数保留声明形态（判别联合折叠不回归）", async () => {
  {
    await withLspServer(
      { "hover775.js": SRC, "hover775.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addc`（第 1 行，列 16）
        const res = (await hover({
          textDocument: { uri: uri("hover775.js") },
          position: { line: 0, character: 16 },
        })) as { contents: { value: string } } | null;
        const text = res?.contents?.value ?? "";
        expect(text).toContain("addc(x: number, y: number)");
        expect(text).not.toContain("number().gt(0)");
      },
    );
  }
  {
    await withLspServer(
      { "hover775.js": SRC, "hover775.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addc(x, y)` 的 `x`（第 1 行，列 20）
        const res = (await hover({
          textDocument: { uri: uri("hover775.js") },
          position: { line: 0, character: 20 },
        })) as { contents: { value: string } } | null;
        const text = res?.contents?.value ?? "";
        expect(text).toContain("x: number");
        expect(text).not.toContain("number().gt(0)");
      },
    );
  }
  {
    await withLspServer(
      { "hover775u.js": UNION_SRC, "hover775u.nudo.js": UNION_SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addn`（第 1 行，列 16）
        const res = (await hover({
          textDocument: { uri: uri("hover775u.js") },
          position: { line: 0, character: 16 },
        })) as { contents: { value: string } } | null;
        expect(res?.contents?.value ?? "").toContain("p: nullable(number())");
      },
    );
  }
});



});


// ---------------------------------------------------------------------------
// check 通道的 info 级诊断在 verbose 档必须上屏
// ---------------------------------------------------------------------------
describe("check 通道的 info 级诊断在 verbose 档必须上屏", () => {
/**
 * check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。
 *
 * 症状：`checkToLspDiagnostics` 在转换前就 `filter(severity === "error" ||
 * "warning")` ⇒ 下游的档位过滤器（`filterCheckLspByLevel`）永远看不到 info ⇒
 * `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**，
 * `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
 * 永不上屏（CLI `nudo check` 却照常打印 ⇒ 同一份源码两侧集合不一致）。
 *
 * 修法（片 E）：转换点保留三档（error / warning / info），档位取舍**只**由
 * `filterCheckLspByLevel` 决定（verbose 放行 info；default/errors/off 不放行）。
 *
 * 钉：verbose 档下 info 上屏（push + pull 两条通道）；default 档下 info 不上屏
 * （不回归：默认面只放 error / warning）。
 */







/** `@nudo:assume` ⇒ check 通道产出 info 级 nudo:assume-relied */
const SRC = `/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;

/**
 * 侧车契约：`sim` 的返回契约 `number().ge(0).le(1)` 只能靠 `@nudo:assume d <= max`
 * 这条用户引理证明 ⇒ check 通道产出 info 级 `nudo:assume-relied`。
 * （侧车的 `@nudojs/core` import 由 core 注入，无需 node_modules 解析。）
 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const ASSUME_CODE = "nudo:assume-relied";

function openSession(pkg: unknown): {
  mock: ReturnType<typeof createMockConnection>;
  uri: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug779-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
  const file = join(dir, "info.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(join(dir, "info.nudo.js"), SIDECAR, "utf-8");
  const uri = `file://${file}`;
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
  });
  return {
    mock,
    uri,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const VERBOSE_PKG = {
  name: "bug779-verbose",
  private: true,
  type: "module",
  nudo: { analysis: { diagnostics: "verbose" } },
};

const DEFAULT_PKG = { name: "bug779-default", private: true, type: "module" };


  it("push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）；pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）；默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）", async () => {
  {
    const { mock, uri, cleanup } = openSession(VERBOSE_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === ASSUME_CODE);
      expect(pushed.length, "info 诊断未上屏（push）").toBeGreaterThan(0);
      expect(pushed[0].severity).toBe(3); // DiagnosticSeverity.Information
    } finally {
      cleanup();
    }
  }
  {
    const { mock, uri, cleanup } = openSession(VERBOSE_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const res: any = await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      });
      const pulled = (res?.items ?? []).filter((d: any) => d.code === ASSUME_CODE);
      expect(pulled.length, "info 诊断未上屏（pull）").toBeGreaterThan(0);
      expect(pulled[0].severity).toBe(3); // DiagnosticSeverity.Information
    } finally {
      cleanup();
    }
  }
  {
    const { mock, uri, cleanup } = openSession(DEFAULT_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === ASSUME_CODE);
      expect(pushed.length, "默认档不应上屏 info").toBe(0);
    } finally {
      cleanup();
    }
  }
});



});


// ---------------------------------------------------------------------------
// agent nudo/check 接上补充诊断通道
// ---------------------------------------------------------------------------
describe("agent nudo/check 接上补充诊断通道", () => {
/**
 * agent 工具 `nudo/check` 只跑裸 `checkSource` ⇒ CLI / LSP 并入
 * check 报告的**补充诊断通道**一条都没接 ⇒ 同一文件三个面三份 issue 集。
 *
 * 本钉覆盖两条旁路通道：
 * 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与
 * service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组，
 * 不会流进 `checkSource` 的返回值；
 * 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态
 * （`getPathEnvLoadErrors`），既不是 `checkSource` 的入参也不是返回值。
 *
 * 改前 agent 面：`summary.warnings = 0`、`issues` 为空、`ok: true` ⇒ 一个按
 * `nudo/check` 结果决策的 agent 会认为「文件完全干净」。
 */



const D1_SYNTAX = `/**
 * @nudo:sample abc
 */
export function add(a) {
  return a + 1;
}
`;

const D2_ENV = `/// @nudo:env "./nope.mjs"
export function add(a) {
  return a + 1;
}
`;


  it("指令文法诊断（nudo:directive-syntax）并入 issues + summary；path env 未解析（nudo:env-unresolved）并入 issues + summary；dot 形式同样接上（协议别名不降级）", async () => {
  {
    await withLspServer({ "d1_syntax.js": D1_SYNTAX }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/d1_syntax.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:directive-syntax",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("warning");
      expect(json.summary.warnings).toBeGreaterThanOrEqual(1);
    });
  }
  {
    await withLspServer({ "d2_env.js": D2_ENV }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/d2_env.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:env-unresolved",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("warning");
      expect(issue.message).toContain("nope.mjs");
      expect(json.summary.warnings).toBeGreaterThanOrEqual(1);
    });
  }
  {
    await withLspServer({ "d1_syntax.js": D1_SYNTAX }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/d1_syntax.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:directive-syntax");
    });
  }
});



});


// ---------------------------------------------------------------------------
// 三个 contract 工具的 --from 等价通道
// ---------------------------------------------------------------------------
describe("三个 contract 工具的 --from 等价通道", () => {
/**
 * agent 的三个 contract 工具要有 `--from`（使用点记录）等价通道。
 *
 * 症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit`
 * 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**：
 * ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；
 * ② 草稿是空契约 `fn({})`——照 agent 自己的指引采纳后门禁仍红；
 * ③ emit 直接拒写（`skipped addOne (not-projectable)`），而 CLI 同参数写得出来。
 *
 * 修法：三个工具加 `from?: string[]`（文件或目录），采集口径与 CLI
 * `nudo contract --from` 同源（顶层调用表达式 ⇒ call@ 记录）。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */






const LIB = `export function addOne(x) {
  return x + 1;
}
`;
const MAIN = `import { addOne } from "./lib.js";

addOne(2);
`;


  it("协议面 nudo/contract：带 from ⇒ 使用点证据参与求解；协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）；工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）；from 指向不存在的路径 ⇒ 显式报错（不静默给假面）", async () => {
  {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, uri }) => {
        const withFrom = await req("nudo/contract")({
          file: uri("lib.js"),
          from: [uri("main.js")],
        });
        expect(withFrom.content[0].text).toContain("(x: 2) → 3");
        // 对照组：不给 from ⇒ 宽一整级
        const without = await req("nudo/contract")({ file: uri("lib.js") });
        expect(without.content[0].text).toContain("(x: any) → number | string");
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, uri }) => {
        const withFrom = await req("nudo/contract.draft")({
          file: uri("lib.js"),
          from: [uri("main.js")],
        });
        expect(withFrom.content[0].text).toContain("fn({ x: number() })");
        expect(withFrom.content[0].text).not.toContain("export const addOne = fn({});");
        const without = await req("nudo/contract.draft")({ file: uri("lib.js") });
        expect(without.content[0].text).toContain("export const addOne = fn({});");
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ dir }) => {
        const file = join(dir, "lib.js");
        const r = await contractEmitTool(
          { file, functionName: "addOne", mode: "add", from: [join(dir, "main.js")] },
          { workspaceRoots: [dir] },
        );
        const text = r.content[0].text;
        expect(text).not.toContain("not-projectable");
        expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
        expect(readFileSync(join(dir, "lib.nudo.js"), "utf-8")).toContain(
          "export const addOne = fn(",
        );
      },
    );
  }
  {
    await withLspServer({ "lib.js": LIB }, async ({ req, uri, dir }) => {
      const r = await req("nudo/contract")({
        file: uri("lib.js"),
        from: [join(dir, "nope.js")],
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("no call-site records collected");
    });
  }
});




});


// ---------------------------------------------------------------------------
// CJS 成员导出的符号 / 观察面
// ---------------------------------------------------------------------------
describe("CJS 成员导出的符号 / 观察面", () => {
/**
 * CJS 成员导出（`exports.f = fn` / `module.exports.f = fn`）在 LSP 的
 * 4 个符号 / 观察面 + codeLens 的 contract 档上**整段消失**。
 *
 * 症状（真 server 协议面，改前）：
 * - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）；
 * - `workspace/symbol` 查 `alpha` → 查不到；
 * - `textDocument/inlayHint` → `[]`；
 * - `textDocument/semanticTokens/full` → 只有形参 token，函数名没有 function 档；
 * - `textDocument/codeLens` → 只有 entry@ 观察层，没有 contract 档；
 * - 而诊断面明明点名 `alpha (export)` —— 符号面查不到、诊断面却报得出。
 *
 * 根因：四处枚举各自为政，都不认 CJS 成员导出形态
 * （`localNamedExports` / core `listTopFunctions` 早已认得）。
 *
 * 期望：CJS 成员导出与 ESM 具名导出在 4 个面上同形。
 */




const CJS_SRC = [
  "module.exports.alpha = function (x) {",
  "  return x + 1;",
  "};",
  "exports.beta = function (y) {",
  "  return y * 2;",
  "};",
  "",
].join("\n");

const ESM_SRC = [
  "export function alpha(x) {",
  "  return x + 1;",
  "}",
  "export function beta(y) {",
  "  return y * 2;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};


  it("documentSymbol 出 CJS 成员导出（函数档，detail 带 export）；workspace/symbol 查得到 CJS 成员导出；semanticTokens 给 CJS 导出键 function 档 + contract 档 modifier；inlayHint 出 CJS 导出的返回 inlay + contract 档投影；codeLens 出 CJS 导出的 contract 档（契约身份 = 导出名）；hover 面解析出 CJS 导出名（族", async () => {
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string; detail?: string; kind: number }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
      expect(syms[0]!.detail).toBe("(x) export");
      expect(syms[0]!.kind).toBe(12); // SymbolKind.Function
    });
  }
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      void uri;
      const syms = req("workspace/symbol")({ query: "alpha" }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toContain("alpha");
    });
  }
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/semanticTokens/full")({
        textDocument: { uri: uri("a.js") },
      }) as { data: number[] };
      const tokens = decodeSemanticTokens(res.data);
      // alpha 键：function 档（typeIndex 0）+ declaration|derived（modifier 65）
      expect(tokens[0]).toEqual({
        line: 0,
        char: 15,
        length: 5,
        typeIndex: 0,
        modifiers: 65,
      });
      // beta 键
      expect(tokens[2]).toEqual({
        line: 3,
        char: 8,
        length: 4,
        typeIndex: 0,
        modifiers: 65,
      });
    });
  }
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 20, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      const labels = hints.map((h) => h.label);
      expect(labels.some((l) => l.includes(": x + 1"))).toBe(true);
      expect(labels.some((l) => l.includes(": y * 2"))).toBe(true);
      expect(labels.filter((l) => l === "  ● contract / imp").length).toBe(2);
    });
  }
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const alpha = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "alpha",
      );
      expect(alpha).toBeDefined();
      expect(alpha!.range.start.line).toBe(0);
      const beta = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "beta",
      );
      expect(beta).toBeDefined();
      expect(beta!.range.start.line).toBe(3);
    });
  }
  {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover")({
        textDocument: { uri: uri("a.js") },
        // 第 1 行（0-based）的 `alpha`（`module.exports.alpha = …`）
        position: { line: 0, character: 16 },
      }) as { contents?: { value?: string } } | null;
      const text = hover?.contents?.value ?? "";
      // 改前：无名 `(x) => ?`（名字解析不出来）⇒ 诊断面认得它、hover 面不认
      expect(text).toContain("alpha");
      expect(text).not.toContain("(x) => ?");
    });
  }
  {
    await withLspServer({ "a.js": ESM_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
    });
  }
});







});
