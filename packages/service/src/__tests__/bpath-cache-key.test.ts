import { it, expect, describe, afterEach } from "vitest";
import { tryRunBPath, tryBPathCall, clearBPathCache } from "@nudojs/service";
import { litValue } from "@nudojs/core";

afterEach(() => clearBPathCache());

describe("bRunCache key", () => {
  // 同长度、前 200+ 字符完全相同、尾部不同的两份源码：
  // 旧前缀截断键会命中同一条缓存，静默返回陈旧结果。
  const head = `// ${"x".repeat(210)}\nexport function f() { return `;
  const srcA = `${head}1; }`;
  const srcB = `${head}2; }`;

  it("same source twice returns the identical cached run", () => {
    const a = tryRunBPath(srcA, "/test/cache-key.js");
    const b = tryRunBPath(srcA, "/test/cache-key.js");
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it("same length + same prefix but different tail must not collide", () => {
    const r1 = tryRunBPath(srcA, "/test/cache-key.js");
    const r2 = tryRunBPath(srcB, "/test/cache-key.js");
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r2).not.toBe(r1);

    // 语义正确性：srcB 的求值必须看到 f() = 2，而非 srcA 的陈旧 1
    const out = tryBPathCall(srcB, "/test/cache-key.js", "f", []);
    if (!out) throw new Error("expected f to resolve via B path");
    expect(litValue(out)).toBe(2);
  });
});
