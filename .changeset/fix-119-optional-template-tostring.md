---
"@nudojs/core": patch
---

Fix false `entry-may-throw` ("ToString coercion of abstract operand (Symbol)") on template interpolation of `optional()`/`nullable()` slots (issue #119): `isMaybeBigintOperand` no longer treats `lit(null)`/`lit(undefined)` sum members (shape `unknown` + literal term) as maybe-bigint/Symbol — ToString/ToNumber of nullish literals is total. Value domains unchanged; unconstrained `any` operands and obj/fn/brand union arms still record may-throw.
