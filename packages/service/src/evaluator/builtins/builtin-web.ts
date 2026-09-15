import { type TypeValue, T } from "@nudojs/core";

export const RESPONSE_PROPS: Record<string, TypeValue> = {
  ok: T.boolean,
  status: T.number,
  statusText: T.string,
  url: T.string,
  type: T.string,
  redirected: T.boolean,
  headers: T.unknown, // Headers instance
  body: T.unknown,
  bodyUsed: T.boolean,
};

export const RESPONSE_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  json: () => T.promise(T.unknown),
  text: () => T.promise(T.string),
  arrayBuffer: () => T.promise(T.unknown),
  blob: () => T.promise(T.unknown),
  clone: () => T.unknown,
  formData: () => T.promise(T.unknown),
};

export const HEADERS_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  entries: () => T.unknown,
  keys: () => T.unknown,
  values: () => T.unknown,
  forEach: () => T.undefined,
};

export const FORMDATA_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  getAll: () => T.array(T.unknown),
  entries: () => T.unknown,
  keys: () => T.unknown,
  values: () => T.unknown,
  forEach: () => T.undefined,
};

export const ABORTCONTROLLER_PROPS: Record<string, TypeValue> = {
  signal: T.unknown,
};

export const ABORTCONTROLLER_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  abort: () => T.undefined,
};

export function createResponseType(): TypeValue {
  return T.instanceOf("Response", {
    ok: T.boolean,
    status: T.number,
    statusText: T.string,
    url: T.string,
    type: T.string,
    redirected: T.boolean,
    headers: T.unknown,
    body: T.unknown,
    bodyUsed: T.boolean,
    json: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    text: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    arrayBuffer: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    blob: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    clone: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    formData: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}

export function createHeadersType(): TypeValue {
  return T.instanceOf("Headers", {
    get: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    set: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    has: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    delete: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    append: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    entries: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    keys: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    values: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    forEach: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}

export function createFormDataType(): TypeValue {
  return T.instanceOf("FormData", {
    get: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    set: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    has: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    delete: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    append: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    getAll: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    entries: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    keys: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    values: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    forEach: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}

export function createAbortControllerType(): TypeValue {
  return T.instanceOf("AbortController", {
    signal: T.unknown,
    abort: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  });
}
