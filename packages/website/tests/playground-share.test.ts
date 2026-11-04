// Playground 分享链接编解码门禁：share.ts 是纯函数（无 window/框架依赖），
// 钉住「编码 round-trip 无损（含 base64 敏感字符与 Unicode）」与「超长源码
// 截断后 URL 落在预算内且截断事实如实上报」两条契约——PlaygroundApp 的
// Copy link / hash 恢复 / 防抖回写全部建立在这层之上。
import { describe, it, expect } from "vitest";

import {
  encodeShareValue,
  decodeShareValue,
  parseShareParams,
  buildShareLink,
  MAX_SHARE_URL_LENGTH,
} from "../src/playground/share.ts";

const BASE = "https://nudojs.github.io/nudo/playground/";

describe("share value codec", () => {
  it("round-trips unicode sources", () => {
    const src = "// 中文注释 🚀\nexport const s = 'a+b/c=d';";
    expect(decodeShareValue(encodeShareValue(src))).toBe(src);
  });

  it("survives base64 + / = inside URLSearchParams round-trip", () => {
    const src = "————————————————"; // b64 输出必含 + / =
    const enc = encodeURIComponent(encodeShareValue(src));
    const back = new URLSearchParams(`code=${enc}`).get("code");
    expect(decodeShareValue(back)).toBe(src);
  });

  it("returns null for garbage instead of throwing", () => {
    expect(decodeShareValue("not-base64!!")).toBeNull();
    expect(decodeShareValue("")).toBeNull();
    expect(decodeShareValue(null)).toBeNull();
  });
});

describe("parseShareParams", () => {
  it("reads code/sidecar/preset from a hash string", () => {
    const src = `export function scale(x) {\n  return x + 1;\n}\n`;
    const enc = encodeURIComponent(encodeShareValue(src));
    const parsed = parseShareParams(`#code=${enc}&preset=observe-scale`);
    expect(parsed.code).toBe(src);
    expect(parsed.preset).toBe("observe-scale");
    expect(parsed.sidecar).toBeNull();
  });

  it("accepts bare params and legacy search-style strings", () => {
    const enc = encodeURIComponent(encodeShareValue("x"));
    expect(parseShareParams(`code=${enc}`).code).toBe("x");
    expect(parseShareParams(`?code=${enc}`).code).toBe("x");
  });

  it("tolerates broken values", () => {
    // %24%24 → "$$"：不是合法 base64 字符，atob 抛错 → 归 null 而不是崩
    const parsed = parseShareParams("#code=%24%24&preset=p");
    expect(parsed.code).toBeNull();
    expect(parsed.preset).toBe("p");
  });
});

describe("buildShareLink budget", () => {
  it("keeps short sources untruncated and carries the preset id", () => {
    const link = buildShareLink(BASE, { preset: "observe-scale", code: "scale(5);" });
    expect(link.truncatedCode).toBe(false);
    expect(link.truncatedSidecar).toBe(false);
    expect(link.codeChars).toBe("scale(5);".length);
    expect(link.hash).toMatch(/^#code=.+&preset=observe-scale$/);
    expect(link.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
  });

  it("round-trips through parseShareParams (single + sidecar)", () => {
    const link = buildShareLink(BASE, {
      preset: "sidecar-scale",
      code: "scale(3);",
      sidecar: "export const scale = number().gt(0);",
    });
    const parsed = parseShareParams(link.hash);
    expect(parsed.code).toBe("scale(3);");
    expect(parsed.sidecar).toBe("export const scale = number().gt(0);");
    expect(parsed.preset).toBe("sidecar-scale");
  });

  it("truncates oversized code to fit the url budget", () => {
    const code = `// blob\nexport const blob = "${"k".repeat(20000)}";\n`;
    const link = buildShareLink(BASE, { preset: "observe-scale", code });
    expect(link.truncatedCode).toBe(true);
    expect(link.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    expect(link.codeChars).toBeGreaterThan(0);
    expect(link.codeChars).toBeLessThan(code.length);
    const parsed = parseShareParams(link.hash);
    expect(parsed.code).toBe(code.slice(0, link.codeChars));
  });

  it("truncates the sidecar when it alone busts the budget", () => {
    const big = "//" + "s".repeat(20000);
    const link = buildShareLink(BASE, { preset: "sidecar-scale", code: "x", sidecar: big });
    expect(link.truncatedSidecar).toBe(true);
    expect(link.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
  });
});
