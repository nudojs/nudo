/**
 * 成员键分类/投影的单一实现（读、写、调用、可选链共用）。
 *
 * 关键不变量：
 * - 非计算 Identifier → 字符串槽键；
 * - 计算 StringLiteral → 字符串槽键；NumericLiteral → `$lit(value)` 下标键；
 * - 计算 `Symbol.X` → `"@@X"` 投影（`symbol` 字段保留原名，Proxy / delete
 *   边界需要还原真 symbol 或构造 symbol Abs）；
 * - 计算表达式 → 运行时下标键。
 *
 * 可选链此前自己维护了一套分类，漏掉 `Symbol.X` 投影 ⇒
 * `m?.[Symbol.iterator]` 折 undefined（非链路径读到 function）。
 */
import type { Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { privateNameKeySrc, symbolKeyOf } from "./helpers.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";

export type EmittedMemberKey =
  | {
      kind: "get";
      /** 槽键（字符串；symbol 投影为 "@@X"） */
      key: string;
      /** 符号投影名（X）；非符号键 undefined */
      symbol?: string;
    }
  | {
      kind: "idx";
      /** 运行时下标键源（Abs） */
      keySrc: string;
      /** 数字字面量的具体值（用于 ToPropertyKey / const 判定） */
      constNumber?: number;
    };

/** 分类成员键；不支持的形态返回 null（调用方抛 unsupported / 回落）。 */
export function emitMemberKey(
  property: Node,
  computed: boolean,
  opts: TranspileOptions,
): EmittedMemberKey | null {
  if (!computed) {
    if (property.type === "Identifier") {
      return { kind: "get", key: property.name };
    }
    if (property.type === "PrivateName") {
      const key = privateNameKeySrc(
        property as unknown as { id?: { name?: string }; name?: string },
      );
      // privateNameKeySrc 返回 JSON 字符串源（"\"#x\""）；EmittedMemberKey.key
      // 统一存**裸槽键**，由消费方 JSON.stringify 发射。
      return key === null ? null : { kind: "get", key: JSON.parse(key) as string };
    }
    return null;
  }
  if (property.type === "StringLiteral") {
    return { kind: "get", key: property.value };
  }
  if (property.type === "NumericLiteral") {
    return { kind: "idx", keySrc: `$lit(${property.value})`, constNumber: property.value };
  }
  const sym = symbolKeyOf(property as unknown as Parameters<typeof symbolKeyOf>[0]);
  if (sym !== null) {
    // symbolKeyOf 返回已引号化的 "@@X"；这里存裸名 X，key 用槽键。
    const raw = JSON.parse(sym) as string;
    return { kind: "get", key: raw, symbol: raw.slice(2) };
  }
  return { kind: "idx", keySrc: emitTranspileExpression(property as never, opts) };
}
