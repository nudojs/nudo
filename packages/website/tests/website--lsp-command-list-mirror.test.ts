// 族 32（文档 / 站点一致性）T2 的回归钉。
//
// Bug 941 —— 发布文档页（en + zh-Hans）「Public API 冻结面」表里的
//   executeCommand / custom requests 两行是**手抄**的清单，与实现侧
//   `packages/lsp/src/public-api.ts` 的两张冻结表没有共同来源 ⇒ 增删命令时
//   站点页必然漂移（漂了一行：漏 `nudo.selectContract` / `nudo/selectContract`），
//   于是**同一页两份清单互相打架**（页内生成块那份是对的）。
//   本钉**从实现侧取清单**（import 冻结表常量，不硬编码任何命令名），
//   断言站点页的清单 == 实现侧清单，且页内生成块那份也 == 实现侧清单。
//
// Bug 912 —— `concepts/mocking.md` 曾写「未 mock 的全局会真跑 ⇒ ERR_INVALID_URL
//   崩掉整轮（exit 1）」，与实现相反：宿主副作用函数在分析期**不执行** ⇒
//   结果加宽 `unknown#opaque` ⇒ 上报 `nudo:host-effect-blocked`（Info）⇒
//   整轮不崩、退出码不受影响。本钉断言文档与实现口径一致：被拦截的宿主名单
//   取自 core 的真源（`NEVER_EXEC_HOST_FN_NAMES`，只读扫描，不改 core）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NUDO_EXECUTE_COMMANDS, NUDO_SLASH_REQUESTS } from "@nudojs/lsp/public-api";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const EN_LSP = join(repoRoot, "packages/website/docs/api/lsp.md");
const ZH_LSP = join(
  repoRoot,
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/api/lsp.md",
);
const EN_MOCKING = join(repoRoot, "packages/website/docs/concepts/mocking.md");
const ZH_MOCKING = join(
  repoRoot,
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/concepts/mocking.md",
);
const ALGEBRA_README = join(repoRoot, "docs/examples/algebra/README.md");
const ALGEBRA_FIXTURE = join(repoRoot, "docs/examples/algebra/f-async-eff.js");
const CORE_CALLS = join(repoRoot, "packages/core/src/algebra/exec/calls.ts");

const SKELETON_BEGIN = "<!-- NUDO-API-SKELETON:BEGIN -->";
const SKELETON_END = "<!-- NUDO-API-SKELETON:END -->";

/** `nudo/X` ↔ `nudo.X` 是行尾的**通用模板**（“任意命令”），不是命令名。 */
const TEMPLATE_TOKENS = new Set(["nudo/X", "nudo.X"]);

function freezeRow(src: string, label: string): string {
  const row = src.split("\n").find((l) => l.startsWith(`| ${label} |`));
  if (!row) throw new Error(`freeze row "| ${label} |" not found`);
  return row;
}

function backticked(row: string): string[] {
  return [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** 站点页「Freeze row」表里点号形（`nudo.x`）命令名。 */
function docDotCommands(src: string): string[] {
  const row = freezeRow(src, "executeCommand");
  return backticked(row).filter((t) => t.startsWith("nudo.") && !TEMPLATE_TOKENS.has(t));
}

/** 站点页「Freeze row」表里斜杠形（`nudo/x`）请求名。 */
function docSlashCommands(src: string): string[] {
  const row = freezeRow(src, "custom requests");
  return backticked(row).filter((t) => t.startsWith("nudo/") && !TEMPLATE_TOKENS.has(t));
}

/** 页内生成块（marker 之内）里由 `PUBLIC_API.md` §3 生成的协议命令表。 */
function generatedDotCommands(src: string): string[] {
  const begin = src.indexOf(SKELETON_BEGIN);
  const end = src.indexOf(SKELETON_END);
  if (begin < 0 || end < 0 || end < begin) throw new Error("API skeleton markers not found");
  const block = src.slice(begin, end);
  return [...block.matchAll(/^\|\s*<a id="[^"]+"><\/a>`(nudo\.[A-Za-z.]+)`\s*\|/gm)].map((m) => m[1]);
}

/** core 的宿主副作用拦截名单（真源，只读扫描）。 */
function blockedHostNames(): string[] {
  const src = readFileSync(CORE_CALLS, "utf8");
  const block = src.match(/NEVER_EXEC_HOST_FN_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!block) throw new Error("NEVER_EXEC_HOST_FN_NAMES not found in core exec/calls.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("Bug 941 — site freeze-row command lists mirror the implementation", () => {
  it("the implementation freezes a non-empty inventory (guard against a vacuous gate)", () => {
    expect(NUDO_EXECUTE_COMMANDS.length).toBeGreaterThan(5);
    expect(NUDO_SLASH_REQUESTS.length).toBeGreaterThan(5);
  });

  for (const [label, path] of [
    ["en", EN_LSP],
    ["zh", ZH_LSP],
  ] as const) {
    it(`${label} page lists exactly the implemented executeCommand names`, () => {
      const doc = docDotCommands(readFileSync(path, "utf8"));
      expect(doc.length, `${label}: duplicated command names`).toBe(new Set(doc).size);
      expect([...doc].sort(), `${label} page vs NUDO_EXECUTE_COMMANDS`).toEqual(
        [...NUDO_EXECUTE_COMMANDS].sort(),
      );
    });

    it(`${label} page lists exactly the implemented custom request names`, () => {
      const doc = docSlashCommands(readFileSync(path, "utf8"));
      expect(doc.length, `${label}: duplicated request names`).toBe(new Set(doc).size);
      expect([...doc].sort(), `${label} page vs NUDO_SLASH_REQUESTS`).toEqual(
        [...NUDO_SLASH_REQUESTS].sort(),
      );
    });

    it(`${label} page's generated protocol table mirrors the implementation too`, () => {
      const doc = generatedDotCommands(readFileSync(path, "utf8"));
      expect(doc.length, `${label}: generated block lost the protocol table`).toBe(
        new Set(doc).size,
      );
      expect([...doc].sort(), `${label} generated block vs NUDO_EXECUTE_COMMANDS`).toEqual(
        [...NUDO_EXECUTE_COMMANDS].sort(),
      );
    });
  }

  it("the two protocol forms stay in sync (every slash request has a dot command)", () => {
    const slash = [...NUDO_SLASH_REQUESTS];
    const dot = [...NUDO_EXECUTE_COMMANDS];
    for (const request of slash) {
      const command = request.replace("nudo/", "nudo.");
      expect(dot, `${request} has no matching executeCommand`).toContain(command);
    }
  });
});

describe("Bug 912 — mocking pages state the implemented host-effect policy", () => {
  it("the implementation blocks a non-empty host side-effect inventory", () => {
    expect(blockedHostNames().length).toBeGreaterThan(5);
  });

  for (const [label, path] of [
    ["en", EN_MOCKING],
    ["zh", ZH_MOCKING],
  ] as const) {
    it(`${label} mocking page no longer claims an unmocked global runs for real and crashes`, () => {
      const src = readFileSync(path, "utf8");
      expect(src, `${label}: still claims the ERR_INVALID_URL crash`).not.toContain(
        "ERR_INVALID_URL",
      );
      expect(src, `${label}: missing the host-effect-blocked diagnostic`).toContain(
        "nudo:host-effect-blocked",
      );
      expect(src, `${label}: missing the widened-result wording`).toContain("unknown#opaque");
    });

    it(`${label} mocking page names every host global the evaluator blocks`, () => {
      const src = readFileSync(path, "utf8");
      const missing = blockedHostNames().filter((name) => !src.includes(name));
      expect(missing, `${label} mocking page misses blocked host globals`).toEqual([]);
    });
  }

  it("the algebra example fixture no longer claims the real fetch runs and crashes", () => {
    const src = readFileSync(ALGEBRA_FIXTURE, "utf8");
    expect(src, "fixture still claims the ERR_INVALID_URL crash").not.toContain("ERR_INVALID_URL");
    expect(src, "fixture does not name the host-effect-blocked diagnostic").toContain(
      "nudo:host-effect-blocked",
    );
  });

  it("the algebra examples README describes the same policy", () => {
    const src = readFileSync(ALGEBRA_README, "utf8");
    expect(src, "README still claims the ERR_INVALID_URL crash").not.toContain("ERR_INVALID_URL");
    expect(src, "README does not name the host-effect-blocked diagnostic").toContain(
      "nudo:host-effect-blocked",
    );
  });
});
