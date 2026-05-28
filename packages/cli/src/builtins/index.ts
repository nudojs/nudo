import { type TypeValue } from "@nudojs/core";
import { PROMISE_STATIC_METHODS } from "./builtin-promise.ts";
import { MAP_INSTANCE_METHODS, createMapType } from "./builtin-map.ts";
import { SET_INSTANCE_METHODS, createSetType } from "./builtin-set.ts";
import { REGEXP_INSTANCE_METHODS, createRegExpType } from "./builtin-regexp.ts";

export const ALL_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  Promise: PROMISE_STATIC_METHODS,
};

export const ALL_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  Map: MAP_INSTANCE_METHODS,
  Set: SET_INSTANCE_METHODS,
  RegExp: REGEXP_INSTANCE_METHODS,
};

export { createMapType, createSetType, createRegExpType };
