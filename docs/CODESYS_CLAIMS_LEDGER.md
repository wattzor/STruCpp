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
| B1 | `TRUNC`/`ROUND` registered as `ANY_REAL → ANY_REAL` | `grep -n '"TRUNC"' src/semantic/std-function-registry.ts` → line 232 |
| B2 | `AND_THEN` / `OR_ELSE` do not exist | `grep -rn "AND_THEN\|OR_ELSE" src/` → empty |
| B3 | Declaration comments are bound to `VarDeclaration.comment` | `src/frontend/ast-builder.ts` (`findComment`) |
| B4 | Identifiers accept a leading underscore | `src/frontend/lexer.ts:615` |
| B5 | `qualifiedIdentifier` accepts arbitrary depth | `src/frontend/parser.ts:2038` |
| B6 | `ByteAddress` is assigned from a sorted symbol-to-id map and reused per variable | `src/backend/codegen.ts` (stable IDs in `generateVarInfoByteAddress` / `buildVarInfoSymbolIds`) |
| B7 | `BitSize` is `UDINT`, `ByteOffset` is `DINT`, `Area` is `INT` per A1 | `src/runtime/include/iec_varinfo.hpp`, `src/semantic/system-types.ts`, `src/backend/codegen.ts` |
| B8 | `TYPE_CLASS` ends at `TYPE_BITCONST := 38`; undocumented types fall back to `TYPE_USERDEF` | `src/semantic/system-types.ts`, `src/runtime/include/iec_system.hpp`, `src/semantic/iec-types-data.ts` |
| B9 | `__XWORD` falls back to `TYPE_USERDEF` because its `TYPE_CLASS` is undocumented | `src/semantic/iec-types-data.ts` |
| B10 | PR#6/#7 are rebased onto PR#3 (`devin/query-interface`) | `git merge-base devin/query-interface devin/p4-var-info` → `aff7bda` |
| B11 | Vitest emits `numPendingTests`/`numTodoTests`, never `numSkippedTests` | run any suite with `--reporter=json` |
| B12 | Current promotion behaviour: F1=144, F2=22, F3=24564, F4=64, F5=4464, F8=2/3/−2 | `tests/integration/__snapshots__/codesys-semantics-assumed.test.ts.snap` |

---

## Tier C — UNVERIFIED. Do not encode as fact.

Each of these is currently either implemented in the compiler or written into a plan **without a
CODESYS source**. Every one needs either a documentation link or an oracle run.

### Arithmetic and conversion
| # | Claim | Status |
|---|---|---|
| C1 | `BYTE * BYTE` result stays `BYTE` and wraps | Implemented; snapshot 144. No source. |
| C2 | Mixed-width result takes the larger operand type and wraps there | Implemented in `e79eee4`; F4=64, F5=4464. **No source.** |
| C3 | `INT + UINT` is permitted rather than a type error | Implemented as permitted. No source. |
| C4 | `TO_INT` rounds to nearest | Implemented. No source. |
| C5 | The `.5` tie rule is half-away-from-zero | Snapshot shows 2/3/−2. **No source.** Banker's rounding is equally plausible. |
| C6 | `TRUNC`/`ROUND` return `DINT` | From the developer's gap list. I confirmed the code *diverges* from it — not that the claim is right. |
| C7 | `TRUNC_INT` exists and returns `INT` | No source. |

### Boolean evaluation
| # | Claim | Status |
|---|---|---|
| C8 | Plain `AND`/`OR` evaluate both operands (no short-circuit) | **No source.** Shapes codegen for every boolean expression — verify before W1.1. |
| C9 | `AND_THEN`/`OR_ELSE` short-circuit | No source. |

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
| C17 | `NumElements` for a non-array | **Unverified.** A1 documents `NumElements` for arrays only. Currently hardcoded to `0`; tagged `@oracle: assumed` until a source or oracle run confirms it. |
| C18 | `TYPE_CLASS` values 39–48 (`TYPE_UXINT` … `TYPE_LTIMEOFDAY`) | **No source found; implementation now avoids them.** The documented enum ends at 38. STruCpp exposes only 0–38 and maps undocumented elementary types (e.g. `__XWORD`) to `TYPE_USERDEF` instead of inventing values. |
| C19 | `AnyType` memory layout — padding and alignment | Declaration order is documented (A4). Actual in-memory layout is not. |
| C20 | `VAR_INFO` members accessible case-insensitively (`vi.ByteAddress`) | ST is case-insensitive in general, but untested here. |

### Everything else touched
| # | Claim | Status |
|---|---|---|
| C21 | `SIZEOF` returns logical IEC byte sizes | Implemented in `aff7bda`. No source. |
| C22 | `XSIZEOF` returns `__XWORD` | No source. |
| C23 | `INDEXOF` / `BITADR` semantics | No source. |
| C24 | `ANY_BIT` / `ANY_INT` / `ANY_NUM` / `ANY_REAL` / `ANY_DATE` / `ANY_STRING` membership sets | Partly inferable from A6; the exact sets are not documented in what I found. |
| C25 | Struct packing and member offsets | No source. `{attribute 'pack_mode'}` exists but its exact effect is unverified. |

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

C8 (short-circuit) and C6 (`TRUNC` return type) shape implementation rather than test
expectations — getting them wrong means rework, not a re-baseline. C18 is a live ABI defect.
C2 and C5 are already in the compiler and load-bearing. Those five first.

---

## A note on why this document exists

I asserted, confidently and incorrectly, that IEC 61131-3 forbids recursion and that the compiler
should therefore reject it. A7–A10 show the real picture: functions error, methods are allowed
with a warning, and general detection is an opt-in static-analysis rule. Had that gone
unchallenged it would have become a compile-time rejection of valid CODESYS code.

That is one measured error on exactly the class of claim filling Tier C. Treat the tier boundary
as real.
