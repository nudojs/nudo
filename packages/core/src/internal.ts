/**
 * @nudojs/core/internal — engine machinery for monorepo hosts (service / lsp).
 *
 * NOT a product face. Names here may change in minor. Prefer `@nudojs/core`
 * (`.`) for anything a user or published tool should depend on.
 * See ../PUBLIC_API.md.
 */

// leak / budgets / memo keys
export * from "./algebra/leak.ts";
export * from "./algebra/call-budget.ts";
export * from "./algebra/hash-source.ts";
export * from "./algebra/stable-source-key.ts";
export * from "./algebra/fn-fp.ts";
export * from "./algebra/load-deps-fp.ts";

// derivation sessions + rendering experiments
export * from "./algebra/derivation.ts";
export * from "./algebra/inlay.ts";
export * from "./algebra/template.ts";
export * from "./algebra/denote.ts";
export * from "./algebra/language.ts";

// scan extras used by service (rest of scan stays check-internal)
export {
  checkInjectedDomainEvidence,
  type InjectedDomainRecord,
  type InjectedDomainEvidenceOpts,
  listTopFunctions,
} from "./algebra/scan.ts";

// B-path collectors (not the $op runtime)
export * from "./algebra/exec/may-throw.ts";
export * from "./algebra/exec/member-diag.ts";
