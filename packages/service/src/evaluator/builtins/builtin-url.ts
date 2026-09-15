import { type TypeValue, T } from "@nudojs/core";

export const URL_PROPS: Record<string, TypeValue> = {
  href: T.string,
  origin: T.string,
  protocol: T.string,
  host: T.string,
  hostname: T.string,
  port: T.string,
  pathname: T.string,
  search: T.string,
  hash: T.string,
  username: T.string,
  password: T.string,
};

export const URL_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  toString: () => T.string,
};

export const URLSearchParams_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  toString: () => T.string,
  getAll: () => T.array(T.string),
};

export function createURLType(): TypeValue {
  return T.instanceOf("URL", {
    href: T.string,
    origin: T.string,
    protocol: T.string,
    host: T.string,
    hostname: T.string,
    port: T.string,
    pathname: T.string,
    search: T.string,
    hash: T.string,
    username: T.string,
    password: T.string,
    toString: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}

export function createURLSearchParamsType(): TypeValue {
  return T.instanceOf("URLSearchParams", {
    get: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    set: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    has: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    delete: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    append: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    toString: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    getAll: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}
