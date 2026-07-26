# Tier C Oracle — CODESYS Runtime Semantics

This document records the sources and partial oracles for the Tier C claims in `docs/CODESYS_CLAIMS_LEDGER.md`. The goal is to move each claim from **unverified** to either a documented CODESYS behavior or a reproducible host-machine measurement.

## Sources used

- CODESYS Development System online help: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/
- CODESYS Library Development Summary (`VAR_INFO`, `AnyType`, `TYPE_CLASS`): https://content.helpme-codesys.com/en/LibDevSummary/
- Beckhoff Information System (CODESYS-derived): https://infosys.beckhoff.com/
- PLCnext Engineer documentation (IEC 61131-3 subset): https://engineer.plcnext.help/
- Fernhill IEC 61131-3 reference: https://www.fernhillsoftware.com/help/iec-61131/
- OpenPLC MatIEC-derived runtime source: https://openplcproject.gitlab.io/openplc_v3/

## Resolved / sourced

### C6 — `TRUNC`/`ROUND` return `DINT`

**Status:** resolved by CODESYS V3 docs.

- `TRUNC`: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_trunc.html
  - "The IEC operator is used for converting the `REAL` data type into the `DINT` data type."
  - Examples: `TRUNC(1.9) = 1`, `TRUNC(-1.4) = -1`.
- `ROUND`: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_round.html
  - "The IEC operator is used for converting the `REAL` data type into the `DINT` data type."
  - Note: CODESYS warns that "the rounding logic for borderline cases depends on the target system or the FPU." C5 below captures the tie-rule risk.

### C8 — Plain `AND`/`OR` do not short-circuit

**Status:** resolved by CODESYS V3 docs.

- `AND_THEN`: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_and_then.html
  - "In contrast, CODESYS always evaluates all operands when using the `AND` IEC operator."
  - `AND_THEN` only evaluates the right operand if the left one is `TRUE`.
- `OR_ELSE`: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_or_else.html
  - analogous.

### C9 — `AND_THEN`/`OR_ELSE` short-circuit

**Status:** resolved (same source as C8). STruCpp now maps `AND`/`OR` to `&`/`|` and `AND_THEN`/`OR_ELSE` to `&&`/`||`.

### C7 — `TRUNC_INT` exists and returns `INT`

**Status:** resolved by CODESYS V3 docs.

- `TRUNC_INT` converts `REAL` to `INT`: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_trunc_int.html
- It is the V2.3 spelling of `TRUNC`; V3 `TRUNC` returns `DINT`.

### C19 — `AnyType` layout

**Status:** field order and types documented; in-memory padding/alignment still target-dependent.

- `AnyType` struct definition: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_datatype_any.html
  ```
  TYPE AnyType :
  STRUCT
      typeclass : __SYSTEM.TYPE_CLASS ;
      pvalue    : POINTER TO BYTE;
      diSize    : DINT;
  END_STRUCT
  END_TYPE
  ```
- STruCpp mirrors this in `src/runtime/include/iec_any.hpp`.
- Padding and alignment are not specified by CODESYS; the `AnyType` descriptor is passed by value in our generated code, so exact layout only matters for `ADR(__VARINFO(...))` or pointer casts, which are not yet supported.

## Partially sourced / still open

### C5 — `.5` tie rule for `ROUND`

**Risk:** CODESYS explicitly says the result for borderline cases depends on the target system's FPU.

- Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html
  - "The rounding logic for borderline cases depends on the target system or the FPU of the target system. For example, a value of `-1.5` can be converted differently on different controllers."
- STruCpp uses `std::round`, which on Linux/x86_64 rounds half-away-from-zero. That is a valid host oracle, **not** a universal CODESYS guarantee. The snapshot in `tests/integration/__snapshots__/codesys-semantics-assumed.test.ts.snap` should be tagged `@oracle: host-x86_64-fpu` rather than assumed canon.

### C17 — `NumElements` for non-arrays

**Risk:** CODESYS documents `NumElements` only for arrays.

- Source (VAR_INFO): https://content.helpme-codesys.com/en/LibDevSummary/var_info.html
  - "For Arrays : number of base elements"
  - Requirement: "The variable has the data type `ARRAY`."
- The CODESYS `__VARINFO` operator page shows examples only for arrays and gives no non-array example.
- Plausible value: `0` for non-arrays, because the field is undefined/irrelevant. STruCpp hardcodes `0`; this should stay tagged `@oracle: assumed` until a CODESYS runtime measurement or a second vendor doc confirms it.

### C21 — `SIZEOF` logical byte sizes and return type

**Status:** logical-byte semantics sourced; return-type adaptation is not fully clear.

- Source: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_sizeof.html
  - "The operator determines the number of bytes which are needed in the passed variable or data type. An unsigned value is always returned."
  - Example: `iReturnValue := SIZEOF(aData_1);  (* iReturnValue := USINT#10; *)`
- The doc says "The type of the return value is adapted to that of the passed operand (variable or data type)" but the example hard-codes `USINT#10`, and the implicit-return-type table lists `USINT`. This is contradictory. STruCpp returns `IEC_UDINT` (32-bit unsigned). A host oracle could measure the actual CODESYS Simulation output; until then, the return-type width is `@oracle: assumed`.

### C1–C4 — mixed-width promotion, overflow, `TO_INT` rounding

**Status:** vendor-derived partial oracles exist, no single CODESYS page settles all of them.

- CODESYS conversion operators: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html
  - Overflow/underflow in type conversions is target-dependent.
  - Temporary computations use the native width of the target processor; on x86/ARM at least 32-bit, on x64 at least 64-bit, and are truncated only on assignment.
- PLCnext implicit-conversion table: https://engineer.plcnext.help/2025.0_en/DataTypes_ImpliciteTypeConversion.htm
  - Smaller types can be implicitly converted to larger types in the same category.
  - `UINT` can implicitly convert to `DINT` / `LINT` / `REAL` / `LREAL`.
- Fernhill type-priority table: https://www.fernhillsoftware.com/help/iec-61131/common-elements/datatypes-elementary.html
  - Lists elementary priorities and automatic promotion to the highest-priority operand.
- OpenPLC runtime source: https://openplcproject.gitlab.io/openplc_v3/iec__std__functions_8h_source.html
  - MatIEC-derived standard functions; useful for comparing `ANY_NUM` overload resolution.

These pages agree that promotion is to a larger type within the same category, but they disagree on exact width selection and overflow behavior. C2/C3/C4 should remain `@oracle: assumed` until a CODESYS runtime measurement is available.

## Recommended next step for a real runtime oracle

1. Obtain a CODESYS runtime image or Windows VM with CODESYS Control Win V3.
2. Compile small POUs that exercise C5, C17, C21, C1–C4 and log `__VARINFO` / `SIZEOF` / `ROUND` results.
3. Compare the output against STruCpp snapshots; when they agree, promote the claim to Tier A with the runtime as the oracle.
4. When they disagree, decide whether to match CODESYS on the host or to document host-specific behavior.

## Notes

- Two CODESYS help pages for `VAR_INFO` give conflicting field types (`LibDevSummary/var_info.html` vs `_cds_operator_varinfo.html`). The `LibDevSummary` page is the structured type definition and is treated as authoritative for STruCpp's `iec_varinfo.hpp`.
- Vendor documentation (Beckhoff / ABB / Schneider / PLCnext) should be consulted as a cross-check; unanimous agreement raises confidence, disagreement indicates the behavior is vendor-specific.
