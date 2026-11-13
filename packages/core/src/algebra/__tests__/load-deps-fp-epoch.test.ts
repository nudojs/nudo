/**
 * ABS-18 · 轮内依赖指纹 memo（`beginDepFingerprintEpoch` / `endDepFingerprintEpoch`）。
 *
 * 契约（watch 宿主专用，默认关闭）：
 * - 轮内同一 `(入口, loader, 稳定源码)` 只读盘一次（`analyzeFile` 与注入复用键共享）；
 * - 轮末 `end` 后重新计算（下一轮依赖可能已变）；
 * - 带 `opts`（ambient gating）的调用**不共享**——闭包语义不同，按文件身份缓存会串味；
 * - 一次性 / LSP 不调用 epoch API ⇒ 行为逐字节不变（本文件用「未开启时每次读盘」钉住）。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  beginDepFingerprintEpoch,
  endDepFingerprintEpoch,
  loadModuleDepsFingerprint,
} from "../key/load-deps-fp.ts";

const ENTRY = `import { f } from "./dep.js";\nexport const g = f;\n`;

function makeLoader(files: Record<string, string>) {
  const calls: string[] = [];
  const load = (spec: string, fromFile: string): string | undefined => {
    const i = fromFile.lastIndexOf("/");
    const base = i >= 0 ? fromFile.slice(0, i) : "";
    const joined = spec.startsWith(".") ? `${base}/${spec.replace(/^\.\//, "")}` : spec;
    calls.push(joined);
    return files[joined];
  };
  return { load, calls };
}

const FILES = {
  "/proj/dep.js": "export function f(x) {\n  return x + 1;\n}\n",
};

afterEach(() => {
  endDepFingerprintEpoch();
});

describe("ABS-18 · 轮内依赖指纹 memo", () => {
  it("默认关闭：每次调用都读盘", () => {
    const { load, calls } = makeLoader(FILES);
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(2);
  });

  it("轮内同一入口只算一次，轮末 end 后重算", () => {
    const { load, calls } = makeLoader(FILES);
    beginDepFingerprintEpoch();
    const a = loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    const b = loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    expect(b).toBe(a); // 同一对象（只读共享）
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(1);

    endDepFingerprintEpoch();
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(2);
  });

  it("稳定源码等价（尾部注释）共享；真实代码变更换键", () => {
    const { load, calls } = makeLoader(FILES);
    beginDepFingerprintEpoch();
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js");
    // 尾部注释不改变稳定源码 ⇒ 键相同（轮内不写盘的契约）
    loadModuleDepsFingerprint(`${ENTRY}\n// note\n`, load, "/proj/entry.js");
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(1);
    // 真实代码变更 ⇒ 新键 ⇒ 重新读盘
    loadModuleDepsFingerprint(
      `import { f } from "./dep.js";\nexport const g = f + 1;\n`,
      load,
      "/proj/entry.js",
    );
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(2);
  });

  it("不同 loader 对象不共享（loader 语义可能不同）", () => {
    const one = makeLoader(FILES);
    const two = makeLoader(FILES);
    beginDepFingerprintEpoch();
    loadModuleDepsFingerprint(ENTRY, one.load, "/proj/entry.js");
    loadModuleDepsFingerprint(ENTRY, two.load, "/proj/entry.js");
    expect(one.calls.filter((p) => p === "/proj/dep.js")).toHaveLength(1);
    expect(two.calls.filter((p) => p === "/proj/dep.js")).toHaveLength(1);
  });

  it("带 opts（ambient gating）不共享", () => {
    const { load, calls } = makeLoader(FILES);
    const opts = { ambientAllowed: () => true };
    beginDepFingerprintEpoch();
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js", opts);
    loadModuleDepsFingerprint(ENTRY, load, "/proj/entry.js", opts);
    // 主依赖每次都要读（不进 memo）
    expect(calls.filter((p) => p === "/proj/dep.js")).toHaveLength(2);
  });
});
