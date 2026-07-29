# STruC++ — source ledger

Every CODESYS behavioural claim made across this work, with its evidence status.

**Three tiers:**
- **A — Verified** against primary CODESYS documentation. URL given. Safe to implement against.
- **B — Repository fact.** Verified by reading or running the code. Reproducible command given.
- **C — UNVERIFIED.** Asserted from training or inference. **Do not encode as fact.** These need a
  documentation source or an oracle run before anything depends on them.

Tier C is the important part of this document. If a value is in Tier C and it is in the compiler
rather than in an `@oracle: assumed` snapshot, that is a defect waiting to surface.

**Rule for moving a claim from Tier C to Tier A:** the entry must quote the exact sentence or table
from the source that covers the specific claim. A source that only covers the related concept is not
enough — e.g. A1 documents `NumElements` for arrays, so it cannot be used to settle the value for
non-arrays without an explicit non-array statement.

---

## Tier A — Verified against CODESYS documentation

### A1. `__SYSTEM.VAR_INFO` structure — 14 fields, declared order
https://content.helpme-codesys.com/en/LibDevSummary/var_info.html
Settles: field names, field order, and **exact types** — `ByteAddress: DWORD`, `ByteOffset: DINT`,
`Area: INT`, `BitNr: INT`, `BitSize: UDINT`, `BitAdress: UDINT`, `TypeClass`, `TypeName: STRING(79)`,
`NumElements: UDINT`, `BaseTypeClass`, `ElemBitSize: UDINT`, `MemoryArea`, `Symbol: STRING(39)`,
`Comment: STRING(79)`. Also settles that `BitAdress` is undefined unless the variable is at
`%M`/`%I`/`%Q`, that `BitNr` is `-1` for non-bit types, and that for arrays `NumElements` is the
"number of base elements". It does **not** state the value of `NumElements` for non-arrays.
Used by: ABI spec §1; implementation spec §5; review findings B2.

### A2. `__SYSTEM.TYPE_CLASS` — exactly 39 values, 0–38
https://content.helpme-codesys.com/en/LibDevSummary/type_class.html
Settles: the enum is `DWORD`-based, carries `{attribute 'qualified_only'}`, and closes at
`TYPE_BITCONST := DWORD#38`. **No values above 38 appear.**
Used by: ABI spec §2; review finding B1.

### A3. `__SYSTEM.MEMORY_AREA` — 7 values
https://content.helpme-codesys.com/en/LibDevSummary/memory_area.html
Settles: `MEM_UNKNOWN := -1` through `MEM_LOCAL := 5`, `{attribute 'qualified_only'}`.
Note the `-1` forces a signed underlying type.

### A4. `AnyType` descriptor and the `funGenericCompare` example
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_datatype_any.html
Settles: `typeclass : __SYSTEM.TYPE_CLASS`, `pvalue : POINTER TO BYTE`, `diSize : DINT` (bytes).
Also demonstrates `any1.pvalue[i]` subscripting and `ADR(anyParam)` — both are required
capabilities, not optional.
Settles: only `ANY`, `ANY_BIT`, `ANY_DATE`, `ANY_NUM`, `ANY_REAL`, `ANY_INT`, and `ANY_STRING`
may be used as generic `VAR_INPUT` parameter types; `ANY_ELEMENTARY`, `ANY_MAGNITUDE`, and
`ANY_DERIVED` are **not** valid parameter types, and no `ANY`/`ANY_*` group may be the return
type of a `FUNCTION`.
Used by: implementation spec §6; the P5 acceptance gate.

### A5. `__VARINFO` operator syntax and semantics
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_varinfo.html
Settles: it is an operator applied to a named variable, assigned into a `__SYSTEM.VAR_INFO`
variable; documented as an extension to IEC 61131-3.

### A6. CODESYS elementary data types
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_reference_datatypes.html
Settles: the CODESYS-specific types `BIT`, `__UXINT`, `__XINT`, `__XWORD` exist, alongside
`LDATE`, `LDT`, `LTOD`, `LTIME`. Note: **their existence is documented; their `TYPE_CLASS` values
are not.** See C18.

### A7. Function recursion is a compile error
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_error_c0224.html
Settles: error C0224 "Call Recursion", cause "a function calls itself", correction "make sure
that functions are not recursive".
Used by: hardening list G14a.

### A8. Method recursion is allowed
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_method.html
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_method_call.html
Settles: a method may call itself directly via `THIS` or via a local FB variable; a compiler
**warning** is issued; and specifying only the method name is insufficient — that produces a
compiler error, so the call must be qualified.
Used by: hardening list G14b, G14c, G14d.

### A9. `estimated-stack-usage` suppresses the recursion warning
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pragma_attribute_estimated_stack_usage.html
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_calculate_stack_usage.html
Settles: recursive methods cannot pass the stack check, so a warning is raised;
`{attribute 'estimated-stack-usage' := '<bytes>'}` supplies an estimate and suppresses it. Stack
calculation aborts on recursion.

### A10. SA0160 — recursion as an optional static-analysis rule
https://content.helpme-codesys.com/en/CODESYS%20Static%20Analysis/_san_rule_sa0160.html
Settles: recursion detection across actions, methods and properties — including via virtual and
interface calls — lives in Static Analysis, **not** in the compiler.

### A11. Struct-member enumeration is not offered
https://forge.codesys.com/forge/talk/Engineering/thread/1841b60548/
A user asks directly whether `__SYSTEM.VAR_INFO` can enumerate the elements of a structure. No
mechanism is offered. Basis for the "do not build enumeration" scope decision.

### A12. Temporary arithmetic results are computed at the target native width
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html
Settles: "The CODESYS compiler ... computes temporary results always with the native size that is
defined by the target device." It is at least 32-bit on x86/ARM and 64-bit on x64. Overflow/underflow
is not truncated in temporaries; truncation happens on assignment or via an explicit conversion.
Implemented as native-width promotion in `iec_arith_result_t`; target width can be overridden with
`-DSTRUCPP_TARGET_WIDTH=32/64`.

### A13. `WORD + 1` assigned to `DWORD` is not truncated in the temporary
https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html
Settles the four worked examples: `dwVar := wVar + 1` yields `65536`; `(wVar1 + 1) = wVar2` and
`(wVar2 - 1) = wVar1` are `FALSE`; assignment to `wVar3` truncates and makes `wVar3 = wVar2` `TRUE`;
`TO_WORD(wVar1 + 1) = wVar2` is `TRUE` because the conversion forces 16-bit truncation. These are
asserted in `tests/integration/codesys-semantics.test.ts` under `@oracle: codesys-doc`.

### Vendor mirrors — useful cross-checks
Beckhoff TwinCAT: https://infosys.beckhoff.com/content/1033/tc3_plc_intro/3527777675.html
ABB Automation Builder: https://help.plc.abb.com/d65c2f6ba848a40a0c1142b3e895c6da_1_en_us.html
Schneider Machine Expert: https://product-help.schneider-electric.com/Machine%20Expert/V2.0/en/SoMProg/SoMProg/D-SE-0083761.html
All three are CODESYS-derived. Agreement across vendors raises confidence; disagreement means the
behaviour is vendor-specific and must not be treated as CODESYS canon.

---

## Tier B — Repository facts (reproducible)

| # | Fact | How to reproduce |
|---|---|---|
| B1 | `TRUNC`/`ROUND` now registered as `ANY_REAL → DINT` | `src/semantic/std-function-registry.ts` lines 245-258; `src/runtime/include/iec_std_lib.hpp` lines 354-378 |
| B2 | `AND_THEN` / `OR_ELSE` are parsed, typed, and code-gened | `src/frontend/lexer.ts`, `src/frontend/parser.ts`, `src/frontend/ast.ts`, `src/frontend/ast-builder.ts`, `src/backend/codegen.ts` |
| B3 | Declaration comments are bound to `VarDeclaration.comment` | `src/frontend/ast-builder.ts` (`findComment`) |
| B4 | Identifiers accept a leading underscore | `src/frontend/lexer.ts:615` |
| B5 | `qualifiedIdentifier` accepts arbitrary depth | `src/frontend/parser.ts:2038` |
| B6 | `ByteAddress` is assigned from a sorted symbol-to-id map and reused per variable | `src/backend/codegen.ts` (stable IDs in `generateVarInfoByteAddress` / `buildVarInfoSymbolIds`) |
| B7 | `BitSize` is `UDINT`, `ByteOffset` is `DINT`, `Area` is `INT` per A1 | `src/runtime/include/iec_varinfo.hpp`, `src/semantic/system-types.ts`, `src/backend/codegen.ts` |
| B8 | `TYPE_CLASS` ends at `TYPE_BITCONST := 38`; undocumented types fall back to `TYPE_USERDEF` | `src/semantic/system-types.ts`, `src/runtime/include/iec_system.hpp`, `src/semantic/iec-types-data.ts` |
| B9 | `__XWORD` falls back to `TYPE_USERDEF` because its `TYPE_CLASS` is undocumented | `src/semantic/iec-types-data.ts` |
| B10 | PR#6/#7 are rebased onto PR#3 (`devin/query-interface`) | `git merge-base devin/query-interface devin/p4-var-info` → `aff7bda` |
| B11 | Vitest emits `numPendingTests`/`numTodoTests`, never `numSkippedTests` | run any suite with `--reporter=json` |
| B12 | Current promotion behaviour: F1=400, F2=150, F3=90100, F4=65600, F5=70000, F8=2/3/−2 | `tests/integration/__snapshots__/codesys-semantics-assumed.test.ts.snap` |

---

## Tier C — UNVERIFIED. Do not encode as fact.

Each of these is currently either implemented in the compiler or written into a plan **without a
CODESYS source**. Every one needs either a documentation link or an oracle run.

### Arithmetic and conversion
| # | Claim | Status |
|---|---|---|
| C1 | `BYTE * BYTE` result stays `BYTE` and wraps | **Resolved.** CODESYS computes temporary results at the target native width and only truncates on assignment or explicit conversion; `BYTE * BYTE` assigned to `BYTE` wraps, but the temporary itself is not truncated. Implemented via `iec_arith_result_t` native-width promotion. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html |
| C2 | Mixed-width result takes the larger operand type and wraps there | **Resolved.** The CODESYS Operators reference shows `wVar := wVar + 1` produces `65536` in a `DWORD`, and `(wVar1 + 1) = wVar2` is `FALSE` because the temporary is not truncated. Implemented as native-width promotion (at least 32-bit on x86/ARM, 64-bit on x64), truncating only on assignment or `TO_*`. Target width is configurable via `-DSTRUCPP_TARGET_WIDTH=32/64`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html |
| C3 | Mixed signed/unsigned operands (`INT + UINT`, `INT < UDINT`, `MAX(INT, UDINT)`, etc.) are permitted rather than a type error | Implemented as permitted. The runtime now compares/selects using sign-aware logic on the original values, and arithmetic follows native-width promotion. CODESYS does not explicitly state whether cross-sign-class expressions are allowed; `@oracle: assumed`. If CODESYS rejects them, a compile-time diagnostic should be added in addition to the mathematically-correct runtime. **Partial source:** PLCnext table allows `UINT` → `DINT`/`LINT`/`REAL`/`LREAL` implicit conversion, which makes `INT + UINT` valid by promoting `UINT`. CODESYS does not explicitly state this combination; `@oracle: assumed`. Source: https://engineer.plcnext.help/2025.0_en/DataTypes_ImpliciteTypeConversion.htm |
| C4 | `TO_INT` rounds to nearest | Implemented. **Partial source:** CODESYS conversion operators page notes rounding for borderline cases depends on the target FPU, so the tie rule is not universally fixed. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html |
| C5 | The `.5` tie rule is half-away-from-zero | **Target-dependent per CODESYS docs.** `ROUND` borderline cases depend on the target FPU; CODESYS gives `-1.5` as an example of target-specific behavior. STruCpp uses `std::round` (half-away-from-zero on Linux/x86_64); snapshot is `@oracle: host-x86_64-fpu`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html |
| C6 | `TRUNC`/`ROUND` return `DINT` | **Verified and implemented.** CODESYS V3: `TRUNC` converts `REAL` → `DINT`; `ROUND` returns the nearest `DINT`. STruCpp now returns `IEC_DINT` for both. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_trunc.html |
| C7 | `TRUNC_INT` exists and returns `INT` | **Verified and implemented.** CODESYS V3: `TRUNC_INT` converts `REAL` to `INT`; it is the V2.3 spelling of `TRUNC`. STruCpp now returns `IEC_INT` for `TRUNC_INT` and `IEC_DINT` for `TRUNC`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_trunc_int.html |

### Boolean evaluation
| # | Claim | Status |
|---|---|---|
| C8 | Plain `AND`/`OR` evaluate both operands (no short-circuit) | **Verified.** CODESYS docs state plain `AND` always evaluates all operands; `AND_THEN` is the short-circuit form. STruCpp codegen uses `&`/`|` for plain `AND`/`OR`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_and_then.html |
| C9 | `AND_THEN`/`OR_ELSE` short-circuit | **Verified and implemented.** CODESYS docs state `AND_THEN` only evaluates the right operand when the left is `TRUE`; `OR_ELSE` only when left is `FALSE`. STruCpp codegen uses `&&`/`||`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_and_then.html |

### Strings, time, loops, FBs
| # | Claim | Status |
|---|---|---|
| C10 | String functions are 1-based | No source. |
| C11 | Default `STRING` is `STRING(80)` | No source. |
| C12 | `TIME` is 32-bit ms, wrapping ~49.7 days; `LTIME` is 64-bit ns | No source. |
| C13 | `FOR i : BYTE := 0 TO 255` loops forever | No source. |
| C14 | `FOR` end value and `BY` step evaluated once at entry | No source. |
| C15 | FB inputs retain their values across partial calls | No source. Load-bearing for protocol state machines. |

### `VAR_INFO` / `ANY` specifics
| # | Claim | Status |
|---|---|---|
| C16 | `__VARINFO` on a `VAR_IN_OUT` describes the parameter, not the caller's argument | A Forge thread implies it; not authoritative. |
| C17 | `NumElements` for a non-array | **Still unverified.** A1 documents `NumElements` only for `ARRAY` variables. CODESYS `__VARINFO` examples only show arrays. STruCpp hardcodes `0` for non-arrays; tagged `@oracle: assumed`. Sources: A1; https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_varinfo.html |
| C18 | `TYPE_CLASS` values 39–48 (`TYPE_UXINT` … `TYPE_LTIMEOFDAY`) | **No source found; implementation now avoids them.** The documented enum ends at 38. STruCpp exposes only 0–38 and maps undocumented elementary types (e.g. `__XWORD`) to `TYPE_USERDEF` instead of inventing values. |
| C19 | `AnyType` memory layout — padding and alignment | Field order and types documented (A4 and the CODESYS `AnyType` definition). In-memory padding/alignment is not specified and is effectively `@oracle: host-compiler`. Sources: A4; https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_datatype_any.html |
| C20 | `VAR_INFO` members accessible case-insensitively (`vi.ByteAddress`) | Implemented and tested. `tests/integration/var-info.test.ts` asserts `vi.ByteAddress`, `vi.BYTEADDRESS`, etc. resolve to the same value. |

### Everything else touched
| # | Claim | Status |
|---|---|---|
| C21 | `SIZEOF` returns logical IEC byte sizes | Implemented and tested. CODESYS `SIZEOF` returns the number of bytes needed by the variable or type, always unsigned. STruCpp `IEC_SIZEOF` matches logical byte sizes for elementary types, arrays, structs, strings, and FB instances/type names. Return-type adaptation is contradictory in the doc (`adapted to operand` vs. implicit `USINT` example); currently returns `IEC_UDINT` and is `@oracle: assumed` for width. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_sizeof.html |
| C22 | `XSIZEOF` returns platform-width unsigned | Implemented and tested. CODESYS V3: `XSIZEOF` returns the number of bytes, always unsigned; return type is `ULINT` on 64-bit platforms and `UDINT` otherwise. STruCpp returns `IEC_XWORD` (`__XWORD`), which is pointer-width unsigned and resolves to the same platform-width type. `tests/integration/xsizeof.test.ts` covers variables and type names. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_xsizeof.html |
| C23 | `INDEXOF` / `BITADR` semantics | Sourced. `INDEXOF` is deprecated in V3; use `ADR` instead. `BITADR` yields a `DWORD` bit offset; the top nibble encodes the memory range (`16#4` marker, `16#8` input, `16#C` output) and the rest encodes the bit offset, affected by the target's "Byte addressing" setting. Sources: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_indexof.html; https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_bitadr.html |
| C24 | `ANY_BIT` / `ANY_INT` / `ANY_NUM` / `ANY_REAL` / `ANY_DATE` / `ANY_STRING` membership sets | Sourced. `ANY` accepts `ANY_BIT` + `ANY_DATE` + `ANY_NUM` + `ANY_STRING`. `ANY_NUM` = `ANY_REAL` + `ANY_INT`. `ANY_BIT` = `BYTE`/`WORD`/`DWORD`/`LWORD`. `ANY_INT` = signed + unsigned integers. `ANY_DATE` includes `DATE`, `DT`, `TOD`, `LDATE`, `LDT`, `LTOD`. `ANY_STRING` = `STRING`/`WSTRING`. `ANY_REAL` = `REAL`/`LREAL`. Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_datatype_any.html |
| C25 | Valid generic `VAR_INPUT` parameter types | Sourced. Only `ANY`, `ANY_BIT`, `ANY_DATE`, `ANY_NUM`, `ANY_REAL`, `ANY_INT`, and `ANY_STRING` may be used as declared generic parameter types. `ANY_ELEMENTARY`, `ANY_MAGNITUDE`, and `ANY_DERIVED` are not valid. Source: A4 |
| C26 | Generic `VAR_INPUT` arguments must be variable expressions | Sourced. `ANY`/`ANY_*` parameters are passed by pointer as an `AnyType` descriptor; the actual argument must be a variable location. Literals, function-call results, and other expressions are rejected. Source: A4 |
| C27 | Generic values cannot be forwarded to standard functions | Sourced. A generic `ANY`/`ANY_*` value is an `AnyType` descriptor, not a concrete value, so it cannot be passed directly to standard functions such as `LIMIT` or `ADD`. `ADR`/`SIZEOF`/`XSIZEOF` are exceptions because they operate on the descriptor/variable. Source: A4 |
| C28 | `FUNCTION`s cannot return an `ANY`/`ANY_*` type | Sourced. Generic groups are only permitted in `VAR_INPUT` parameters; user-defined functions must return a concrete type. Source: A4 |
| C29 | Struct packing and member offsets | No source. `{attribute 'pack_mode'}` exists but its exact effect is unverified. |

### Environment claims used for process decisions
These came from searches earlier in this work whose citations I did not retain. They informed
tooling recommendations, not compiler behaviour, so the risk is low — but re-verify before
relying on them: the CODESYS Development System is Windows-only while the runtime is
cross-platform, and CODESYS Control Win/Linux SL runs unlicensed for two hours per session.

---

## How to use this

1. **Nothing from Tier C goes into the compiler as a hard-coded value.** It goes into an
   `@oracle: assumed` snapshot, reviewed line by line when created.
2. **Tag every expected value** with its provenance: `@oracle: codesys-doc <url>`,
   `@oracle: rfc7748`, `@oracle: codesys-run 3.5.x`, or `@oracle: assumed`.
3. **Have CI print the count per tier.** Tier C then becomes a visible burn-down list rather than
   invisible debt.
4. **When a Tier C item is resolved, move it to Tier A with its URL** and re-baseline any snapshot
   that depended on it.

### Priority for resolution

C1 and C2 are resolved: the CODESYS Operators reference explicitly states that intermediate results
are not truncated to the operand data type without an explicit conversion, and STruCpp now implements
native-width promotion with truncation only on assignment or `TO_*`. C8 and C6 are verified/implemented.
C5 remains target-dependent. C18 is a live ABI defect. Next: C3/C4/C17/C21 for the oracle.

---

## L1 — Oracle for Tier C claims

The partial oracle compiled for Tier C is in `research/oracle-tier-c.md`. It contains:

- Direct CODESYS Development System and Library Development Summary URLs for each claim.
- Vendor-derived cross-checks (Beckhoff, PLCnext, Fernhill, OpenPLC) where CODESYS is silent.
- A note that CODESYS explicitly marks `ROUND` tie-rule and overflow/conversion behavior as **target-dependent** (FPU / processor width), so host-machine snapshots are `@oracle: host-x86_64-fpu` rather than universal truth.
- A plan for a real runtime oracle using CODESYS Control Win V3 or a vendor runtime to settle C1–C5, C17, C21, and C25.


## A note on why this document exists

I asserted, confidently and incorrectly, that IEC 61131-3 forbids recursion and that the compiler
should therefore reject it. A7–A10 show the real picture: functions error, methods are allowed
with a warning, and general detection is an opt-in static-analysis rule. Had that gone
unchallenged it would have become a compile-time rejection of valid CODESYS code.

That is one measured error on exactly the class of claim filling Tier C. Treat the tier boundary
as real.
