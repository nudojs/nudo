/**
 * Bug 40 回归：内建 brand 原型方法的 presence 面（值读 typeof / `in`）。
 *
 * 此前 BUILTIN_BRAND_METHODS 无 ArrayBuffer / SharedArrayBuffer / DataView /
 * TypedArray 非回调方法 / WeakRef / FinalizationRegistry 条目，Date/RegExp/
 * Map/Set 家族名录不全：brand $get 落内层闭 obj 槽 miss → 折精确
 * undefined（typeof 折 "undefined"），$in 落 brandHasProtoMember miss →
 * 折精确 false——对原生恒有成员做 wrong-exact 断言（feature detection
 * `if (typeof buf.resize === "function")` 被证伪）。修复口径：
 * - members.ts BUILTIN_BRAND_METHODS 按宿主原型面补齐（Node 26
 *   Object.getOwnPropertyNames(X.prototype) 实测名录）；
 * - TA 家族换 TYPED_ARRAY_PROTO_METHOD_NAMES 全量面（回调调用派发仍只认
 *   TYPED_ARRAY_CALLBACK_METHODS）；base64/hex 仅 Uint8Array 自有；
 * - BUILTIN_BRAND_ACCESSORS 补二进制/TA/RegExp 访问器名（$in presence）；
 * - @@iterator 值读只对 ITERABLE_BRANDS（Map/Set/TA）折 "function"——
 *   Date/WeakMap/Error 等非可迭代 brand 原生 undefined，此前也折 "function"
 *   （反向 wrong-exact）；
 * - ArrayBuffer/SAB/DataView/WeakRef/FCR 进 NAMESPACE_GLOBALS——
 *   `typeof ArrayBuffer.prototype.slice` 此前落宿主 fn 通用通道的空闭 obj
 *   → "undefined"（Bug 56 通道补齐）。
 *
 * 缺席名控制组：内建原型面闭合（宿主固定成员），未注册名折精确
 * undefined/false 与原生一致（不是 imprecision 债）；any 接收者才走诚实
 * unknown（typeof → string 域）。
 *
 * 原生 ground truth：node v26.10.0 实测（node -e 逐行对照）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import { formatShape } from "../format.ts";

/** 无参入口：返回结果渲染（字面量 → JSON 值；域 → formatShape） */
function val(src: string): string {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, "f", []);
  const lv = litValue(r.result);
  return lv.ok ? JSON.stringify(lv.value) : formatShape(r.result);
}

/** 抽象实参入口（any 接收者 → 诚实 unknown 控制组） */
function valWithArgs(src: string, args: Abs[]): string {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, "f", args);
  const lv = litValue(r.result);
  return lv.ok ? JSON.stringify(lv.value) : formatShape(r.result);
}

describe("Bug 40: typeof 值读——报告矩阵（修后全折 function）", () => {
  const cases: [string, string][] = [
    ["typeof new ArrayBuffer(8).slice", "function f() { return typeof new ArrayBuffer(8).slice; }"],
    ["typeof new ArrayBuffer(8).resize", "function f() { return typeof new ArrayBuffer(8).resize; }"],
    ["typeof new ArrayBuffer(8).transfer", "function f() { return typeof new ArrayBuffer(8).transfer; }"],
    ["typeof new SharedArrayBuffer(8).slice", "function f() { return typeof new SharedArrayBuffer(8).slice; }"],
    ["typeof new DataView(buf).getUint8", "function f() { return typeof new DataView(new ArrayBuffer(8)).getUint8; }"],
    ["typeof new DataView(buf).setBigUint64", "function f() { return typeof new DataView(new ArrayBuffer(8)).setBigUint64; }"],
    ["typeof new Int8Array(4).map", "function f() { return typeof new Int8Array(4).map; }"],
    ["typeof new Uint8Array(4).set", "function f() { return typeof new Uint8Array(4).set; }"],
    ["typeof new Uint8Array(4).subarray", "function f() { return typeof new Uint8Array(4).subarray; }"],
    ["typeof new WeakRef({}).deref", "function f() { return typeof new WeakRef({}).deref; }"],
    ["typeof new FinalizationRegistry(cb).register", "function f() { return typeof new FinalizationRegistry(() => {}).register; }"],
    ["typeof new FinalizationRegistry(cb).unregister", "function f() { return typeof new FinalizationRegistry(() => {}).unregister; }"],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(val(src)).toBe('"function"');
    });
  }
});

describe("Bug 40: in 操作符——报告矩阵（修后全折 true）", () => {
  const cases: [string, string][] = [
    ["\"slice\" in new ArrayBuffer(8)", "function f() { return 'slice' in new ArrayBuffer(8); }"],
    ["\"resize\" in new ArrayBuffer(8)", "function f() { return 'resize' in new ArrayBuffer(8); }"],
    ["\"getUint8\" in new DataView(buf)", "function f() { return 'getUint8' in new DataView(new ArrayBuffer(8)); }"],
    ["\"forEach\" in new Uint8Array(4)", "function f() { return 'forEach' in new Uint8Array(4); }"],
    ["\"set\" in new Uint8Array(4)", "function f() { return 'set' in new Uint8Array(4); }"],
    ["\"deref\" in new WeakRef({})", "function f() { return 'deref' in new WeakRef({}); }"],
    ["\"register\" in new FinalizationRegistry(cb)", "function f() { return 'register' in new FinalizationRegistry(() => {}); }"],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(val(src)).toBe("true");
    });
  }
});

describe("Bug 40: Date / RegExp / Map / Set 家族冷门方法", () => {
  const cases: [string, string, string][] = [
    ["typeof new Date().toUTCString", "function f() { return typeof new Date().toUTCString; }", '"function"'],
    ["typeof new Date().getUTCFullYear", "function f() { return typeof new Date().getUTCFullYear; }", '"function"'],
    ["typeof new Date().setMilliseconds", "function f() { return typeof new Date().setMilliseconds; }", '"function"'],
    ["typeof new Date().toJSON", "function f() { return typeof new Date().toJSON; }", '"function"'],
    ["typeof /a/.compile", "function f() { return typeof /a/.compile; }", '"function"'],
    ["typeof new Map().getOrInsert", "function f() { return typeof new Map().getOrInsert; }", '"function"'],
    ["typeof new Set().union", "function f() { return typeof new Set().union; }", '"function"'],
    ["typeof new WeakMap().getOrInsertComputed", "function f() { return typeof new WeakMap().getOrInsertComputed; }", '"function"'],
    ["\"toUTCString\" in new Date()", "function f() { return 'toUTCString' in new Date(); }", "true"],
    ["\"compile\" in /a/", "function f() { return 'compile' in /a/; }", "true"],
    ["\"getOrInsert\" in new Map()", "function f() { return 'getOrInsert' in new Map(); }", "true"],
  ];
  for (const [label, src, expected] of cases) {
    it(label, () => {
      expect(val(src), label).toBe(expected);
    });
  }
});

describe("Bug 40: TA 家族抽样（12 家族共用 %TypedArray%.prototype 面）", () => {
  const fams = [
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
  ];
  for (const fam of fams) {
    it(`typeof new ${fam}(2).sort / fill / entries → function；"join" in → true`, () => {
      expect(val(`function f() { return typeof new ${fam}(2).sort; }`)).toBe('"function"');
      expect(val(`function f() { return typeof new ${fam}(2).fill; }`)).toBe('"function"');
      expect(val(`function f() { return typeof new ${fam}(2).entries; }`)).toBe('"function"');
      expect(val(`function f() { return 'join' in new ${fam}(2); }`)).toBe("true");
    });
  }
  it("base64/hex 面仅 Uint8Array 原生自有（Float64Array 不得反向 wrong-exact）", () => {
    expect(val("function f() { return typeof new Uint8Array(2).toBase64; }")).toBe('"function"');
    expect(val("function f() { return typeof new Uint8Array(2).setFromHex; }")).toBe('"function"');
    expect(val("function f() { return typeof new Float64Array(2).toBase64; }")).toBe('"undefined"');
    expect(val("function f() { return 'toHex' in new Float64Array(2); }")).toBe("false");
  });
});

describe("Bug 40: 访问器 presence（BUILTIN_BRAND_ACCESSORS 补 $in）", () => {
  const cases: [string, string][] = [
    ["\"length\" in ta", "function f() { return 'length' in new Uint8Array(4); }"],
    ["\"buffer\" in ta", "function f() { return 'buffer' in new Uint8Array(4); }"],
    ["\"BYTES_PER_ELEMENT\" in ta", "function f() { return 'BYTES_PER_ELEMENT' in new Uint8Array(4); }"],
    ["\"buffer\" in dv", "function f() { return 'buffer' in new DataView(new ArrayBuffer(8)); }"],
    ["\"byteOffset\" in dv", "function f() { return 'byteOffset' in new DataView(new ArrayBuffer(8)); }"],
    ["\"detached\" in ab", "function f() { return 'detached' in new ArrayBuffer(8); }"],
    ["\"growable\" in sab", "function f() { return 'growable' in new SharedArrayBuffer(8); }"],
    ["\"unicodeSets\" in /a/", "function f() { return 'unicodeSets' in /a/; }"],
    ["\"dotAll\" in /a/", "function f() { return 'dotAll' in /a/; }"],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(val(src)).toBe("true");
    });
  }
  it("访问器值读：槽面未建模名 → 诚实 unknown（typeof 折 string 域，不断言缺席）", () => {
    // 原生 boolean/object/number——此前折精确 undefined（wrong-exact）
    expect(val("function f() { return typeof new ArrayBuffer(8).detached; }")).toBe("string");
    expect(val("function f() { return typeof new DataView(new ArrayBuffer(8)).buffer; }")).toBe("string");
    expect(val("function f() { return typeof new Uint8Array(4).buffer; }")).toBe("string");
    expect(val("function f() { return typeof new Uint8Array(4).BYTES_PER_ELEMENT; }")).toBe("string");
    expect(val("function f() { return typeof /a/.unicodeSets; }")).toBe("string");
  });
  it("访问器值读：own 槽精确面不回退（Bug 15/28 控制）", () => {
    expect(val("function f() { return typeof new ArrayBuffer(8).resizable; }")).toBe('"boolean"');
    expect(val("function f() { return typeof /a/.dotAll; }")).toBe('"boolean"');
    expect(val("function f() { return typeof /a/.source; }")).toBe('"string"');
  });
});

describe("Bug 40: @@iterator 值读按可迭代性分流（ITERABLE_BRANDS）", () => {
  it("可迭代 brand（Map/Set/TA）→ \"function\"", () => {
    expect(val("function f() { return typeof new Map()[Symbol.iterator]; }")).toBe('"function"');
    expect(val("function f() { return typeof new Set()[Symbol.iterator]; }")).toBe('"function"');
    expect(val("function f() { return typeof new Uint8Array(4)[Symbol.iterator]; }")).toBe('"function"');
  });
  it("非可迭代 brand → \"undefined\"（原生一致；此前任意有表 brand 都折 \"function\"）", () => {
    expect(val("function f() { return typeof new Date()[Symbol.iterator]; }")).toBe('"undefined"');
    expect(val("function f() { return typeof new WeakMap()[Symbol.iterator]; }")).toBe('"undefined"');
    expect(val("function f() { return typeof /a/[Symbol.iterator]; }")).toBe('"undefined"');
    expect(val("function f() { return typeof new Error('x')[Symbol.iterator]; }")).toBe('"undefined"');
    expect(val("function f() { return typeof new ArrayBuffer(8)[Symbol.iterator]; }")).toBe('"undefined"');
    expect(val("function f() { return typeof new WeakRef({})[Symbol.iterator]; }")).toBe('"undefined"');
  });
});

describe("Bug 40: X.prototype.<method> 值读（Bug 56 通道补二进制/弱引用家族）", () => {
  const cases: [string, string][] = [
    ["typeof ArrayBuffer.prototype.slice", "function f() { return typeof ArrayBuffer.prototype.slice; }"],
    ["typeof SharedArrayBuffer.prototype.grow", "function f() { return typeof SharedArrayBuffer.prototype.grow; }"],
    ["typeof DataView.prototype.getUint8", "function f() { return typeof DataView.prototype.getUint8; }"],
    ["typeof WeakRef.prototype.deref", "function f() { return typeof WeakRef.prototype.deref; }"],
    ["typeof FinalizationRegistry.prototype.register", "function f() { return typeof FinalizationRegistry.prototype.register; }"],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(val(src)).toBe('"function"');
    });
  }
});

describe("Bug 40: 控制组", () => {
  it("表内名（既有表）不回退", () => {
    expect(val("function f() { return typeof new Map().get; }")).toBe('"function"');
    expect(val("function f() { return typeof /a/.test; }")).toBe('"function"');
    expect(val("function f() { return typeof new WeakSet().add; }")).toBe('"function"');
  });
  it("缺席名折精确 undefined/false（内建原型面闭合，与原生一致）", () => {
    expect(val("function f() { return typeof new ArrayBuffer(8).noSuchMethod; }")).toBe('"undefined"');
    expect(val("function f() { return 'size' in new ArrayBuffer(8); }")).toBe("false");
    expect(val("function f() { return 'nope' in new ArrayBuffer(8); }")).toBe("false");
    expect(val("function f() { return 'nope' in new DataView(new ArrayBuffer(8)); }")).toBe("false");
    expect(val("function f() { return 'nope' in new WeakRef({}); }")).toBe("false");
  });
  it("any 接收者 → 诚实 unknown（typeof 折 string 域，不做精确断言）", () => {
    expect(valWithArgs("function f(x) { return typeof x.slice; }", [anyAbs])).toBe("string");
    expect(valWithArgs("function f(x) { return 'slice' in x; }", [anyAbs])).toBe("boolean");
  });
  it("访问器值读既有槽面不回退（Bug 15 控制行）", () => {
    expect(val("function f() { return typeof new ArrayBuffer(8).byteLength; }")).toBe('"number"');
    expect(val("function f() { return typeof new ArrayBuffer(8).maxByteLength; }")).toBe('"number"');
  });
  it("调用面维持诚实 unknown（不因 presence 精确而伪造调用结果）", () => {
    // new ArrayBuffer(8).slice(0,4) → 未建模调用：byteLength 不得折精确 4
    expect(val("function f() { return new ArrayBuffer(8).slice(0, 4).byteLength; }")).toBe("unknown");
    // 抽象接收者：调用结果 unknown
    expect(valWithArgs("function f(ab) { return ab.resize(16); }", [anyAbs])).toBe("any");
  });
  it("守卫场景：feature detection 不再被证伪", () => {
    expect(val(
      "function f() { if (typeof new ArrayBuffer(8).resize === 'function') return 'resizable'; return 'frozen'; }",
    )).toBe('"resizable"');
    expect(val(
      "function f() { if ('getUint8' in new DataView(new ArrayBuffer(8))) return 'dv'; return 'no'; }",
    )).toBe('"dv"');
  });
});
