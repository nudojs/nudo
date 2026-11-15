/**
 * 模块套件：check/contract/inject/relax 面。
 */
import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { withLspServer, withTempDir, createMockConnection } from "./helpers.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyzeFileAsync, clearPathEnvCaches, defaultLoadModule } from "@nudojs/service";
import { checkToLspDiagnostics, clearValidationState, validateText, type LspDiagnostic, type ValidateTextDeps } from "../validation.ts";
import { applyEdits, codeActionParams, mountCodeActions, sidecarEdits, type CodeActionEntry, missingFieldDiag, docEdits } from "./lsp-bug-r90a-harness.ts";
import { buildTestReport } from "../../../nudojs/src/run-test.ts";
import { computeObservationLenses, contractEmitTool } from "../agent-tools.ts";
import { parse } from "@nudojs/parser";
import { collectBindingReferences } from "../symbols.ts";
import { startLspWithFiles, locationsOf, type LspHarness, editsOf } from "./lsp-bug-d3-harness.ts";
import { findFnContractInsertPos } from "../sidecar-insert.ts";
import { pathToFileURL } from "node:url";
import { createNudoServer } from "../server.ts";
import { decodeSemanticTokens } from "./lsp-bug-d4-harness.ts";

// ---------------------------------------------------------------------------
// Bug 1025 — 别名 import 的 imported 侧：definition 落到正确模块、references 不为空
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1025 — 别名 import 的 imported 侧：definition 落到正确模块、references 不为空", () => {
/**
 * Bug 1025 —— import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧**
 * 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿）
 * ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。
 *
 * 报告说的症状（**假阳性 —— 两个症状都不复现**）：
 *   夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；`plain.js` 走**无别名**
 *   import、`aliased.js` 走**别名** import（两者都从 `./zzz.js` 导入 ⇒
 *   **唯一变量 = 有没有别名**）。
 *   报告实测：别名 import 的 imported 侧 `helper` ⇒ `definition = aaa.js`、
 *   `references = []`。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 *   · `aliased.js` 的 **imported 侧** `helper`@0:9 ⇒
 *     `definition = ["zzz.js:0:16-0:22"]` ⇒ **跳到正确的模块**（**不是** `aaa.js`）；
 *     `references = ["zzz.js:0:16-0:22","plain.js:0:9-0:15","plain.js:2:17-2:23",
 *     "aliased.js:0:9-0:15"]` ⇒ **不是 `[]`**，且与**无别名形态**（`plain.js`
 *     的 imported 侧）**完全一致**。
 *   · `aliased.js` 的 **local 侧** `p`@0:19 ⇒
 *     `definition = ["zzz.js:0:16-0:22","aliased.js:0:19-0:20"]` ⇒ 正确。
 *
 * ⇒ **症状**已被覆盖：`findEdgeAt`（`symbols.ts`，**位置感知**）先拿到光标处
 *   **那一条具体的 import 说明符** ⇒ imported 侧不再靠「本地名」猜模块；
 *   `resolveDefinitionLocations` 的 `at` 透传让 `workspaceFallback` 只在
 *   `out.length === 0` 时才走 ⇒ **不会**落到无关的同名导出。
 *
 * ⚠ **根因字面仍成立**：`collectImportBindings`（`symbols.ts`）的键**仍只取本地名**
 *   ⇒ 当前之所以没炸，是因为上面那条**位置感知旁路**恰好绕开了它
 *   ⇒ **一旦有人删改那条旁路，1025 的症状会原样复活**
 *   ⇒ 本钉就是「别把旁路改坏」的护栏（**族 24 残留项**，本片不修）。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸）。
 */



/** 无关的**同名导出**（工作区兜底的「猎物」） */
const AAA = `export function helper(x) {
  return "WRONG-FILE-aaa";
}
`;
/** 真正的来源模块 */
const ZZZ = `export function helper(x) {
  return "RIGHT-FILE-zzz";
}
`;
/** 无别名 import（对照组）：imported 侧 `helper` 在 0:9-0:15，用法在 2:17-2:23 */
const PLAIN = `import { helper } from "./zzz.js";

export const a = helper(1);
`;
/** 别名 import：imported 侧 `helper` 在 0:9-0:15，local 侧 `p` 在 0:19-0:20 */
const ALIASED = `import { helper as p } from "./zzz.js";

export const b = p(2);
`;

type Loc = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

/** Location[] ⇒ 可断言的位点列表（按 file/line/character 排序） */
function locsOf(result: unknown): Loc[] {
  if (!Array.isArray(result)) return [];
  return (result as any[])
    .map((l) => ({
      file: String(l?.uri ?? "").split("/").pop() ?? "",
      line: l?.range?.start?.line ?? -1,
      character: l?.range?.start?.character ?? -1,
      endLine: l?.range?.end?.line ?? -1,
      endCharacter: l?.range?.end?.character ?? -1,
    }))
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
    );
}

const ZZZ_DECL: Loc = {
  file: "zzz.js",
  line: 0,
  character: 16,
  endLine: 0,
  endCharacter: 22,
};

describe("Bug 1025 — 别名 import 的 imported 侧：definition 落到正确模块、references 不为空", () => {
  it("definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(
          defs.filter((d) => d.file === "aaa.js"),
          "definition 不得退到工作区里无关的同名导出（aaa.js）",
        ).toEqual([]);
      },
    );
  });

  it("references@imported 侧：不是空数组，且与无别名形态完全一致", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const aliasedRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
            context: { includeDeclaration: true },
          }),
        );
        const plainRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("plain.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`（无别名对照）
            context: { includeDeclaration: true },
          }),
        );
        expect(
          aliasedRefs.length,
          "别名 import 的 imported 侧 references 不得返回空数组（假绿）",
        ).toBeGreaterThan(0);
        expect(aliasedRefs).toContainEqual(ZZZ_DECL);
        expect(
          aliasedRefs.filter((r) => r.file === "aaa.js"),
          "references 不得混进无关的同名导出",
        ).toEqual([]);
        // 唯一变量 = 有没有别名 ⇒ 两侧的引用集必须**完全一致**
        expect(aliasedRefs).toEqual(plainRefs);
      },
    );
  });

  it("definition@local 侧：仍然落到真正被导入的模块", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 19 }, // local 侧 `p`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(defs.filter((d) => d.file === "aaa.js")).toEqual([]);
      },
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1104: LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1104: LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）", () => {
/**
 * Bug 1104 —— LSP **check 通道**看不见**项目级** path env ⇒ IDE 假红
 * （`nudo:entry-may-throw`），而 CLI `nudo check` 绿（两面口径相反）。
 *
 * 机制：`buildLspInjection`（`packages/lsp/src/agent-tools.ts`）把
 * `package.json#nudo.env` 的**原始相对名**（`./env.mjs`）塞进注入包；
 * 而 `checkSource` 的 env 查表基准 = 「**最后一次**预载的目录」= **文件目录**
 * （文件级 env 预载在后）⇒ 相对说明符的唯一候选 = `<proj>/src/env.mjs`
 * ≠ 预载登记的 `<proj>/env.mjs` ⇒ 查表落空 ⇒ env 全局缺失 ⇒ 入口求值抛
 * `ReferenceError: MAGIC is not defined` ⇒ 报 L2 `nudo:entry-may-throw`。
 * CLI 侧 `assembleEnvs` 早已把项目级说明符按**项目根**绝对化 ⇒ CLI 绿。
 *
 * 修法：项目级 env 说明符按**项目根**（`proj.projectDir`）绝对化，与 CLI
 * `assembleEnvs` 同款（共用 service 的 `absolutizeEnvSpec` 单一事实源）；
 * 文件级 env **仍按文件目录解析**（保持相对名），裸拼写名的既有判定口径不变。
 *
 * 钉：
 * - 正控制：项目根有 path env + 被检查文件在**子目录**且声明了文件级 env
 *   ⇒ LSP check 通道**不得**报 L2 `nudo:entry-may-throw`（env 全局可见）；
 * - 负控制：**真违约**（入口真的 throw）⇒ 仍**必须**报 L2 `nudo:entry-may-throw`
 *   （防止把闸门整体关掉）。
 */







/** 项目级 env（项目根）：MAGIC = 42。 */
const ENV_MJS = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

/** 合法入口：读 env 全局（env 可见 ⇒ 不抛 ⇒ 不得报 L2）。 */
const OK_SRC = `/// @nudo:env node
export function f() { return MAGIC; }
`;

/** 真违约：入口真的抛 ⇒ 必须报 L2（负控制）。 */
const THROW_SRC = `/// @nudo:env node
export function g() { throw new Error("boom"); }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时项目：package.json（项目级 env）+ env.mjs（项目根）+ src/<name>.js。 */
function makeProject(name: string, src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-1104-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, private: true, nudo: { env: ["./env.mjs"] } }),
    "utf-8",
  );
  writeFileSync(join(dir, "env.mjs"), ENV_MJS, "utf-8");
  const file = join(dir, "src", "app.js");
  writeFileSync(file, src, "utf-8");
  return { dir, file };
}

function collector(): { sent: LspDiagnostic[]; deps: ValidateTextDeps } {
  const sent: LspDiagnostic[] = [];
  return {
    sent,
    deps: {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    },
  };
}

function codes(diags: LspDiagnostic[]): string[] {
  return diags.map((d) => String(d.code));
}

describe("Bug 1104: LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）", () => {
  beforeEach(() => {
    clearValidationState();
    clearPathEnvCaches();
  });

  it("正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）", async () => {
    const { file } = makeProject("envproj-ok", OK_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, OK_SRC, 1, deps);

    const c = codes(sent);
    expect(c).not.toContain("nudo:entry-may-throw");
    // env 全局可见 ⇒ 也不该报「内建 API 未覆盖」
    expect(c).not.toContain("nudo:builtin-unknown");
  });

  it("正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-ok2", OK_SRC);
    // 预载态：IDE 的分析通道（analyzeFileAsync）先跑 ⇒ path env 已登记
    await analyzeFileAsync(file, OK_SRC);

    const diags = checkToLspDiagnostics(file, OK_SRC);
    expect(codes(diags)).not.toContain("nudo:entry-may-throw");
  });

  it("负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-throw", THROW_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, THROW_SRC, 1, deps);

    // 闸门没被整体关掉：真违约照报
    expect(codes(sent)).toContain("nudo:entry-may-throw");
  });

  it("负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-throw2", THROW_SRC);
    await analyzeFileAsync(file, THROW_SRC);

    const diags = checkToLspDiagnostics(file, THROW_SRC);
    expect(codes(diags)).toContain("nudo:entry-may-throw");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 133 · 放宽侧车契约必须打在被违反的参数槽
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 133 · 放宽侧车契约必须打在被违反的参数槽", () => {
/**
 * BUG-133 —— 「放宽侧车契约」quickfix 对**参数违例**打到**返回槽**
 *
 * 现象：诊断是 `argument ⊭ precondition`（参数违例），动作却把侧车的**返回槽**
 * 改掉（`number().gt(40)` → `number()`）⇒ 参数诊断原样保留、返回契约被静默削弱。
 * 根因：`loosen` 正则不匹配诊断文案 ⇒ `param === undefined` ⇒ 替换器落到
 * `tryReturnSlot`；且动作**没有**「落盘后诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 参数违例的放宽动作只能改**被违反形参**的槽：标题带 `greet.u`、
 *    编辑只剥 `u` 的数值谓词，返回槽的 `.gt(40)` 原样保留；
 * 2. 落盘后目标参数诊断**真的消失**（动作可执行，不是假修复）；
 * 3. 改不动参数槽时（shape 参数）**不下发**放宽动作 —— 尤其不得退化成
 *    「改返回槽」（旧症状：参数诊断仍在 + 返回契约被削弱）；
 * 4. 证据面：旧的那份返回槽编辑（`.gt(40)` → `number()`）对参数诊断
 *    一字无效 ⇒ 不下发是被诊断验证的，不是拍脑袋。
 */








/** BUG-133 段内夹具（逐字） */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 参数槽可放宽的对照：同一诊断形态，但形参是数值谓词 */
const GREET_JS_NUM = `export function greet(u) {
  return 42;
}
greet(-1);
`;
const SC_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number());
`;
/** 参数槽可放宽 + 返回槽带数值谓词（旧实现会误伤的那一份） */
const SC_NUM_RET = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number().gt(40));
`;

const isParamDiag = (msg: string): boolean => /argument ⊭ precondition/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
const msgText = (m: string | { value: string }): string =>
  typeof m === "string" ? m : m.value;

/** 落盘夹具 → 目标诊断 → 该诊断的 codeAction 列表 */
function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
) : { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
  return withTempDir(dirPrefix, (dir) => {
    const jsPath = join(dir, "greet.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(join(dir, "greet.nudo.js"), sc, "utf-8");
    const uri = `file://${jsPath}`;
    const diags = checkToLspDiagnostics(jsPath, js, defaultLoadModule);
    const target = diags.filter((d) => pick(msgText(d.message)));
    expect(target.length).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, messages: target.map((d) => msgText(d.message)), scText: sc, uri };
  });
}

describe("Bug 133 · 放宽侧车契约必须打在被违反的参数槽", () => {
  it("参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）", () => {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133a-", GREET_JS_NUM, SC_NUM_RET, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 标题必须指出目标槽：`greet` 后面带 `.u`（旧实现标题只有 `greet`）
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet.u");

    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe(
      `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(40));
`,
    );
    // 落盘后：只放宽了 u，返回槽的 `.gt(40)` 一字未动
    const landed = applyEdits(scText, edits);
    expect(landed).toContain("fn({ u: number() }");
    expect(landed).toContain("number().gt(40)");
  });

  it("落盘后目标参数诊断消失（编辑真的可执行，不是假修复）", () => {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133b-", GREET_JS_NUM, SC_NUM, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    const landed = applyEdits(scText, sidecarEdits(relax, uri));
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-133b-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_NUM, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_NUM, defaultLoadModule);
      expect(after.filter((d) => isParamDiag(msgText(d.message)))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  });

  it("参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽", () => {
    const { actions, messages } = actionsFor("nudo-lsp-133c-", GREET_JS, SC_SHAPE, isParamDiag);
    // 目标确实是参数违例（expected: missing field u.name）
    expect(messages.join("\n")).toMatch(/missing field u\.name/);
    // 旧实现会下发标题「Relax sidecar contract for greet」→ 改返回槽 ⇒ 参数诊断仍在
    expect(actions.filter(isRelax)).toHaveLength(0);
    // 任何候选动作都不得削弱返回契约
    const allSidecarText = actions.map((a) =>
      JSON.stringify(a.edit?.changes ?? {}),
    ).join("\n");
    expect(allSidecarText).not.toContain("fn({ u: shape({ name: string() }) }, number())");
    // 参数违例本身仍引导用户改**调用点**
    expect(actions.map((a) => a.title)).toContain("Add missing field 'name' to call");
  });

  it("证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）", () => {
    withTempDir("nudo-lsp-133d-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      // 旧 quickfix 的落盘结果：返回槽 number().gt(40) → number()
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      // 参数诊断原样保留
      expect(after.filter((d) => isParamDiag(msgText(d.message)))).toHaveLength(1);
      expect(after.map((d) => msgText(d.message)).join("\n")).toMatch(/missing field u\.name/);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 134 · 放宽侧车契约不得下发消不掉诊断的假修复
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 134 · 放宽侧车契约不得下发消不掉诊断的假修复", () => {
/**
 * BUG-134 —— 「放宽侧车契约」quickfix 对**基类型不匹配**（`string ⊭ number`）
 * 永远消不掉诊断 ⇒ 建议不可执行
 *
 * 现象：返回值基类型就与侧车返回槽冲突时，动作只会剥数值谓词
 * （`number().gt(40)` → `number()`）⇒ 诊断**一字未消**（`string ⊭ number`），
 * 用户点完「修复」diff 出来了、诊断一条不少。
 * 根因：`stripNumericPreds` 只剥数值谓词，没有「`number()` → `string()`」路径；
 * 动作只检查「有 diff」就下发，**没有**「落盘后目标诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 基类型冲突（不可解）⇒ **不下发**放宽动作（无 diff 可清诊断）；
 * 2. 证据面：旧动作的落盘结果（返回槽 → `number()`）诊断原样还在
 *    ⇒ 不下发是被诊断验证的，不是拍脑袋；
 * 3. 校准（正控制）：返回槽**数值**冲突可解时动作仍在、落盘后诊断消失
 *    ⇒ 门不是「一刀切封杀」，判据 = 编辑是否真的清掉目标诊断；
 * 4. 返回槽没有可放宽的数值精化（`number()`）⇒ 不下发（无 edit 空转）。
 */








/** BUG-134 段内夹具（逐字）：返回 `u.name`（string）⊭ 返回槽 number().gt(40) */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 返回槽放宽**可解**的对照：返回 42 只违反对数值下界 */
const GREET_JS_RET = `export function greet(u) {
  return 42;
}
greet(0);
`;
const SC_RET_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(80));
`;

const isReturnBaseDiag = (msg: string): boolean => /return value ⊭ sidecar/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
const msgText = (m: string | { value: string }): string =>
  typeof m === "string" ? m : m.value;

function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
): { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
  return withTempDir(dirPrefix, (dir) => {
    const jsPath = join(dir, "greet.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(join(dir, "greet.nudo.js"), sc, "utf-8");
    const uri = `file://${jsPath}`;
    const diags = checkToLspDiagnostics(jsPath, js, defaultLoadModule);
    const target = diags.filter((d) => pick(msgText(d.message)));
    expect(target.length).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, messages: target.map((d) => msgText(d.message)), scText: sc, uri };
  });
}

describe("Bug 134 · 放宽侧车契约不得下发消不掉诊断的假修复", () => {
  it("返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑", () => {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134a-",
      GREET_JS,
      SC_SHAPE,
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/typeof return = "string" ⊭ "number"/);
    // 旧实现下发「Relax sidecar contract for greet」⇒ 只剥 .gt(40) ⇒ 诊断还在
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留", () => {
    withTempDir("nudo-lsp-134b-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(msgText(d.message)))).toHaveLength(1);
      expect(after.map((d) => msgText(d.message)).join("\n")).toMatch(
        /typeof return = "string" ⊭ "number"/,
      );
    });
  });

  it("返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）", () => {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134c-",
      GREET_JS,
      SC_SHAPE.replace("number().gt(40)", "number()"),
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/return slot \(number\(\)\)/);
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失", () => {
    const { actions, scText, uri } = actionsFor(
      "nudo-lsp-134d-",
      GREET_JS_RET,
      SC_RET_NUM,
      isReturnBaseDiag,
    );
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 返回槽（不是形参）⇒ 标题不带 `.u`
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet");
    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    const landed = applyEdits(scText, edits);
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-134d-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_RET, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_RET, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(msgText(d.message)))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 136 — codeLens 标题与 CLI nudo test 见证行逐字符同形
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 136 — codeLens 标题与 CLI nudo test 见证行逐字符同形", () => {
/**
 * Bug 136 —— LSP codeLens 标题与 CLI `nudo test` 见证行**不同形**。
 *
 * 症状（同文件、同分析，两面并排）：
 * - CLI `nudo test` 见证行：`"  entry@L1  (any) => unknown   throws TypeError"`
 *   （2 格容器缩进 + throws 前 **3** 空格）；
 * - LSP lens 标题：`"entry@L1  (any) => unknown  throws TypeError"`
 *   （无容器缩进 + throws 前 **2** 空格）。
 *
 * `agent-tools.ts` 的注释明文承诺「**标题与 test 报告同形**」⇒ 同一事实
 * 两面渲染不一致（非 throws 分支当时是一致的，只有 throws 分支分裂）。
 *
 * 修法：LSP 的 `observationTitle` 与 CLI 的 `formatCaseLine` 采用同一模板
 * （throws 前 3 空格；lens 标题不带容器缩进，CLI 报告在 `caseLines.push` 处加
 * 2 空格）⇒ 比对口径 = `"  " + lens.title`。
 *
 * 钉（同一 fixture、两条**产品**路径，不 spawn CLI）：
 * - CLI 侧：`buildTestReport(file, analyzeFileAsync(...))` 的 `caseLines`；
 * - LSP 侧：`computeObservationLenses(source, file)` 的 `title`；
 * ⇒ 逐字符相等：`caseLines` 含 `"  " + lens.title`（且反向：每条
 * `call@` / `entry@` 见证行都有同标题的 lens）。
 */








/** `tmp/repro/bug-136/half.js` 逐字内容 */
const HALF_SRC = `export function f(x) {
  return x.a.b;
}
f(undefined);
`;

describe("Bug 136 — codeLens 标题与 CLI nudo test 见证行逐字符同形", () => {
  it("每条 lens 标题在 CLI 报告里是 `  <title>`；throws 分支为 3 空格", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug136-"));
    try {
      const file = join(dir, "half.js");
      writeFileSync(file, HALF_SRC, "utf-8");

      const result = await analyzeFileAsync(
        file,
        HALF_SRC,
        undefined,
        undefined,
        undefined,
        "all",
      );
      const report = buildTestReport(file, result);
      const lenses = computeObservationLenses(HALF_SRC, file);

      const titles = lenses.map((l) => l.title);
      expect(titles.length, `lenses 为空 ⇒ 无法对拍`).toBeGreaterThan(0);

      // ① LSP → CLI：每条 lens 标题在报告里逐字符命中（含 2 格容器缩进）
      for (const lens of lenses) {
        expect(
          report.caseLines,
          `lens 标题不在 test 报告里：${JSON.stringify(lens.title)}`,
        ).toContain(`  ${lens.title}`);
      }

      // ② CLI → LSP：报告里每条 call@ / entry@ 见证行都有同标题的 lens
      const witnessLines = report.caseLines.filter((l) => /^ {2}(call@|entry@)/.test(l));
      expect(witnessLines.length).toBeGreaterThan(0);
      for (const line of witnessLines) {
        expect(titles, `报告见证行没有对应 lens：${JSON.stringify(line)}`).toContain(
          line.slice(2),
        );
      }

      // ③ throws 分支的绝对形态：`=> unknown` 与 `throws TypeError` 之间 3 空格
      const throwsLens = lenses.find((l) => l.title.includes("throws"));
      expect(throwsLens, `没有 throws 见证：${JSON.stringify(titles)}`).toBeDefined();
      expect(throwsLens!.title).toContain("=> unknown   throws TypeError");
      // 改前是 2 空格 ⇒ 这条断言把形态钉死（不靠两面互相自证）
      expect(throwsLens!.title).not.toContain("unknown  throws");
      // lens 标题不带容器缩进；报告行 = 2 空格 + 标题
      expect(throwsLens!.title.startsWith("entry@")).toBe(true);
      expect(report.caseLines).toContain(`  ${throwsLens!.title}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// Bug 634: LSP check 面施加 inject 通道（@nudo:mock 生效）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 634: LSP check 面施加 inject 通道（@nudo:mock 生效）", () => {
/**
 * Bug 634 回归（LSP 编辑器面）：check 通道必须施加 **inject 通道**
 * （`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局），与 CLI
 * `nudo check` 同源同口径。
 *
 * 病灶：本面此前只传 `modules`（不传 `inject`）⇒ 被 mock 掉的依赖退化成
 * 未知全局 ⇒ 报 `nudo:entry-may-throw`（**假红**：同一份文件 CLI 判绿、
 * IDE 判红）。
 *
 * 修法（packages/lsp/src/validation.ts）：复用本包唯一的注入装配器
 * `buildLspInjection`（packages/lsp/src/agent-tools.ts，与 agent 工具面
 * 同源），并按 CLI 的口径同时喂 `modules`（并入 env / mock-module 覆盖
 * 后的表）与 `inject`。
 *
 * 负控制：真的没有 mock 的文件，入口 may-throw 诊断**仍应**出现（不得把
 * 门禁整体关掉）。
 */






const MOCKED_SRC = `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`;

/** 无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛 */
const UNMOCKED_SRC = `export function g() {
  return notDefinedAnywhere(1);
}
`;

function codes(diags: { code?: string | number }[]): string[] {
  return diags.map((d) => String(d.code ?? ""));
}

describe("Bug 634: LSP check 面施加 inject 通道（@nudo:mock 生效）", () => {
  it("@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）", () => {
    withTempDir("nudo-lsp-bug-634-", (dir) => {
      const file = join(dir, "lib.js");
      writeFileSync(file, MOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, MOCKED_SRC);
      expect(codes(diags)).not.toContain("nudo:entry-may-throw");
    });
  });

  it("负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）", () => {
    withTempDir("nudo-lsp-bug-634b-", (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, UNMOCKED_SRC, "utf-8");
      const diags = checkToLspDiagnostics(file, UNMOCKED_SRC);
      expect(codes(diags)).toContain("nudo:entry-may-throw");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 702 — references 不得重复声明位 / 混入语句级伪引用
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 702 — references 不得重复声明位 / 混入语句级伪引用", () => {
/**
 * Bug 702 回归钉：LSP `textDocument/references` 不得把**声明位点返回两次**，
 * 也不得混入语句级伪引用。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   references on `score`（`export function score(row) {...}` 的声明位）
 *     → [0:16-0:21]（声明）、[0:16-0:21]（**同一个声明再来一次**）、
 *       [0:0-2:1]（**整条 export 声明**）、…（跨文件引用）
 *   ⇒ 同一个位置出现两次；客户端按位置高亮会出现重影。
 *
 * 根因（两条）：
 *   1) `resolveReferences` 把「符号表里的声明位」与「引用集合里的声明位」
 *      各推一次（两处坐标相同）⇒ 重复；
 *   2) 导出绑定的 `referencePaths` 里混着 `ExportNamedDeclaration` **语句
 *      节点** ⇒ 变成一条覆盖整条声明的伪引用（与 Bug 699 同源）。
 *
 * 修法：① 引用集合按 (uri, 位置) 去重；② `collectBindingReferences` 的
 * referencePaths 只收 Identifier 节点（语句级目标不再进引用集合）。
 */





const C_SRC = `export function score(row) {
  return row.id;
}
`;

describe("Bug 702 — references 不得重复声明位 / 混入语句级伪引用", () => {
  it("collectBindingReferences：导出绑定不产生语句级伪引用", () => {
    const ast = parse(C_SRC);
    const refs = collectBindingReferences(ast, "score", { line: 1, column: 17 }, "file:///t/c.js");
    expect(refs.length).toBe(1);
    expect(refs[0]!.loc.start.line).toBe(1);
    expect(refs[0]!.loc.start.column).toBe(16);
    expect(refs[0]!.loc.end.column).toBe(21);
    // 不得出现覆盖整条声明的「引用」
    for (const r of refs) {
      expect(r.loc.end.line).toBe(r.loc.start.line);
    }
  });

  it("协议面：references 的每个位置只出现一次", async () => {
    await withLspServer(
      {
        "c.js": C_SRC,
        "d.js": `import { score } from "./c.js";\nexport function use(row) {\n  return score(row);\n}\n`,
      },
      async ({ req, uri }) => {
        const res = req("textDocument/references")({
          textDocument: { uri: uri("c.js") },
          position: { line: 0, character: 16 },
          context: { includeDeclaration: true },
        });
        const locs = res as any[];
        expect(Array.isArray(locs)).toBe(true);
        const keys = locs.map((l) => `${l.uri}:${l.range.start.line}:${l.range.start.character}`);
        // 同一位置不得出现两次
        expect(new Set(keys).size).toBe(keys.length);
        // 声明位恰好一次
        const decls = locs.filter(
          (l) => l.uri === uri("c.js") && l.range.start.line === 0 && l.range.start.character === 16,
        );
        expect(decls.length).toBe(1);
        // 不得混入覆盖整条 export 声明的伪引用
        for (const l of locs) {
          const width =
            l.range.start.line === l.range.end.line
              ? l.range.end.character - l.range.start.character
              : Number.MAX_SAFE_INTEGER;
          expect(width).toBeLessThanOrEqual(21);
        }
      },
      "nudo-lsp-702-",
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 703 — export default 的跨文件 references
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 703 — export default 的跨文件 references", () => {
/**
 * Bug 703 — export default 的跨文件 references 为空。
 *
 * 症状：definition 能跳到 default 导出的定义，references 却查不到任何调用方
 * （自相矛盾）。根因：跨文件引用匹配用的是**导出名**，而 default 导入的
 * importedName 是 "default"、被查符号的本地名是 "greet" ⇒ 永远匹配不上。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const A = `export default function greet(n) {
  return n + 1;
}
`;
const B = `import greet from "./a.js";

export function use() {
  return greet(1);
}
`;

describe("Bug 703 — export default 的跨文件 references", () => {
  it("default 导出的定义处能查到 default 导入方的 import 说明符与调用点", async () => {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("a.js") },
        position: { line: 0, character: 24 }, // export default function greet
        context: { includeDeclaration: true },
      }),
    );
    // 导入方的 import 说明符（default 导入的本地名 greet）
    expect(refs).toContainEqual({
      file: "b.js",
      line: 0,
      character: 7,
      endLine: 0,
      endCharacter: 12,
    });
    // 导入方的调用点
    expect(refs).toContainEqual({
      file: "b.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 14,
    });
  });

  it("default 导入方一侧发起 references 也能覆盖定义文件", async () => {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("b.js") },
        position: { line: 0, character: 7 }, // import greet
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "a.js",
      line: 0,
      character: 24,
      endLine: 0,
      endCharacter: 29,
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 713 — 成员属性不触发同名导出兜底
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 713 — 成员属性不触发同名导出兜底", () => {
/**
 * Bug 713 — 成员属性（`obj.x` 的 x）F12 跳到工作区里无关文件的同名导出。
 *
 * 症状：`o.helper()` 的 helper 没有来源，却命中「同名导出兜底」跳到
 * 另一个文件里毫不相干的 `export function helper`。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const OTHER = `export function helper() {
  return 1;
}
`;
const USER = `export function go(o) {
  return o.helper();
}
`;

describe("Bug 713 — 成员属性不触发同名导出兜底", () => {
  it("成员属性 helper 的 definition 不得跳到无关文件的同名导出", async () => {
    h = await startLspWithFiles({ "other.js": OTHER, "user.js": USER });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 15 }, // o.helper 的 helper
      }),
    );
    expect(defs.filter((d) => d.file === "other.js")).toEqual([]);
  });

  it("裸标识符仍能命中同名导出兜底（兜底本身没坏）", async () => {
    const other = `export function helper() {
  return 1;
}
`;
    const user = `export function go() {
  return helper();
}
`;
    h = await startLspWithFiles({ "other.js": other, "user.js": user });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 9 }, // 裸标识符 helper
      }),
    );
    expect(defs).toContainEqual({
      file: "other.js",
      line: 0,
      character: 16,
      endLine: 0,
      endCharacter: 22,
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 714 — references 的 includeDeclaration:false 必须剔除声明位
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 714 — references 的 includeDeclaration:false 必须剔除声明位", () => {
/**
 * Bug 714 回归钉：LSP `textDocument/references` 的
 * `context.includeDeclaration: false` **仍返回声明位点**。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   references on `v`（a 内），includeDeclaration=false
 *     → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌
 *   （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组，
 *     管不到引用集合里的声明位）
 *
 * 根因：`collectBindingReferences` 无条件把绑定声明位（`binding.identifier`）
 * 收进引用集合 ⇒ `includeDeclaration` 只关掉了「另一处」的声明。
 *
 * 修法：`collectBindingReferences` 增加 `includeDeclaration` 入参（默认 true
 * —— 直接调用方的既有语义不变），由 `resolveReferences` 按
 * `context.includeDeclaration` 透传。
 */





const SHADOW_SRC = `export function a() {
  const v = 1;
  return v;
}
`;

describe("Bug 714 — references 的 includeDeclaration:false 必须剔除声明位", () => {
  it("collectBindingReferences：includeDeclaration=false 不含声明位", () => {
    const ast = parse(SHADOW_SRC);
    const withDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(withDecl.length).toBe(2);
    expect(withDecl.some((r) => r.loc.start.line === 2)).toBe(true);

    const withoutDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js", {
      includeDeclaration: false,
    });
    expect(withoutDecl.length).toBe(1);
    expect(withoutDecl[0]!.loc.start.line).toBe(3);
  });

  it("collectBindingReferences：默认仍含声明位（既有语义不变，负控制）", () => {
    const ast = parse(SHADOW_SRC);
    const refs = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(refs.some((r) => r.loc.start.line === 2)).toBe(true);
  });

  it("协议面：includeDeclaration=false 只返回用点", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const without = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: false },
      }) as any[];
      expect(Array.isArray(without)).toBe(true);
      expect(without.length).toBe(1);
      expect(without[0]!.range.start.line).toBe(2);
      expect(without[0]!.range.start.character).toBe(9);

      const with_ = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: true },
      }) as any[];
      // 负控制：includeDeclaration=true 时声明位必须在
      expect(with_.length).toBe(2);
      expect(with_.some((l) => l.range.start.line === 1)).toBe(true);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 726 — 跨文件导航必须用打开文档的 buffer
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 726 — 跨文件导航必须用打开文档的 buffer", () => {
/**
 * Bug 726 — 跨文件导航读**磁盘**文本，而不是编辑器 buffer。
 *
 * 症状：def.js 已被编辑（未保存）⇒ 磁盘上还是旧内容 ⇒ F12 / references /
 * rename 全部按磁盘坐标给位点 ⇒ 跳错行、改名改坏用户代码（两套坐标）。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function oldName(n) {
  return n + 1;
}
`;
const USE = `import { oldName } from "./def.js";

export function use() {
  return oldName(1);
}
`;
/** 未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基） */
const DEF_BUFFER = `// unsaved edit
export function oldName(n) {
  return n + 1;
}
`;

describe("Bug 726 — 跨文件导航必须用打开文档的 buffer", () => {
  it("definition 落在 buffer 坐标（磁盘坐标会跳错行）", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 0, character: 9 }, // import { oldName }
      }),
    );
    expect(defs).toContainEqual({
      file: "def.js",
      line: 1, // buffer 里的第 2 行（0 基）
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  });

  it("references 落在 buffer 坐标", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 }, // oldName(1)
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  });

  it("rename 的编辑落在 buffer 坐标", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 },
        newName: "brandNew",
      }),
    );
    expect(edits).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
      newText: "brandNew",
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 731 · 侧车补字段的插入点契约
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 731 · 侧车补字段的插入点契约", () => {
/**
 * Bug 731 —— A6「Add 'X' to <fn> contract shape」往侧车 `fn(...)` 的**顶层**
 * 插字段 ⇒ 契约被写坏。
 *
 * 根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(`
 * 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里
 * 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。
 *
 * 钉（插入点契约）：
 * 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；
 * 2. 目标形参的契约类型不是**内联** shape（共享标识符 / 标量）⇒ 不给插入点；
 * 3. 字段**已在**契约里 ⇒ 不给插入点（不写重复键）；
 * 4. LSP 面：契约已声明该字段时**不下发**「往契约 shape 补字段」的动作
 *    （落盘即写坏契约 ⇒ 多一条 `nudo:contract-param-mismatch`）。
 */







const SC_NO_NAME = `import { fn, shape, number } from "@nudojs/core";

export const greet = fn({ u: shape({ id: number() }) }, string());
`;
const SC_WITH_NAME = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;
const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;

describe("Bug 731 · 侧车补字段的插入点契约", () => {
  it("插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）", () => {
    const lines = SC_NO_NAME.split("\n");
    const pos = findFnContractInsertPos(lines, "greet", { param: "u", path: ["name"] });
    expect(pos).not.toBeNull();
    const line = lines[pos!.line]!;
    // 插入点前一个字符就是 **shape 的 `{`**（形参表的 `{` 在更左边）
    expect(line[pos!.character - 1]).toBe("{");
    expect(line.slice(0, pos!.character - 1)).toContain("shape(");
    // 落盘后：字段在 shape 里，形参表仍只有一个形参 u
    const applied = applyEdits(SC_NO_NAME, [
      { range: { start: pos!, end: pos! }, newText: " name: undefined, " },
    ]);
    expect(applied).toContain("u: shape({ name: undefined,  id: number() })");
    expect(applied).not.toContain("fn({ name:");
  });

  it("字段已在契约里 ⇒ 不给插入点（不写重复键）", () => {
    expect(
      findFnContractInsertPos(SC_WITH_NAME.split("\n"), "greet", {
        param: "u",
        path: ["name"],
      }),
    ).toBeNull();
  });

  it("目标形参的契约类型不是内联 shape ⇒ 不给插入点", () => {
    const shared = `export const a = fn(sharedShape, number());\nexport const b = fn({ y: number() }, number());\n`;
    // 共享 shape 标识符
    expect(
      findFnContractInsertPos(shared.split("\n"), "a", { param: "u", path: ["name"] }),
    ).toBeNull();
    // 标量形参
    expect(
      findFnContractInsertPos(shared.split("\n"), "b", { param: "y", path: ["name"] }),
    ).toBeNull();
    // 形参不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "greet", {
        param: "nope",
        path: ["name"],
      }),
    ).toBeNull();
    // 目标 fn 不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "other", { param: "u", path: ["name"] }),
    ).toBeNull();
  });

  it("LSP 面：契约缺字段时，补字段动作落在 shape 内部", () => {
    withTempDir("nudo-lsp-731-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_NO_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = sidecarEdits(actions, uri);
      expect(edits.length).toBe(1);
      const landed = applyEdits(SC_NO_NAME, edits);
      expect(landed).toContain("u: shape({ name: undefined,  id: number() })");
      // 形参表没被动过（不多出形参）
      expect(landed).not.toContain("fn({ name:");
    });
  });

  it("LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作", () => {
    withTempDir("nudo-lsp-731b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_WITH_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      expect(sidecarEdits(actions, uri)).toHaveLength(0);
      expect(actions.map((a) => a.title)).not.toContain(
        "Add 'name' to greet contract shape",
      );
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 737 · 调用点插入点必须是对象字面量实参（不是字符串里的 `{`）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 737 · 调用点插入点必须是对象字面量实参（不是字符串里的 `{`）", () => {
/**
 * Bug 737 —— A6「Add missing field 'X' to call」的插入点用**行内文本启发式**
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

describe("Bug 737 · 调用点插入点必须是对象字面量实参（不是字符串里的 `{`）", () => {
  it("插入点落进对象字面量，字符串字面量原样保留", () => {
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
  });

  it("同一行既有字符串 `{` 又有对象字面量时也落进对象字面量", () => {
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
  });
});
});

// ---------------------------------------------------------------------------
// Bug 752 — agent nudo/check 并入 mock 装载失败通道
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 752 — agent nudo/check 并入 mock 装载失败通道", () => {
/**
 * Bug 752 — LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。
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

describe("Bug 752 — agent nudo/check 并入 mock 装载失败通道", () => {
  it("slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）", async () => {
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
  });

  it("dot 形式：同一条通道同样可见（协议别名不降级）", async () => {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/mockonly.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:module-missing");
    });
  });

  it("文本面：error 级通道上屏（不再是「0 error」判绿）", async () => {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/mockonly.js` });
      const text = r.content[0].text;
      expect(text).toContain("nudo:module-missing");
      expect(text).toContain("FAILED");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 762：contract.emit 走 root 驱动下行推导
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 762：contract.emit 走 root 驱动下行推导", () => {
/**
 * Bug 762 —— `nudo.contract.emit` 必须走 **root 驱动下行推导**
 * （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。
 *
 * 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒
 * - CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面**永远不产生**；
 * - 结果文本只报「no contract changes / skipped add4 (name-clash)」，
 *   把「引擎没做的那一步」说成「本地侧车被手写占用」——误导性诊断。
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

describe("Bug 762：contract.emit 走 root 驱动下行推导", () => {
  it("工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from", async () => {
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
  });

  it("工具面：dry-run 只预览、不写下游侧车", async () => {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const libJs = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file: libJs, functionName: "add4", mode: "update", dryRun: true },
        { workspaceRoots: [dir] },
      );
      expect(r.content[0].text).toContain("dry-run");
      expect(existsSync(join(dir, "add.nudo.js"))).toBe(false);
    });
  });

  it("协议面：nudo.contract.emit 同样产出下游侧车", async () => {
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
  });
});
});

// ---------------------------------------------------------------------------
// Bug 766：emit 写盘边界按路径分量判定
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 766：emit 写盘边界按路径分量判定", () => {
/**
 * Bug 766 —— emit 写盘边界按**路径分量**判定，不按字符串前缀。
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

describe("Bug 766：emit 写盘边界按路径分量判定", () => {
  it("root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车", async () => {
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
  });

  it("root 外的文件 ⇒ 仍然拒绝", async () => {
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
  });

  it("指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）", async () => {
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
  });
});
});

// ---------------------------------------------------------------------------
// Bug 770 — agent nudo/check + nudo/test 的分析目标闸门
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 770 — agent nudo/check + nudo/test 的分析目标闸门", () => {
/**
 * Bug 770 — LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」
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

describe("Bug 770 — agent nudo/check + nudo/test 的分析目标闸门", () => {
  it("nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）", async () => {
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
  });

  it("nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case", async () => {
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
  });

  it("普通 .js 目标不受闸门影响（仍能分析）", async () => {
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
  });

  it("dot 形式同样过闸门", async () => {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo.check")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 773 —— 早退守卫的 else 分支不得被当成「其后非空」
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 773 —— 早退守卫的 else 分支不得被当成「其后非空」", () => {
/**
 * Bug 773 —— hover 的「早退守卫去 nullish」**忽略 `else` 分支**
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

describe("Bug 773 —— 早退守卫的 else 分支不得被当成「其后非空」", () => {
  it("带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）", async () => {
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
  });

  it("对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）", async () => {
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
  });
});
});

// ---------------------------------------------------------------------------
// Bug 775 —— 契约形参的 hover 文本与 `nudo check` 同口径
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 775 —— 契约形参的 hover 文本与 `nudo check` 同口径", () => {
/**
 * Bug 775 —— hover 的侧车契约面用**声明形态**、`nudo check` 用**推断形态**
 * ⇒ 同一函数两套参数类型文本（IDE 说的是侧车 DSL 原文，CLI 说的是类型）。
 *
 * 改前（协议面 hover 签名块）：
 *   `addc(x: number().gt(0), y: number().gt(0)) => number`
 * 而 `nudo check` 的签名行是：
 *   `addc(x: number, y: number) => number`
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

describe("Bug 775 —— 契约形参的 hover 文本与 `nudo check` 同口径", () => {
  it("签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）", async () => {
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
  });

  it("形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）", async () => {
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
  });

  it("union 契约参数保留声明形态（判别联合折叠不回归）", async () => {
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
  });
});
});

// ---------------------------------------------------------------------------
// Bug 779 — check 通道的 info 级诊断在 verbose 档必须上屏
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 779 — check 通道的 info 级诊断在 verbose 档必须上屏", () => {
/**
 * Bug 779 —— check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。
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

describe("Bug 779 — check 通道的 info 级诊断在 verbose 档必须上屏", () => {
  it("push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）", async () => {
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
  }, 30_000);

  it("pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）", async () => {
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
  }, 30_000);

  it("默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）", async () => {
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
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// Bug 991 — agent nudo/check 接上补充诊断通道
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 991 — agent nudo/check 接上补充诊断通道", () => {
/**
 * Bug 991 — agent 工具 `nudo/check` 只跑裸 `checkSource` ⇒ CLI / LSP 并入
 * check 报告的**补充诊断通道**一条都没接 ⇒ 同一文件三个面三份 issue 集。
 *
 * 本钉覆盖两条旁路通道：
 * 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与
 *    service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组，
 *    不会流进 `checkSource` 的返回值；
 * 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态
 *    （`getPathEnvLoadErrors`），既不是 `checkSource` 的入参也不是返回值。
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

describe("Bug 991 — agent nudo/check 接上补充诊断通道", () => {
  it("指令文法诊断（nudo:directive-syntax）并入 issues + summary", async () => {
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
  });

  it("path env 未解析（nudo:env-unresolved）并入 issues + summary", async () => {
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
  });

  it("dot 形式同样接上（协议别名不降级）", async () => {
    await withLspServer({ "d1_syntax.js": D1_SYNTAX }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/d1_syntax.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:directive-syntax");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 994：三个 contract 工具的 --from 等价通道
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 994：三个 contract 工具的 --from 等价通道", () => {
/**
 * Bug 994 —— agent 的三个 contract 工具要有 `--from`（使用点记录）等价通道。
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

describe("Bug 994：三个 contract 工具的 --from 等价通道", () => {
  it("协议面 nudo/contract：带 from ⇒ 使用点证据参与求解", async () => {
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
  });

  it("协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）", async () => {
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
  });

  it("工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）", async () => {
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
  });

  it("from 指向不存在的路径 ⇒ 显式报错（不静默给假面）", async () => {
    await withLspServer({ "lib.js": LIB }, async ({ req, uri, dir }) => {
      const r = await req("nudo/contract")({
        file: uri("lib.js"),
        from: [join(dir, "nope.js")],
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("no call-site records collected");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 998 — CJS 成员导出的符号 / 观察面
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 998 — CJS 成员导出的符号 / 观察面", () => {
/**
 * Bug 998：CJS 成员导出（`exports.f = fn` / `module.exports.f = fn`）在 LSP 的
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

describe("Bug 998 — CJS 成员导出的符号 / 观察面", () => {
  it("documentSymbol 出 CJS 成员导出（函数档，detail 带 export）", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string; detail?: string; kind: number }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
      expect(syms[0]!.detail).toBe("(x) export");
      expect(syms[0]!.kind).toBe(12); // SymbolKind.Function
    });
  });

  it("workspace/symbol 查得到 CJS 成员导出", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      void uri;
      const syms = req("workspace/symbol")({ query: "alpha" }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toContain("alpha");
    });
  });

  it("semanticTokens 给 CJS 导出键 function 档 + contract 档 modifier", async () => {
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
  });

  it("inlayHint 出 CJS 导出的返回 inlay + contract 档投影", async () => {
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
  });

  it("codeLens 出 CJS 导出的 contract 档（契约身份 = 导出名）", async () => {
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
  });

  it("hover 面解析出 CJS 导出名（族 25 收口接线：position.ts 补 MemberExpression property 分支）", async () => {
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
  });

  it("回归护栏：ESM 具名导出的符号面不受影响", async () => {
    await withLspServer({ "a.js": ESM_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
    });
  });
});
});
