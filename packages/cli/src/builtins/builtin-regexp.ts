import { type TypeValue, T } from "@nudojs/core";

export const REGEXP_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  test: () => T.boolean,
  exec: () => T.union(T.null, T.object({})),
  toString: () => T.string,
};

export const REGEXP_PROPS: Record<string, TypeValue> = {
  source: T.string,
  flags: T.string,
  global: T.boolean,
  ignoreCase: T.boolean,
  multiline: T.boolean,
  dotAll: T.boolean,
  unicode: T.boolean,
  sticky: T.boolean,
};

export function createRegExpType(): TypeValue {
  return T.instanceOf("RegExp", {
    source: T.string,
    flags: T.string,
    global: T.boolean,
    ignoreCase: T.boolean,
    multiline: T.boolean,
    dotAll: T.boolean,
    unicode: T.boolean,
    sticky: T.boolean,
    test: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    exec: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    toString: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}
