import { type TypeValue } from "@nudojs/core";
import { PROMISE_STATIC_METHODS } from "./builtin-promise.ts";
import { MAP_INSTANCE_METHODS, createMapType } from "./builtin-map.ts";

export const ALL_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  Promise: PROMISE_STATIC_METHODS,
};

export const ALL_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  Map: MAP_INSTANCE_METHODS,
};

export { createMapType };
