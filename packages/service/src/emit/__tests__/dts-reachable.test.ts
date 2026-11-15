/**
 * ABS-14 PR4a：HOF entry-only 签名不得发射悬空类型参数。
 *
 * 修复前 `processItems` 投 `<A1, A2, B_transform>`，A2 从未被任何形参或
 * 返回位引用。投影层用已有的 reachableTypeParams 按签名文本过滤；
 * 本夹具同时钉住「每个发射的变元都真的出现在签名位」。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts } from "../dts-generator.ts";

const source = `export function processItems(items, transform) { return items.map(transform); }`;

describe("ABS-14 PR4a HOF 签名变元可达性", () => {
  it("entry-only HOF 不发射未被引用的变元", () => {
    const r = analyzeFile("/test/abs14-dts.js", source);
    const fn = r.functions.find((x) => x.name === "processItems");
    expect(fn).toBeDefined();
    if (!fn) return;
    const decl = projectFunctionDts(fn, undefined).lines.join("\n");
    expect(decl).not.toContain("A2");

    const clause = decl.match(/<([^>]+)>/)?.[1];
    expect(clause).toBeDefined();
    if (!clause) return;
    const rest = decl.replace(/<[^>]+>/, "");
    for (const n of clause.split(",").map((s) => s.trim()).filter(Boolean)) {
      expect(rest).toContain(n);
    }
  });
});
