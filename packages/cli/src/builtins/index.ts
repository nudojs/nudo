import { type TypeValue } from "@nudojs/core";
import { PROMISE_STATIC_METHODS } from "./builtin-promise.ts";
import { MAP_INSTANCE_METHODS, createMapType } from "./builtin-map.ts";
import { SET_INSTANCE_METHODS, createSetType } from "./builtin-set.ts";
import { REGEXP_INSTANCE_METHODS, createRegExpType } from "./builtin-regexp.ts";
import { URL_INSTANCE_METHODS, URLSearchParams_INSTANCE_METHODS, createURLType, createURLSearchParamsType } from "./builtin-url.ts";
import {
  RESPONSE_INSTANCE_METHODS,
  HEADERS_INSTANCE_METHODS,
  FORMDATA_INSTANCE_METHODS,
  ABORTCONTROLLER_INSTANCE_METHODS,
  createResponseType,
  createHeadersType,
  createFormDataType,
  createAbortControllerType,
} from "./builtin-web.ts";
import { WEAKMAP_INSTANCE_METHODS, WEAKSET_INSTANCE_METHODS, createWeakMapType, createWeakSetType } from "./builtin-weak.ts";
import { SYMBOL_STATIC_METHODS, SYMBOL_STATIC_PROPS } from "./builtin-symbol.ts";
import { REFLECT_METHODS } from "./builtin-reflect.ts";
import { INTL_DATETIMEFORMAT_METHODS, INTL_NUMBERFORMAT_METHODS, createDateTimeFormatType, createNumberFormatType } from "./builtin-intl.ts";

export const ALL_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  Promise: PROMISE_STATIC_METHODS,
  Symbol: SYMBOL_STATIC_METHODS,
};

export const ALL_STATIC_PROPS: Record<string, Record<string, TypeValue>> = {
  Symbol: SYMBOL_STATIC_PROPS,
};

export const ALL_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  Map: MAP_INSTANCE_METHODS,
  Set: SET_INSTANCE_METHODS,
  RegExp: REGEXP_INSTANCE_METHODS,
  URL: URL_INSTANCE_METHODS,
  URLSearchParams: URLSearchParams_INSTANCE_METHODS,
  Response: RESPONSE_INSTANCE_METHODS,
  Headers: HEADERS_INSTANCE_METHODS,
  FormData: FORMDATA_INSTANCE_METHODS,
  AbortController: ABORTCONTROLLER_INSTANCE_METHODS,
  WeakMap: WEAKMAP_INSTANCE_METHODS,
  WeakSet: WEAKSET_INSTANCE_METHODS,
  DateTimeFormat: INTL_DATETIMEFORMAT_METHODS,
  NumberFormat: INTL_NUMBERFORMAT_METHODS,
};

export {
  createMapType,
  createSetType,
  createRegExpType,
  createURLType,
  createURLSearchParamsType,
  createResponseType,
  createHeadersType,
  createFormDataType,
  createAbortControllerType,
  createWeakMapType,
  createWeakSetType,
  createDateTimeFormatType,
  createNumberFormatType,
};
