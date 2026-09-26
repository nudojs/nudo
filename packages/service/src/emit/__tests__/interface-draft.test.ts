/**
 * `nudo contract --draft`（service/interface-draft.ts）：
 * 从已有逻辑生成可审阅契约草稿——callsite 投影 / symbolic 兜底 /
 * handwritten 跳过 / *.nudo.draft.js 不 ambient 绑定。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveInterface } from "@nudojs/core";
import {
  draftInterface,
  formatDraftSummary,
  sidecarDraftPath,
  writeInterfaceDraft,
  collectParamBodyAccesses,
} from "../interface-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CALLS_JS = `export function double(x) {
  return x * 2;
}

double(21);
`;

const HANDWRITTEN = `import { fn, number } from "@nudojs/core";

export const double = fn({ x: number().gt(0) }, number());
`;

describe("draftInterface", () => {
  it("projects call-site evidence into draft DSL", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry).toBeDefined();
    expect(entry!.skipped).toBeUndefined();
    expect(entry!.paramEvidence).toBe("callsite");
    expect(entry!.dsl).toContain("fn({");
    expect(entry!.dsl).toContain("x:");
    // callsite 观测 double(21) 不得变成 lit 硬义务
    expect(entry!.dsl).not.toContain("21");
    expect(r.draftSource).toContain("@nudo:draft");
    expect(r.draftSource).toContain("export const double = ");
    expect(r.draftSource).toContain("NOT loaded as a sidecar");
  });

  it("does not write body-evidence return as DSL obligation", async () => {
    const file = join(dir, "bodyret.js");
    writeFileSync(
      file,
      `export function id(x) { return x; }\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "id");
    expect(entry).toBeDefined();
    // 无 callsite/directive：返回位不得 projected 进 DSL 义务
    if (entry!.returns) {
      expect(entry!.returns.projected).toBe(false);
    }
  });

  it("skips handwritten contracts (never overwrite)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry!.skipped).toBe("handwritten");
    expect(entry!.dsl).toBeUndefined();
    expect(r.draftSource).toContain("Skipped:");
    expect(r.draftSource).toContain("double (handwritten)");
    // 草稿正文不覆盖手写导出
    expect(r.draftSource).not.toMatch(/^export const double = /m);
  });

  it("entry-only export still gets a draft skeleton (no invented obligations)", async () => {
    const file = join(dir, "lonely.js");
    writeFileSync(file, `export function lonely(y) {\n  return y;\n}\n`);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "lonely");
    expect(entry).toBeDefined();
    expect(entry!.paramEvidence).toBe("none");
    expect(entry!.params[0]!.projected).toBe(false);
    // DSL 省略无证据参数槽，不发明 y: …
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("no evidence");
  });

  it("filters by fnNames", async () => {
    const file = join(dir, "multi.js");
    writeFileSync(
      file,
      `export function a(x) { return x; }\nexport function b(x) { return x * 2; }\na(1);\nb(2);\n`,
    );
    const r = await draftInterface(file, { fnNames: ["b"] });
    expect(r.entries.map((e) => e.fn)).toEqual(["b"]);
  });

  it("sidecarDraftPath is *.nudo.draft.js and is not ambient-loaded", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    expect(sidecarDraftPath(file)).toBe(join(dir, "lib.nudo.draft.js"));

    const r = await draftInterface(file);
    const w = writeInterfaceDraft(file, r.draftSource);
    expect(w.written).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    // 正式侧车未创建 — check/effectiveInterface 不会吃到草稿
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
    const loadModule = () => undefined;
    const eff = effectiveInterface(CALLS_JS, "double", {
      loadModule,
      fromFile: file,
    });
    expect(eff).toBeUndefined();
  });

  it("sidecarDraftPath for .ts/.mts never collides with formal sidecar (P0 regression)", () => {
    expect(sidecarDraftPath(join(dir, "lib.ts"))).toBe(join(dir, "lib.nudo.draft.ts"));
    expect(sidecarDraftPath(join(dir, "lib.mts"))).toBe(join(dir, "lib.nudo.draft.ts"));
    expect(sidecarDraftPath(join(dir, "lib.mjs"))).toBe(join(dir, "lib.nudo.draft.js"));
    const formalTs = join(dir, "lib.nudo.ts");
    expect(sidecarDraftPath(join(dir, "lib.ts"))).not.toBe(formalTs);
    // write 守卫：draft 路径撞正式侧车时拒绝
    expect(() =>
      writeInterfaceDraft(join(dir, "lib.ts"), "export const x = 1;\n", { dryRun: false }),
    ).not.toThrow();
    expect(existsSync(join(dir, "lib.nudo.ts"))).toBe(false);
  });

  it("TS draft write lands *.nudo.draft.ts and preserves handwritten *.nudo.ts", async () => {
    const file = join(dir, "lib.ts");
    writeFileSync(file, CALLS_JS.replace("export function", "export function"));
    writeFileSync(
      join(dir, "lib.nudo.ts"),
      `import { fn, number } from "@nudojs/core";\nexport const double = fn({ x: number().gt(0) }, number());\n// HANDWRITTEN MARKER MUST SURVIVE\n`,
    );
    const r = await draftInterface(file);
    // handwritten skip → 不写 draft 覆盖侧车
    const w = writeInterfaceDraft(file, r.draftSource);
    const formal = readFileSync(join(dir, "lib.nudo.ts"), "utf-8");
    expect(formal).toContain("HANDWRITTEN MARKER MUST SURVIVE");
    expect(w.draftPath).toBe(join(dir, "lib.nudo.draft.ts"));
    expect(w.draftPath).not.toBe(join(dir, "lib.nudo.ts"));
  });

  it("write is idempotent; dryRun does not write", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const dry = writeInterfaceDraft(file, r.draftSource, { dryRun: true });
    expect(dry.changed).toBe(true);
    expect(dry.written).toBe(false);
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);

    const w1 = writeInterfaceDraft(file, r.draftSource);
    expect(w1.written).toBe(true);
    const w2 = writeInterfaceDraft(file, r.draftSource);
    expect(w2.changed).toBe(false);
    expect(w2.written).toBe(false);
  });

  it("formatDraftSummary prints DSL lines and write path", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const text = formatDraftSummary("calls.js", "calls.nudo.draft.js", r).join("\n");
    expect(text).toContain("double");
    expect(text).toContain("draft callsite/");
    const write = writeInterfaceDraft(file, r.draftSource);
    const text2 = formatDraftSummary("calls.js", "calls.nudo.draft.js", r, write).join("\n");
    expect(text2).toContain("Draft written →");
  });

  it("body accesses appear as draft suggestions only (not check obligations)", async () => {
    const file = join(dir, "greet.js");
    writeFileSync(
      file,
      `export function greet(user) {\n  return "hi " + user.name;\n}\n`,
    );
    const map = collectParamBodyAccesses(readFileSync(file, "utf-8"));
    expect(map.get("greet")?.get("user")?.has("name")).toBe(true);

    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "greet");
    expect(entry!.paramEvidence).toBe("body");
    expect(entry!.params[0]!.bodyAccesses).toEqual(["name"]);
    // DSL 不发明 shape({ name }) 义务，仅注释建议
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("body-read { name }");
    expect(r.draftSource).toContain("suggested (body-read, not a contract)");
    expect(r.draftSource).toContain("export const greet = fn({});");
  });

  it("bodyAccesses:false disables body suggestions", async () => {
    const file = join(dir, "greet.js");
    writeFileSync(
      file,
      `export function greet(user) {\n  return "hi " + user.name;\n}\n`,
    );
    const r = await draftInterface(file, { bodyAccesses: false });
    const entry = r.entries.find((e) => e.fn === "greet");
    expect(entry!.paramEvidence).toBe("none");
    expect(entry!.params[0]!.bodyAccesses).toBeUndefined();
  });

  it("skips handwritten sidecar even when project autoBind=false", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "nudo-draft-ab-"));
    try {
      writeFileSync(
        join(dir2, "package.json"),
        JSON.stringify({ name: "ab", nudo: { contract: { autoBind: false } } }),
      );
      const file = join(dir2, "lib.js");
      writeFileSync(file, CALLS_JS);
      writeFileSync(
        join(dir2, "lib.nudo.js"),
        `import { fn, number } from "@nudojs/core";\nexport const double = fn({ x: number().gt(0) }, number());\n`,
      );
      // 产品语义：draft 探测「契约是否存在」，不跟 ambient autoBind 走
      const off = await draftInterface(file);
      const offEntry = off.entries.find((e) => e.fn === "double");
      expect(offEntry!.skipped).toBe("handwritten");

      const on = await draftInterface(file, { autoBind: true });
      const onEntry = on.entries.find((e) => e.fn === "double");
      expect(onEntry!.skipped).toBe("handwritten");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("returnCases fallback without callsite/directive stays body/none (not directive)", async () => {
    const file = join(dir, "bodyonly.js");
    writeFileSync(
      file,
      `export function pick(cfg) {\n  return cfg.mode;\n}\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "pick");
    expect(entry).toBeDefined();
    expect(["body", "none", "symbolic"]).toContain(entry!.returnEvidence);
    expect(entry!.returnEvidence).not.toBe("callsite");
    expect(entry!.returnEvidence).not.toBe("directive");
    expect(entry!.paramEvidence).not.toBe("directive");
  });

  it("P1#12 empty draft dry-run does not claim would-write", async () => {
    const file = join(dir, "empty.js");
    writeFileSync(file, `const x = 1;\nexport { x };\n`);
    const r = await draftInterface(file);
    const draftable = r.entries.filter((e) => e.dsl !== undefined && e.skipped === undefined);
    expect(draftable.length).toBe(0);
    const write = writeInterfaceDraft(file, r.draftSource, { dryRun: true });
    expect(write.draftable).toBe(false);
    const text = formatDraftSummary("empty.js", "empty.nudo.draft.js", r, write).join("\n");
    expect(text).not.toContain("would write");
    expect(text).toContain("nothing written");
  });

  it("writes draft for Unicode export names (parse-layer / Unicode-aware draftable)", async () => {
    const file = join(dir, "unicode.js");
    writeFileSync(
      file,
      `export function 计算(x) {\n  return x * 2;\n}\n\n计算(21);\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "计算");
    expect(entry).toBeDefined();
    expect(entry!.dsl).toBeDefined();
    expect(r.draftSource).toContain("export const 计算 = ");

    // entries path (CLI/LSP preferred)
    const viaEntries = writeInterfaceDraft(file, r.draftSource, { entries: r.entries });
    expect(viaEntries.draftable).toBe(true);
    expect(viaEntries.written).toBe(true);
    const draftPath = join(dir, "unicode.nudo.draft.js");
    expect(existsSync(draftPath)).toBe(true);
    expect(readFileSync(draftPath, "utf-8")).toContain("export const 计算 = ");

    // fallback regex (no entries) must also accept Unicode IDs
    const viaRegex = writeInterfaceDraft(file, r.draftSource, {
      dryRun: true,
      draftable: undefined,
      entries: undefined,
    });
    expect(viaRegex.draftable).toBe(true);
  });

  it("skipped-only draft summary is not claimed as empty", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);
    const r = await draftInterface(file);
    expect(r.entries.some((e) => e.skipped === "handwritten")).toBe(true);
    const write = writeInterfaceDraft(file, r.draftSource, { entries: r.entries, dryRun: true });
    expect(write.draftable).toBe(false);
    const text = formatDraftSummary("lib.js", "lib.nudo.draft.js", r, write).join("\n");
    expect(text).not.toContain("Draft empty (no draftable exports)");
    expect(text).toContain("nothing written");
    expect(text).toContain("skipped");
  });

  it("projectDir containment realpaths both sides (macOS /tmp vs /private/var)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const w = writeInterfaceDraft(file, r.draftSource, { projectDir: dir });
    expect(w.draftable).toBe(true);
    expect(w.written).toBe(true);
  });

  it("draft import list includes any(); optional shape fields become .optional()", async () => {
    const { toDraftBuilderDsl } = await import("../interface-draft.ts");
    // formatConstraint 显示层允许 `email?:`；落盘 draft DSL 必须合法 builder JS
    const display = `shape({ email?: string(), age: number() })`;
    const dsl = toDraftBuilderDsl(display);
    expect(dsl).not.toMatch(/\w\?:/);
    expect(dsl).toContain("email: string().optional()");
    expect(dsl).toContain("age: number()");
    // 已有 .optional() 时不重复追加
    expect(toDraftBuilderDsl(`shape({ email?: string().optional() })`)).toContain(
      "email: string().optional()",
    );

    const file = join(dir, "imp.js");
    writeFileSync(file, `export function id(x) { return x; }\nid(1);\n`);
    const r = await draftInterface(file);
    // 只 import 实际用到的 builder（不恒注入 any/shape/…）
    expect(r.draftSource).toMatch(/import \{ fn, number \} from "@nudojs\/core";/);
    expect(r.draftSource).not.toContain("any,");
  });
});
