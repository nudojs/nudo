/**
 * 模块套件：LSP hover 面（签名/throws/注入/层级/axiom/writeback）。
 *
 * 各来源的 hover 断言与 fixture 逐字保留；hover-intension.test.ts 保留为
 * 深度意图推导套件。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition } from "../lsp-surface.ts";
import { collectAbsInlays } from "@nudojs/core/internal";
import { formatContractTierLine, CONTRACT_SOURCE_ABBR } from "@nudojs/core";
import { computeContractLenses, hoverTool, type ContractLens, buildLspInjection } from "../agent-tools.ts";
import { withTempDir, withLspServer, createMockConnection } from "./helpers.ts";
import { defaultLoadModule } from "@nudojs/service";
import { createNudoServer } from "../server.ts";

// ---------------------------------------------------------------------------
// A7 CodeLens ↔ hover 同源
// ---------------------------------------------------------------------------
describe("A7 CodeLens ↔ hover 同源", () => {
/**
 * A7：CodeLens `● contract` 与 hover / inlay 同源
 * （design-refine-derivation §8）
 */









const HANDWRITTEN = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;

const loader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

const ADD_SRC = `export function add(x) {\n  return x + 2;\n}\n`;

describe("A7 CodeLens ↔ hover 同源", () => {
  it("hover.contractSource equals CodeLens contract lens source", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const lens = lenses.find(
      (l): l is Extract<ContractLens, { kind: "contract" }> =>
        l.kind === "contract",
    );
    expect(lens).toBeDefined();
    const src = lens!.source;

    // hover 在函数名 `add`（L1 C16 起）
    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
    });
    expect(hover?.contractSource).toBe(src);
    expect(hover?.contractDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(formatContractTierLine(hover!.contractSource!)).toBe(
      `● contract / ${CONTRACT_SOURCE_ABBR[src]}`,
    );
  });

  it("implicit export: lens and hover both say implicit; display omitted", () => {
    const src = `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`;
    const lenses = computeContractLenses(src, "/t/calls.js");
    const lens = lenses.find((l) => l.kind === "contract");
    expect(lens!.kind === "contract" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/calls.js", src, 1, 16, undefined, {});
    expect(hover?.contractSource).toBe("implicit");
    expect(hover?.contractDisplay).toBeUndefined();
  });

  it("inlay.contractSource equals lens source", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const iface = lenses.find((l) => l.kind === "contract");
    expect(iface?.kind).toBe("contract");
    const lensSrc = iface!.kind === "contract" ? iface!.source : "";
    const inlays = collectAbsInlays(ADD_SRC, {
      fromFile: "/t/lib.js",
      loadModule: loader(HANDWRITTEN),
    });
    for (const i of inlays) {
      expect(i.contractSource).toBe(lensSrc);
    }
  });

  it("autoBind:false collapses lens + hover to implicit together", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    const lens = lenses.find((l) => l.kind === "contract");
    expect(lens!.kind === "contract" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    expect(hover?.contractSource).toBe("implicit");
  });
});

describe("A7 agent hoverTool payload 同源", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-a7-hover-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns contractSource + contractLine matching CodeLens title", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, ADD_SRC);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);

    const r = hoverTool({ file, line: 1, column: 16, includeInlays: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.contractSource).toBe("handwritten");
    expect(payload.contractLine).toBe("● contract / hw");
    expect(payload.contractDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(Array.isArray(payload.inlays)).toBe(true);
    const ret = payload.inlays.find((i: { kind: string }) => i.kind === "type");
    expect(ret.contractSource).toBe("handwritten");
  });

  it("implicit call-site file: contractSource=implicit, contractLine matches", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(
      file,
      `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`,
    );
    const r = hoverTool({ file, line: 1, column: 16 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.contractSource).toBe("implicit");
    expect(payload.contractLine).toBe("● contract / imp");
    expect(payload.contractDisplay).toBeNull();
  });
});
});

// ---------------------------------------------------------------------------
// nudo.hover agent tool
// ---------------------------------------------------------------------------
describe("nudo.hover agent tool", () => {
describe("nudo.hover agent tool", () => {
  it("hover on identifier resolves via binding table (node table removed)", () => {
    const src = `const x = 1 + 2;\n`;
    // fail-closed：节点级 Abs 表已删——标识符 x（col 6）经绑定表
    const r = hoverTool(
      { file: "/t/h.js", line: 1, column: 6, source: src },
      { readFile: () => src },
    );
    const payload = JSON.parse(r.content[0].text);
    expect(payload.abs).toBeDefined();
    expect(payload.abs).toContain("3");
    expect(payload).toHaveProperty("ext");
  });

  it("can include inlays", () => {
    const src = `function needsPositive(x) {\n  if (x > 0) return x;\n  return 0;\n}\n`;
    const r = hoverTool(
      { file: "/t/i.js", line: 1, column: 9, source: src, includeInlays: true },
      { readFile: () => src },
    );
    const payload = JSON.parse(r.content[0].text);
    expect(Array.isArray(payload.inlays)).toBe(true);
    expect(payload.inlays.length).toBeGreaterThan(0);
  });
});
});

// ---------------------------------------------------------------------------
// LSP hover 重放：成员写回后仍拿到求值态
// ---------------------------------------------------------------------------
describe("LSP hover 重放：成员写回后仍拿到求值态", () => {
/**
 * LSP hover 重放面：成员写回的**赋值目标**必须是可赋值绑定回归。
 *
 * 根因：core 的 memberPathOf 在 recordPositions 打开时把路径根包成
 * `$nodoPos(name, l, c)`（位置插桩**读**），写回点却把同一个 rootSrc 当
 * **赋值目标**用 ⇒ 产物 `$nodoPos(o, 2, 24) = …` 是非法 JS ⇒ 整模块
 * new Function 抛 SyntaxError ⇒ fail-closed ⇒ hover 重放拿不到求值态
 * （回落声明形态面）。
 *
 * LSP 重放面（lsp-surface/replay.ts）常开 recordPositions ⇒ 该面整体失效。
 * 修法：MemberPath 拆出 rootTarget（裸绑定名），写回一律用它。
 */






function hoverAbs(src: string, file: string, line: number, column: number): unknown {
  const r = hoverTool({ file, line, column, source: src }, { readFile: () => src });
  const payload = JSON.parse(r.content[0]!.text) as { abs?: unknown };
  return payload.abs;
}

describe("LSP hover 重放：成员写回后仍拿到求值态", () => {
  it("成员赋值后的成员读 → 求值态（修前回落声明形态面）", () => {
    withTempDir("nudo-lsp-wb-", (dir) => {
      const file = join(dir, "lib.js");
      const src = [
        "export function f(o) {",
        "  o.a = 2;",
        "  return o.a;",
        "}",
        "",
      ].join("\n");
      writeFileSync(file, src);
      writeFileSync(
        join(dir, "lib.nudo.js"),
        [
          'import { shape, number } from "@nudojs/core";',
          "export const f = fn({ o: shape({ a: number() }) }, number());",
          "",
        ].join("\n"),
      );
      // 第 3 行 ` return o.a;`——列 10 = `o.a` 的 o
      const abs = hoverAbs(src, file, 3, 10) as string | null;
      expect(abs).not.toBeNull();
      // 求值态：写回后的 o（a: 2）；修前是声明形态（a: number）
      expect(abs).toContain("a: 2");
      expect(abs).not.toContain("a: number");
    });
  });
});
});

// ---------------------------------------------------------------------------
// [merged] hover-axiom
// ---------------------------------------------------------------------------
describe("hover-axiom", () => {
// MERGED (topic-related bug pins): hover-axiom + inlay-hover-parity
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>







describe("hover-axiom", () => {
/**
 * LSP hover **不消费用户公理**（`@nudo:invariant`）⇒ IDE 印出
 * 「没有那条公理的程序」的类型。
 *
 * 夹具（`tmp/repro//inv/m1.js`）：函数体靠 `@nudo:invariant dp[*] >= 0`
 * 的循环界把返回位证成 `0 | number`；去掉公理那一行（对照组 `ctrl/m1.js`）
 * 同一函数体只能给 `number`。
 *
 * 改前：两版文件的 hover 返回位**逐字相同**（都是 `number`）——hover 自算
 * `generalizeFromAst`，而公理只在 `checkSource` 的动态域里播种；CLI
 * `nudo check` 却随公理那一行变化（`0 | number` ↔ `number`）⇒ 跨面矛盾。
 *
 * 修法：hover 的返回位 + `throws` 尾缀改取 `checkSource` 签名（check-identical），
 * 参数渲染仍由 hover 自己负责。
 *
 * 钉：同一函数体只差那一行公理 ⇒ hover 签名行返回位必须随之变化
 * （有公理 ⇒ `0 | number`；无公理 ⇒ `number`）。
 */






/** 有公理：`tmp/repro//inv/m1.js` 逐字内容 */
const INV_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 对照组：同一函数体，只删掉 `@nudo:invariant` 那一行 */
const CTRL_SRC = `export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/**
 * 函数**声明名**位置（`export function f` 里的 `f`）。
 *
 * `getHoverAtPosition` 的 `line` 是 **1-based**（= LSP line + 1），`column`
 * 是 **0-based**。注释块（公理行）使两版文件的行号不同 ⇒ 必须动态定位。
 */
function declNamePos(source: string): { line: number; column: number } {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("export function "));
  if (idx < 0) throw new Error("fixture has no `export function` declaration");
  const column = lines[idx]!.indexOf("f", "export function ".length);
  if (column < 0) throw new Error("fixture declaration has no name");
  return { line: idx + 1, column };
}

function signatureOf(dir: string, name: string, source: string): string {
  const file = join(dir, name);
  writeFileSync(file, source, "utf-8");
  const pos = declNamePos(source);
  const info = getHoverAtPosition(file, source, pos.line, pos.column);
  expect(info, `hover 无结果：${name}`).not.toBeNull();
  const sig = info!.signature;
  expect(sig, `hover 未给 check 同口径签名（BUG-247 的承载位）：${name}`).toBeDefined();
  return sig!;
}

describe("hover 返回位必须消费 @nudo:invariant（check-identical）", () => {
  it("有公理 ⇒ hover 返回位 `0 | number`；无公理 ⇒ `number`；两者不同", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug247-"));
    try {
      const invSig = signatureOf(dir, "inv.js", INV_SRC);
      const ctrlSig = signatureOf(dir, "ctrl.js", CTRL_SRC);

      // 改前：hover 自算 generalize ⇒ 两版都是 `f(n: any) => number`
      expect(invSig).toContain("=> 0 | number");
      expect(ctrlSig).not.toContain("0 | number");
      expect(ctrlSig).toContain("=> number");
      // 差异**精确地由公理那一行引起**（不是面固有精度差）
      expect(invSig).not.toBe(ctrlSig);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("公理不影响参数渲染：两版形参仍同形（hover 自己的参数面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug247-param-"));
    try {
      const invSig = signatureOf(dir, "inv.js", INV_SRC);
      const ctrlSig = signatureOf(dir, "ctrl.js", CTRL_SRC);
      const paramsOf = (sig: string): string => sig.slice(sig.indexOf("("), sig.indexOf("=>"));
      expect(paramsOf(invSig)).toBe(paramsOf(ctrlSig));
      expect(paramsOf(invSig)).toBe("(n: any) ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

describe("inlay-hover-parity", () => {
/**
 * （协议面）—— 同一 IDE 会话里 **hover 签名面** 与 **inlayHint 返回面**
 * 必须对同一份源码给出**同一份类型**。
 *
 * 夹具（`tmp/repro//`）：同一函数体，只差 `@nudo:invariant dp[*] >= 0`
 * 那一行。该公理只由 check 的动态域播种（`check.ts` 的 `withAssumePremises` /
 * `withInvariantSpecs`）⇒ 自算 generalize 的 IDE 面会印「没有那条公理的程序」
 * 的类型 ⇒ 同一会话内诊断面（承认公理）与 hover 面（无视公理）互斥。
 *
 * 改前实测（正文）：
 *
 * | 面 | 有公理 | 无公理 |
 * |---|---|---|
 * | CLI `nudo check` | `0 \| number` | `number` |
 * | LSP hover | `number` | `number` ← 逐字相同 |
 * | LSP inlayHint | `: number` | `: number` ← 逐字相同 |
 *
 * 修复后钉（**两个面一起**）：
 * 1. hover 签名返回位与 inlay 返回角标**逐字相同**（同一份 Abs 的两个渲染面）；
 * 2. 两者都随公理那一行变化（`0 | number` ↔ `number`）；
 * 3. 角标里不得出现引擎内部计数器 id（`inv#N` / `len#N`）。
 */



/** 有公理：`tmp/repro//inv/m1.js` 逐字内容 */
const INV_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 对照组：同一函数体，只删掉 `@nudo:invariant` 那一行 */
const CTRL_SRC = `export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

type Position = { line: number; character: number };
type Hint = { position: Position; label: string };
type HoverLike = { contents?: { value?: string } | string } | null;

/**
 * 函数**声明名**位置（`export function f` 里的 `f`）。
 * LSP `Position` 是 0 基；注释块（公理行）使两版文件行号不同 ⇒ 必须动态定位。
 */
function declNamePos(source: string): Position {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("export function "));
  if (idx < 0) throw new Error("fixture has no `export function` declaration");
  const character = lines[idx]!.indexOf("f", "export function ".length);
  if (character < 0) throw new Error("fixture declaration has no name");
  return { line: idx, character };
}

/** hover 签名行里的返回位（`=> <ret>`，去掉 ` throws …` 尾缀） */
function hoverReturnOf(hover: HoverLike): string {
  const text =
    typeof hover?.contents === "string"
      ? hover.contents
      : (hover?.contents?.value ?? "");
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /=>/.test(l) && !l.startsWith("`"));
  expect(line, `hover 里没有签名字段：${text}`).toBeDefined();
  return line!
    .slice(line!.indexOf("=>") + 2)
    .replace(/\s+throws\s+.*$/, "")
    .trim();
}

/** inlayHint 的返回角标文本（`: <ret> · derived` → `<ret>`） */
function inlayReturnOf(hints: Hint[]): string {
  const ret = hints.filter((h) => h.label.startsWith(": "));
  expect(ret, `inlayHint 里没有返回角标：${JSON.stringify(hints)}`).toHaveLength(1);
  return ret[0]!.label
    .replace(/^:\s*/, "")
    .replace(/\s*·\s*derived\s*$/, "")
    .trim();
}

describe("hover 面 ≡ inlayHint 面（同一份精确类型）", () => {
  it("两面对同一份源码给出同一份返回类型，且随公理变化", async () => {
    await withLspServer(
      { "inv.js": INV_SRC, "ctrl.js": CTRL_SRC },
      async (ctx) => {
        const faceOf = (name: string, src: string): { hover: string; inlay: string } => {
          const uri = ctx.uri(name);
          const pos = declNamePos(src);
          const hover = ctx.req("textDocument/hover")({
            textDocument: { uri },
            position: pos,
          }) as HoverLike;
          const hints = (ctx.req("textDocument/inlayHint")({
            textDocument: { uri },
          }) ?? []) as Hint[];
          return { hover: hoverReturnOf(hover), inlay: inlayReturnOf(hints) };
        };

        const inv = faceOf("inv.js", INV_SRC);
        const ctrl = faceOf("ctrl.js", CTRL_SRC);

        // 1. 逐字同源：hover 签名返回位 == inlay 返回角标
        expect(inv.hover).toBe(inv.inlay);
        expect(ctrl.hover).toBe(ctrl.inlay);

        // 2. 精确面：有公理 ⇒ `0 | number`；无公理 ⇒ `number`
        expect(inv.hover).toBe("0 | number");
        expect(ctrl.hover).toBe("number");
        // 差异**精确地由公理那一行引起**（不是面固有精度差）
        expect(inv.inlay).not.toBe(ctrl.inlay);

        // 3. 内部计数器 id 不上屏
        expect(inv.inlay).not.toMatch(/[a-z]+#\d+/);
        expect(ctrl.inlay).not.toMatch(/[a-z]+#\d+/);
      },
      "nudo-bug247-lsp-",
    );
  }, 30_000);
});
});
});

// ---------------------------------------------------------------------------
// 侧车契约收窄形参时 hover 不得多报 throws（check-identical）
// ---------------------------------------------------------------------------
describe("侧车契约收窄形参时 hover 不得多报 throws（check-identical）", () => {
/**
 * LSP hover 的 `throws` 尾缀**不是 check-identical**：侧车契约
 * 收窄形参时 hover 多报 `throws TypeError`（`nudo check` 判绿）。
 *
 * 根因：形参 / 返回取**契约种子化**的 generalize 结果，throws 却取 service
 * 的**无约束入口域**见证（形参一律 `any` ⇒ `any` 上的 ToNumber 强转 ⇒
 * `TypeError`）—— 两套参数域混用。修复：返回位 + throws 尾缀统一读
 * `checkSource` 的签名（契约域 may-throw 为空 ⇒ 无 throws 尾缀）。
 *
 * 夹具与 `tmp/repro//` 同文：`up.js` + 手写侧车 `up.nudo.js`
 * （`s: string()`）。真实 server 走真实 `didOpen` + 真实 `textDocument/hover`。
 */








const JS_SRC = ["export function up(s) {", "  return s.toUpperCase();", "}", ""].join("\n");

const SIDECAR_SRC = [
  'import { fn, string } from "@nudojs/env";',
  "export const up = fn({ s: string() });",
  "",
].join("\n");

/** `nudo check` 的签名行：契约域 ⇒ `s: string` 不可能触发强转 ⇒ 不抛 */
const CHECK_SIG = "up(s: string) => string";

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("侧车契约收窄形参时 hover 不得多报 throws（check-identical）", () => {
  it("真实 server：hover 签名行 = check 契约域签名（无 throws）", async () => {
    await withLspServer(
      { "up.js": JS_SRC, "up.nudo.js": SIDECAR_SRC },
      async ({ req, uri }) => {
        const res = req("textDocument/hover")({
          textDocument: { uri: uri("up.js") },
          position: { line: 0, character: 16 }, // `export function up` 的 up
        }) as Hover;
        const value = res?.contents.value ?? "";
        const sig = nudoSigLine(value);
        expect(sig).toBe(CHECK_SIG);
        // 契约域里 `s.toUpperCase()` 无强转 ⇒ 不得出现 throws 尾缀
        expect(sig).not.toContain("throws");
        expect(value).not.toContain("throws");
      },
    );
  });

  it("纯装配面：hover 签名行同样不含 throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug071-"));
    try {
      const jsFile = join(dir, "up.js");
      writeFileSync(jsFile, JS_SRC, "utf-8");
      writeFileSync(join(dir, "up.nudo.js"), SIDECAR_SRC, "utf-8");
      // line 是 **1-based**（= LSP position.line + 1）；column 0-based = 16
      // 侧车契约靠 `loadModule` 装载（协议面由 server 传 `activeLoadModule`，
      // 缺省回落 service 的 `defaultLoadModule` 读盘）——纯面显式给同一读盘装载器
      const hover = getHoverAtPosition(jsFile, JS_SRC, 1, 16, undefined, {
        loadModule: defaultLoadModule,
      });
      expect(hover?.signature).toBe(CHECK_SIG);
      expect(hover?.signature ?? "").not.toContain("throws");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// [merged] hover-inject
// ---------------------------------------------------------------------------
describe("hover-inject", () => {
// MERGED (topic-related bug pins): hover-inject + inject-handoff
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>







describe("hover-inject", () => {
/**
 * （hover 半）—— hover 的签名面**从不传 `inject`**
 * ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示
 * `number`/`string` ⇒ 跨产品面自相矛盾，且违反 lsp.md 明写的
 * “check-identical signature” 承诺。
 *
 * 修法（片 C：`hover.ts` 单一 owner）：`HoverContractOpts` 增 `inject`
 * 字段并透传给 hover.ts 的 **3 处** `generalizeFromAst`（函数名面 /
 * 形参面 / 无 ident 位的重放面）。装配器在片 F 的
 * `agent-tools.ts#buildLspInjection`（与 CLI 的 `buildCheckInjection`
 * 同口径）——**core 零新增导出**。
 *
 * 本钉只覆盖 hover 的事实面（`getHoverAtPosition` 的 opts 通道）；
 * 协议面（`textDocument/hover`）的 inject 装配在 server 侧装配器接线
 * 处（`server-ide.ts`，非本片独占文件）。
 */







/** `@nudo:replace` ⇒ `raw` 是 number ⇒ `raw.toFixed(2)` 返回 string */
const SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesRaw() {
  return raw.toFixed(2);
}
`;

function fixture(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug786-hover-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug786-hover", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "usesraw.js");
  writeFileSync(file, SRC, "utf-8");
  return { dir, file };
}

describe("（hover 半）—— hover 的签名面必须接收 inject 通道", () => {
  it("注入生效：hover 签名给出推断类型（改前塌缩成 unknown）", () => {
    const { dir, file } = fixture();
    try {
      const inject = buildLspInjection(file, SRC);
      // `usesRaw` 声明名（第 8 行，列 16）
      const hover = getHoverAtPosition(file, SRC, 8, 16, undefined, { inject });
      const sig = hover?.signature ?? "";
      expect(sig).toContain("string");
      expect(sig).not.toContain("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未注入（对照）：推导链塌缩成 unknown ⇒ inject 通道确实是分水岭", () => {
    const { dir, file } = fixture();
    try {
      const hover = getHoverAtPosition(file, SRC, 8, 16);
      const sig = hover?.signature ?? "";
      expect(sig).toContain("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

describe("inject-handoff", () => {
/**
 * LSP 签名面（hover / inlayHint）**从不传 `inject`**
 * ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示
 * `number` ⇒ 跨产品面自相矛盾，且违反 lsp.md 的 “check-identical signature”
 * 承诺。
 *
 * 根因：`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局四类注入走
 * core 的 **`inject` 通道**（`RunTranspiledOptions`）；CLI 侧由
 * `buildCheckInjection` 构造并显式传入，**LSP 侧的 hover / inlay 两条
 * `generalizeFromAst` 调用都不传** ⇒ 覆盖表缺席 ⇒ 推导链塌缩 unknown。
 *
 * 修法（片 F / 片 C 协作）：
 * - 片 F：`packages/core/src/algebra/inlay.ts` 的 `CollectAbsInlaysOpts`
 * 加 `inject` 字段并透传给 `generalizeFromAst`（**只改内部函数体**，
 * 零新增 core 导出）；`packages/lsp/src/agent-tools.ts` 新增注入装配器
 * `buildLspInjection` 并在 agent hover 工具面装配 inject；
 * - 片 C（`hover.ts` 单一 owner）：`HoverContractOpts` 加 `inject` 字段，
 * 传进 hover.ts 的 **3 处** `generalizeFromAst`。
 *
 * 钉（本片能改的一侧）：
 * - 注入装配器 `buildLspInjection` 的产物形状（协议面）；
 * - agent hover 工具的 inlay 载荷：注入生效 ⇒ `: string`（未注入 ⇒ `: unknown`）。
 */






/** `@nudo:replace` ⇒ `raw` 是 number ⇒ `raw.toFixed(2)` 返回 string */
const REPL_SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesRaw() {
  return raw.toFixed(2);
}
`;

/** `@nudo:as` ⇒ `raw` 覆盖成 number */
const AS_SRC = `// @nudo:as number()
const raw = "abc";

export function usesRaw() {
  return raw.toFixed(2);
}
`;

/** `@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名 */
const MOCK_SRC = `/**
 * @nudo:mock dep = (x) => x * 2
 */
export function usesDep(v) {
  return dep(v);
}
`;

function fixture(src: string, name: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug786-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `bug786-${name}`, private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src, "utf-8");
  return { dir, file };
}

describe("注入装配器 + inject 传递协议", () => {
  it("buildLspInjection 采集 @nudo:replace 的覆盖表（replacements + targets）", () => {
    const { dir, file } = fixture(REPL_SRC, "repl");
    try {
      const inject = buildLspInjection(file, REPL_SRC);
      expect(Object.keys(inject).length, "注入包为空 ⇒ 行内指令缺席").toBeGreaterThan(0);
      expect(inject.replacementTargets?.length ?? 0).toBeGreaterThan(0);
      expect(Object.keys(inject.replacements ?? {}).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildLspInjection 采集 @nudo:as 的覆盖表（asOverrides + asOverrideTargets）", () => {
    const { dir, file } = fixture(AS_SRC, "as");
    try {
      const inject = buildLspInjection(file, AS_SRC);
      expect(inject.asOverrideTargets?.length ?? 0).toBeGreaterThan(0);
      expect(Object.keys(inject.asOverrides ?? {}).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildLspInjection 采集 @nudo:mock 的覆盖表（mocks）", () => {
    const { dir, file } = fixture(MOCK_SRC, "mock");
    try {
      const inject = buildLspInjection(file, MOCK_SRC);
      expect(Object.keys(inject.mocks ?? {}).length, "@nudo:mock 未进注入包").toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("agent hover 工具的 inlay 载荷：注入生效 ⇒ `: string`（未注入 ⇒ `: unknown`）", () => {
    const { dir, file } = fixture(REPL_SRC, "repl");
    try {
      const res = hoverTool({
        file,
        line: 8,
        column: 2,
        includeInlays: true,
      });
      const payload = JSON.parse(res.content[0]!.text) as {
        inlays?: Array<{ label: string }>;
      };
      const labels = (payload.inlays ?? []).map((i) => i.label);
      expect(labels.length, "无 inlay 载荷").toBeGreaterThan(0);
      expect(
        labels.some((l) => l.includes(": string")),
        `inlay 仍是 unknown：${JSON.stringify(labels)}`,
      ).toBe(true);
      expect(
        labels.some((l) => l.includes(": unknown")),
        `inlay 仍塌缩成 unknown：${JSON.stringify(labels)}`,
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});
});

// ---------------------------------------------------------------------------
// nudo/hover 位置入参校验 + column 键恒在
// ---------------------------------------------------------------------------
describe("nudo/hover 位置入参校验 + column 键恒在", () => {
/**
 * `nudo/hover` 的位置入参**零校验**：
 *
 * 1. `line` 传字符串（`"2"`）等非法值时，工具**原样回显**并把分析字段全落
 * `null` —— 调用方分不清「此处没有 hover」与「我传的参数类型不对」。
 * ⇒ 非法位置参数 ⇒ 工具错误（`isError: true`）。
 * 2. `column` 缺省时载荷里**没有** `column` 键 —— 与文档承诺的
 * `{ file, line, column, … }` 形状不符。
 * ⇒ `column` 缺省 0（键恒在）；给了但不是 0-based 整数 ⇒ 工具错误。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */



const SRC = ["export function inner() {", "  const v = 7;", "  return v;", "}", ""].join("\n");

describe("nudo/hover 位置入参校验 + column 键恒在", () => {
  it("非法 line / column ⇒ 工具错误；缺省 column ⇒ 载荷带 column 键", async () => {
    await withLspServer({ "a4-768.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-768.js");

      // ① 非法 line（字符串）⇒ 失败，不再原样回显
      const badLine = await req("nudo/hover")({ file, line: "2", column: 2 });
      expect(badLine.isError).toBe(true);
      expect(badLine.content[0].text).toContain("line must be a 1-based integer");

      // ② line 缺失 ⇒ 失败
      const noLine = await req("nudo/hover")({ file });
      expect(noLine.isError).toBe(true);

      // ③ 非法 column（负数）⇒ 失败
      const badColumn = await req("nudo/hover")({ file, line: 2, column: -1 });
      expect(badColumn.isError).toBe(true);
      expect(badColumn.content[0].text).toContain("column must be a 0-based integer");

      // ④ column 缺省 ⇒ 成功面，载荷的 column 键恒在（缺省 0）
      const noColumn = await req("nudo/hover")({ file, line: 2 });
      expect(noColumn.isError).toBeFalsy();
      const payload = JSON.parse(noColumn.content[0].text);
      expect(Object.keys(payload)).toContain("column");
      expect(payload.column).toBe(0);
      expect(payload.line).toBe(2);
    });
  });
});
});

// ---------------------------------------------------------------------------
// hover 签名块：返回类型与 check 同预算（不按 maxDepth 4 截断）
// ---------------------------------------------------------------------------
describe("hover 签名块：返回类型与 check 同预算（不按 maxDepth 4 截断）", () => {
/**
 * LSP hover 的**函数签名块**把返回类型按 `maxDepth: 4` 截断。
 *
 * 改前：同一份源码、同一函数、同一次分析下，`nudo check` 签名行 /
 * 同文档的 inlayHint / `nudo.hover` 载荷给出**三个互不相同的类型**，
 * 并直接违反 `api/lsp.md` 明写的「check-identical signature」承诺。
 *
 * 原生 oracle：hover 签名块的返回类型与 `nudo check` 的签名行**逐字相同**
 * （共享投影预算 PROJECTION_MAX_DEPTH，不是 hover 单方面的 maxDepth 4）。
 */







const DEEP = `export function deep() {
  return { a: { b: { c: { d: { e: 1 } } } } };
}
`;

type Hover = { contents: { value: string } } | null;

async function hoverSignatureAt(
  file: string,
  text: string,
  line: number,
  character: number,
): Promise<string> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const hover = mock.requests.get("textDocument/hover")!;
  const res = hover({
    textDocument: { uri },
    position: { line, character },
  }) as Hover;
  const lines = (res?.contents.value ?? "").split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("hover 签名块：返回类型与 check 同预算（不按 maxDepth 4 截断）", () => {
  it("5 层嵌套：hover 签名给出完整返回类型（改前截成 `{ d: … }`）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951-"));
    const file = join(dir, "deep.js");
    writeFileSync(file, DEEP);
    try {
      const sig = await hoverSignatureAt(file, DEEP, 0, 16);
      expect(sig).toBe("deep() => { a: { b: { c: { d: { e: 1 } } } } }");
      expect(sig).not.toContain("…");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hover 签名行与 `nudo check` 签名行逐字相同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951b-"));
    const file = join(dir, "deep.js");
    writeFileSync(file, DEEP);
    try {
      const sig = await hoverSignatureAt(file, DEEP, 0, 16);
      expect(sig).toBe("deep() => { a: { b: { c: { d: { e: 1 } } } } }");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("更深的嵌套不再逐字节相同（深度 4 与深度 8 的 hover 输出不同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951c-"));
    const file4 = join(dir, "d4.js");
    const file8 = join(dir, "d8.js");
    const d4 = `export function nest() {
  return { n: { n: { n: { n: 1 } } } };
}
`;
    const d8 = `export function nest() {
  return { n: { n: { n: { n: { n: { n: { n: { n: 1 } } } } } } } };
}
`;
    writeFileSync(file4, d4);
    writeFileSync(file8, d8);
    try {
      const s4 = await hoverSignatureAt(file4, d4, 0, 16);
      const s8 = await hoverSignatureAt(file8, d8, 0, 16);
      expect(s4).toBe("nest() => { n: { n: { n: { n: 1 } } } }");
      expect(s8).toBe("nest() => { n: { n: { n: { n: { n: { n: { n: { n: 1 } } } } } } } }");
      expect(s8).not.toBe(s4);
      expect(s8).not.toContain("…");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// hover 签名块：throws 通道不得丢失（check-identical）
// ---------------------------------------------------------------------------
describe("hover 签名块：throws 通道不得丢失（check-identical）", () => {
/**
 * LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。
 *
 * 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽
 * `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」，
 * 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。
 *
 * 原生 oracle：`api/lsp.md` 明写 hover 给 **check-identical signature**
 * ⇒ hover 签名行必须与 `nudo check` 的签名行**逐字相同**（含 throws 段）。
 */







const SRC = `export function risky(x) {
  return x + 1;
}

export function safe(x) {
  return x * 2;
}
`;

type Hover = { contents: { value: string } } | null;

async function hoverSignatureAt(
  file: string,
  text: string,
  line: number,
  character: number,
): Promise<string> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const hover = mock.requests.get("textDocument/hover")!;
  const res = hover({
    textDocument: { uri },
    position: { line, character },
  }) as Hover;
  const lines = (res?.contents.value ?? "").split("\n");
  // 签名块 = ```nudo 之后的第一个非围栏行
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("hover 签名块：throws 通道不得丢失（check-identical）", () => {
  it("会抛的导出函数：hover 签名带 `throws TypeError`（改前静默省略）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911-"));
    const file = join(dir, "throws.js");
    writeFileSync(file, SRC);
    try {
      const sig = await hoverSignatureAt(file, SRC, 0, 16);
      expect(sig).toBe("risky(x: any) => number | string  throws TypeError");
      expect(sig).toContain("throws TypeError");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hover 签名行与 `nudo check` 签名行逐字相同（throws 段一致）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911b-"));
    const file = join(dir, "throws.js");
    writeFileSync(file, SRC);
    try {
      const sig = await hoverSignatureAt(file, SRC, 0, 16);
      // `nudo check` 的人面签名行（core formatCheckReport）：`name(params) => ret throws X`
      const checkLine = "risky(x: any) => number | string  throws TypeError";
      expect(sig).toBe(checkLine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不会抛的函数：无证据 ⇒ **省略** throws 段（不得写 `throws never`）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911c-"));
    const file = join(dir, "clean.js");
    const clean = `export function pure(x) {
  return x;
}
`;
    writeFileSync(file, clean);
    try {
      const sig = await hoverSignatureAt(file, clean, 0, 16);
      expect(sig).toBe("pure(x: any) => any");
      expect(sig).not.toContain("throws");
      expect(sig).not.toContain("never");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非导出函数不带 throws（CLI 的 L2 throws 只对 entry 生效）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911d-"));
    const file = join(dir, "local.js");
    const local = `function helper(x) {
  return x + 1;
}

export function other() {
  return 1;
}
`;
    writeFileSync(file, local);
    try {
      const sig = await hoverSignatureAt(file, local, 0, 10);
      expect(sig).toBe("helper(x: any) => number | string");
      expect(sig).not.toContain("throws");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// hover tier 行：与 CodeLens 同源（选中 case ⇒ 契约档 ○）
// ---------------------------------------------------------------------------
describe("hover tier 行：与 CodeLens 同源（选中 case ⇒ 契约档 ○）", () => {
/**
 * LSP **hover** 的 contract tier 行**硬编码 `active=true`**。
 *
 * 改前：hover 首行恒 `● contract / <src>`，而同一文件的 CodeLens 在
 * 选中 case 后已翻成 `○ contract / <src>` ⇒ 同一个 IDE 里两个面打架
 * （并与 `core/algebra/contract.ts` 写明的语义「○ = 当前观察的是 case」
 * 直接矛盾）。
 *
 * 原生 oracle：hover 首行的 `●/○` 必须与 CodeLens 的契约选项标题**同源**
 * （观察选择器互斥：激活 case ⇒ 契约档 ○）。
 */







const SRC = `/**
 * @nudo:case "c1" (1) => 2
 */
export function classify(x) {
  return x + 1;
}
`;

type Hover = { contents: { value: string } } | null;
type Lens = { command?: { title: string; command: string } };

async function open(file: string, text: string) {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const hover = mock.requests.get("textDocument/hover")!;
  const codeLens = mock.requests.get("textDocument/codeLens")!;
  const exec = mock.requests.get("workspace/executeCommand")!;
  const firstLine = (): string | undefined =>
    (hover({
      textDocument: { uri },
      position: { line: 3, character: 17 },
    }) as Hover)?.contents.value.split("\n")[0];
  const contractLens = (): Lens | undefined =>
    (codeLens({ textDocument: { uri } }) as Lens[]).find(
      (l) => l.command?.command === "nudo.selectContract",
    );
  return { mock, uri, firstLine, contractLens, exec };
}

describe("hover tier 行：与 CodeLens 同源（选中 case ⇒ 契约档 ○）", () => {
  it("选中 case 后 hover 首行翻成 ○ contract / imp（与 CodeLens 标题逐字相同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug724-"));
    const file = join(dir, "tier.js");
    writeFileSync(file, SRC);
    try {
      const { firstLine, contractLens, exec } = await open(file, SRC);

      // 初始：契约档激活 ⇒ ●
      expect(firstLine()).toBe("● contract / imp");
      expect(contractLens()?.command?.title).toBe("● contract / imp");

      exec({
        command: "nudo.selectCase",
        arguments: [`file://${file}`, "classify", 0, "c1"],
      });
      await new Promise((r) => setTimeout(r, 250));

      // 选中 case 后：CodeLens 翻 ○，hover 必须同步（改前 hover 仍恒 ●）
      expect(contractLens()?.command?.title).toBe("○ contract / imp");
      expect(firstLine()).toBe("○ contract / imp");
      // 两个面逐字一致
      expect(firstLine()).toBe(contractLens()?.command?.title);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("取消 case 选择（selectContract）后 hover 首行回到 ●", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug724b-"));
    const file = join(dir, "tier.js");
    writeFileSync(file, SRC);
    try {
      const { uri, firstLine, contractLens, exec } = await open(file, SRC);
      exec({
        command: "nudo.selectCase",
        arguments: [uri, "classify", 0, "c1"],
      });
      await new Promise((r) => setTimeout(r, 250));
      expect(firstLine()).toBe("○ contract / imp");

      exec({ command: "nudo.selectContract", arguments: [uri, "classify"] });
      await new Promise((r) => setTimeout(r, 250));
      expect(contractLens()?.command?.title).toBe("● contract / imp");
      expect(firstLine()).toBe("● contract / imp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});
