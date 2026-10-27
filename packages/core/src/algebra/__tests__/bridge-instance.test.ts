/**
 * 类方法桥实例构造（值域 + 证据域共用）：构造器抛 ⇒ 裸实例兜底
 * （brand 保留、内层 unknown/partial、外层 path）；证据域经 isolate 隔离
 * 构造器效果，值域不传 isolate（无会话语义）。
 */
import { describe, it, expect } from "vitest";
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { $class } from "../exec/class.ts";
import { bareInstanceOf, instanceForMethodBridge } from "../bridge-instance.ts";
import {
  recordMayThrow,
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const unknownInner = abs({ k: "unknown" }, undefined, undefined, "partial");

/** 类值（brand + ctor facet），类名唯一以免跨测试碰撞 */
function classValueOf(name: string, ctor?: (thisVal: Abs) => Abs): Abs {
  return $class(name, ctor ? { ctor } : {});
}

describe("bareInstanceOf：裸实例形状", () => {
  it("brand 名取类值的 brand 名；内层 unknown/partial；外层 path", () => {
    const cls = abs(
      { k: "brand", name: "X", shape: unknownInner, ctor: true },
      undefined,
      undefined,
      "path",
    );
    const inst = bareInstanceOf(cls, "Fallback");
    expect(inst.conf).toBe("path");
    expect(inst.shape.k).toBe("brand");
    if (inst.shape.k !== "brand") return;
    expect(inst.shape.name).toBe("X");
    expect(inst.shape.shape.shape.k).toBe("unknown");
    expect(inst.shape.shape.conf).toBe("partial");
  });

  it("类值不是 brand（或 brand 名为空）⇒ 回落类名", () => {
    const notBrand = abs({ k: "unknown" }, undefined, undefined, "opaque");
    const a = bareInstanceOf(notBrand, "Fallback");
    expect(a.shape.k).toBe("brand");
    if (a.shape.k === "brand") expect(a.shape.name).toBe("Fallback");

    const emptyName = abs(
      { k: "brand", name: "", shape: unknownInner },
      undefined,
      undefined,
      "path",
    );
    const b = bareInstanceOf(emptyName, "Fallback");
    expect(b.shape.k).toBe("brand");
    if (b.shape.k === "brand") expect(b.shape.name).toBe("Fallback");
  });
});

describe("instanceForMethodBridge：构造器抛 ⇒ 裸实例", () => {
  it("generalize 侧（无 isolate）：构造器必抛仍返回裸实例", () => {
    const cls = classValueOf("BridgeThrows", () => {
      throw new Error("boom");
    });
    const inst = instanceForMethodBridge(cls, "BridgeThrows", []);
    expect(inst.conf).toBe("path");
    expect(inst.shape.k).toBe("brand");
    if (inst.shape.k !== "brand") return;
    expect(inst.shape.name).toBe("BridgeThrows");
    expect(inst.shape.shape.shape.k).toBe("unknown");
    expect(inst.shape.shape.conf).toBe("partial");
  });

  it("check-may-throw 侧（isolate）：构造器抛不逃逸，isolate 恰好包裹一次", () => {
    const cls = classValueOf("BridgeThrowsIsolated", () => {
      throw new Error("boom");
    });
    let calls = 0;
    const isolate = <T,>(body: () => T): T => {
      calls++;
      return body();
    };
    const inst = instanceForMethodBridge(cls, "BridgeThrowsIsolated", [], isolate);
    expect(calls).toBe(1);
    expect(inst.shape.k).toBe("brand");
    if (inst.shape.k === "brand") expect(inst.shape.shape.shape.k).toBe("unknown");
  });

  it("构造器正常返回时返回真实实例（不退化裸实例）", () => {
    const cls = classValueOf("BridgeNormal");
    const inst = instanceForMethodBridge(cls, "BridgeNormal", []);
    expect(inst.shape.k).toBe("brand");
    if (inst.shape.k !== "brand") return;
    // 构造器写入的字段存在（裸实例内层 unknown 不带具体槽）
    expect(inst.shape.shape.shape.k).toBe("obj");
  });
});

describe("instanceForMethodBridge：证据域隔离构造器效果", () => {
  const ctorWithEffect = (): Abs => {
    recordMayThrow({ kind: "TypeError", cause: "ctor coercion" });
    return abs({ k: "unknown" }, undefined, undefined, "partial");
  };

  it("isolate = runWithMayThrowSession ⇒ 构造器软效果不进外层收集域", () => {
    const cls = classValueOf("BridgeCoerceIsolated", ctorWithEffect);
    const effects: MayThrowEffect[] = [];
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => effects.push(e));
      try {
        instanceForMethodBridge(cls, "BridgeCoerceIsolated", [], runWithMayThrowSession);
      } finally {
        setMayThrowCollector(null);
      }
    });
    expect(effects).toEqual([]);
  });

  it("无 isolate（值域口径）⇒ 构造器效果照常记录", () => {
    const cls = classValueOf("BridgeCoercePlain", ctorWithEffect);
    const effects: MayThrowEffect[] = [];
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => effects.push(e));
      try {
        instanceForMethodBridge(cls, "BridgeCoercePlain", []);
      } finally {
        setMayThrowCollector(null);
      }
    });
    expect(effects.map((e) => e.kind)).toEqual(["TypeError"]);
  });
});
