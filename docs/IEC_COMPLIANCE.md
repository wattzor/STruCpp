# IEC 61131-3 Compliance

STruC++ implements the Structured Text (ST) language from IEC 61131-3. This document lists supported features and known gaps. The compiler also supports common CODESYS extensions where noted.

## Data Types

| Type | Status | Notes |
|------|--------|-------|
| BOOL | Supported | |
| BYTE, WORD, DWORD, LWORD | Supported | |
| SINT, INT, DINT, LINT | Supported | |
| USINT, UINT, UDINT, ULINT | Supported | |
| REAL, LREAL | Supported | |
| TIME | Supported | Nanosecond precision, int64_t storage |
| DATE | Supported | |
| TIME_OF_DAY | Supported | |
| DATE_AND_TIME | Supported | |
| LTIME, LDATE, LTOD, LDT | Supported | 64-bit time types with nanosecond precision |
| STRING | Supported | Parameterized length: STRING(N), default 254 |
| WSTRING | Supported | Parameterized length: WSTRING(N) |
| CHAR, WCHAR | Supported | |

### Derived Types

| Type | Status | Notes |
|------|--------|-------|
| TYPE ... END_TYPE | Supported | Type aliases |
| STRUCT ... END_STRUCT | Supported | With nested structs |
| Enumerations | Supported | With optional base type |
| ARRAY (1D) | Supported | Arbitrary bounds: ARRAY[1..10] OF INT |
| ARRAY (2D) | Supported | ARRAY[1..3, 1..4] OF REAL |
| ARRAY (3D) | Supported | ARRAY[1..3, 1..4, 1..5] OF INT |
| ARRAY[*] (VLA) | Supported | Variable-length array parameters |
| Subranges | Supported | Runtime validation |
| REF_TO | Supported | IEC reference type (explicit dereference) |
| REFERENCE_TO | Supported | CODESYS reference type (implicit dereference) |
| POINTER TO | Supported | CODESYS pointer type with dereference via ^ |

### Not Implemented

| Type | Notes |
|------|-------|
| UNION | CODESYS extension |

### Generic Types

| Type | Status | Notes |
|------|--------|-------|
| `ANY` | Partial | Allowed only in `VAR_INPUT` parameters; passed as `AnyType` descriptor |
| `ANY_BIT` | Partial | Allowed only in `VAR_INPUT` parameters |
| `ANY_DATE` | Partial | Allowed only in `VAR_INPUT` parameters |
| `ANY_NUM` | Partial | Allowed only in `VAR_INPUT` parameters |
| `ANY_REAL` | Partial | Allowed only in `VAR_INPUT` parameters |
| `ANY_INT` | Partial | Allowed only in `VAR_INPUT` parameters |
| `ANY_STRING` | Partial | Allowed only in `VAR_INPUT` parameters |

## Program Organization Units

| POU | Status | Notes |
|-----|--------|-------|
| PROGRAM | Supported | With CONFIGURATION/RESOURCE/TASK structure |
| FUNCTION | Supported | With return type, all parameter modes |
| FUNCTION_BLOCK | Supported | Instantiation, invocation, member access |
| INTERFACE | Supported | Method and property signatures |

## Variable Declarations

| Feature | Status | Notes |
|---------|--------|-------|
| VAR | Supported | Local variables |
| VAR_INPUT | Supported | Input parameters |
| VAR_OUTPUT | Supported | Output parameters |
| VAR_IN_OUT | Supported | Pass-by-reference parameters |
| VAR_EXTERNAL | Supported | External references to VAR_GLOBAL |
| VAR_GLOBAL | Supported | Global variables |
| CONSTANT | Supported | Compile-time constants |
| RETAIN | Supported | Tracked in retain variable table |
| NON_RETAIN | Supported | |
| AT %IX0.0 | Supported | Located variables (I/Q/M areas, X/B/W/D/L sizes) |
| Multiple names | Supported | `a, b, c : INT := 0;` |
| Initialization | Supported | `:= expression` |

## Operators and Expressions

| Category | Operators | Status |
|----------|-----------|--------|
| Arithmetic | `+`, `-`, `*`, `/`, `MOD`, `**` | Supported |
| Comparison | `=`, `<>`, `<`, `>`, `<=`, `>=` | Supported |
| Logical | `AND`, `OR`, `XOR`, `NOT` | Supported | Plain `AND`/`OR` evaluate both operands (no short-circuit), matching CODESYS V3 |
| Short-circuit logical | `AND_THEN`, `OR_ELSE` | Supported | Evaluate the right operand only when the left result does not determine the outcome |
| Bitwise | `AND`, `OR`, `XOR`, `NOT` (on bit types) | Supported |
| Bit shift | `SHL`, `SHR`, `ROL`, `ROR` | Supported |
| Assignment | `:=` | Supported |
| Reference assign | `REF=` | Supported |
| Dereference | `^`, `DREF()` | Supported |
| Reference | `REF()` | Supported |
| Parentheses | `( )` | Supported |
| Function call | `name(args)` | Supported (positional + named) |
| Method call | `obj.method(args)` | Supported |
| Array access | `arr[i]`, `arr[i, j]` | Supported |
| Field access | `struct.field` | Supported |
| Typed literals | `INT#5`, `DINT#42`, `REAL#3.14` | Supported |
| NEW | `__NEW(type)`, `__NEW(type, size)` | Supported |
| DELETE | `__DELETE(ptr)` | Supported |
| Variable info | `__VARINFO(var)` | Supported | Returns `__SYSTEM.VAR_INFO` descriptor populated at compile time |

## Control Structures

| Structure | Status | Notes |
|-----------|--------|-------|
| IF / ELSIF / ELSE / END_IF | Supported | |
| FOR / TO / BY / DO / END_FOR | Supported | With optional BY (step) |
| WHILE / DO / END_WHILE | Supported | |
| REPEAT / UNTIL / END_REPEAT | Supported | |
| CASE / OF / END_CASE | Supported | Integer, bit, and enum selectors |
| EXIT | Supported | Break from loop |
| RETURN | Supported | Early return from POU |

## OOP Extensions

| Feature | Status | Notes |
|---------|--------|-------|
| Methods | Supported | On FUNCTION_BLOCK, with return types |
| Properties (GET/SET) | Supported | Virtual getter/setter methods in C++ |
| Inheritance (EXTENDS) | Supported | Single inheritance |
| Interfaces (IMPLEMENTS) | Supported | Multiple interfaces, generates C++ abstract classes |
| ABSTRACT | Supported | Abstract FB (no instantiation) and abstract methods (pure virtual) |
| FINAL | Supported | Sealed FB and methods |
| OVERRIDE | Supported | Method override with C++ override specifier |
| PUBLIC/PRIVATE/PROTECTED | Supported | Access modifiers |
| THIS | Supported | Self-reference in methods |

## Standard Functions

All IEC 61131-3 standard functions are implemented in the C++ runtime:

| Category | Functions |
|----------|-----------|
| Numeric | ABS, SQRT, LN, LOG, EXP, EXPT, TRUNC, ROUND |
| Numeric notes | `TRUNC` and `ROUND` convert `ANY_REAL` to `DINT` (CODESYS V3). `ROUND` uses half-away-from-zero ties. |
| Trigonometric | SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2 |
| Selection | SEL, MIN, MAX, LIMIT, MUX |
| Comparison | GT, GE, EQ, LE, LT, NE |
| Bitwise | AND, OR, XOR, NOT, MOVE |
| Bit Shift | SHL, SHR, ROL, ROR |
| Type Conversion | *_TO_* (INT_TO_REAL, DINT_TO_STRING, etc.) |
| String | LEN, LEFT, RIGHT, MID, CONCAT, FIND, REPLACE, INSERT, DELETE, UPPER, LOWER, TRIM |
| System | ADR, SIZEOF |

## Standard Function Blocks

Bundled as a compiled `.stlib` library (`libs/iec-standard-fb.stlib`):

| FB | Description |
|----|-------------|
| TON | On-delay timer |
| TOF | Off-delay timer |
| TP | Pulse timer |
| CTU | Count-up counter |
| CTD | Count-down counter |
| CTUD | Up/down counter |
| R_TRIG | Rising edge detector |
| F_TRIG | Falling edge detector |
| SR | Set-dominant bistable |
| RS | Reset-dominant bistable |

## Project Structure

| Feature | Status | Notes |
|---------|--------|-------|
| CONFIGURATION | Supported | |
| RESOURCE ... ON | Supported | |
| TASK ... WITH INTERVAL | Supported | |
| Program instances | Supported | `name : programType` with task assignment |
| VAR_GLOBAL in configuration | Supported | |
| Namespace configuration | Supported | Via pragmas |

## Language Extensions

| Feature | Status | Notes |
|---------|--------|-------|
| Nested comments `(* (* *) *)` | Supported | Arbitrary nesting depth |
| Pragmas `{...}` | Supported | Including `{external}` for inline C++ |
| Inline C++ | Supported | Via `{external ...}` pragma blocks |
| Inline function calls | Supported | Via `{call ...}` pragma |
| Global constants (`-D`) | Supported | CLI `-D NAME=VALUE`, emits `constexpr` |
| Dynamic memory | Supported | `__NEW(type)`, `__DELETE(ptr)` |
| POINTER TO | Supported | Full pointer type with dereference |
| CODESYS `__SYSTEM` namespace | Supported | `__SYSTEM.TYPE_CLASS`, `__SYSTEM.MEMORY_AREA`, `__SYSTEM.VAR_INFO` |
| Typed literals | Supported | `INT#5`, `DINT#42`, `REAL#3.14` |
| FB_Init / FB_Exit | Supported | Called automatically from constructor/destructor |
| FB_Reinit | Supported | Explicit calls; automatic online-change copy not modeled |
| __QUERYINTERFACE | Supported | Runtime interface query |
| Bit access (var.%X0) | Supported | Read/write on BYTE/WORD/DWORD/LWORD |

## Known Deviations from CODESYS Runtime Behaviour

| ID | Feature | CODESYS Behaviour | STruC++ Behaviour |
|----|---------|-------------------|-------------------|
| D1 | `__VARINFO` address fields | `ByteAddress`, `ByteOffset`, `Area`, `BitAddress`, and `MemoryArea` reflect the real PLC memory layout | Fields are populated at compile time. `ByteAddress` is a stable synthetic descriptor id allocated per qualified symbol. `Area`, `ByteOffset`, and `BitAddress` are synthetic. `MemoryArea` is derived from the owning `VarBlock` and any `AT %I/%Q/%M` address (`MEM_LOCAL`, `MEM_GLOBAL`, `MEM_RETAIN`, `MEM_INPUT`, `MEM_OUTPUT`, or `MEM_MEMORY`) |
| D2 | `__SYSTEM` enum emission | Enums defined per project or in the runtime as CODESYS sees fit | `__SYSTEM.TYPE_CLASS` and `__SYSTEM.MEMORY_AREA` are emitted as fixed `enum class` definitions in the runtime header (`iec_system.hpp`) and wrapped with `IEC_ENUM_Var<>` |
| D3 | `ANY` / `ANY_*` generic parameters | CODESYS accepts `ANY`, `ANY_BIT`, `ANY_INT`, `ANY_REAL`, `ANY_NUM`, `ANY_DATE`, `ANY_STRING` only in `VAR_INPUT`; any variable expression may be passed and is exposed as an `AnyType` descriptor | STruCpp passes a `strucpp::AnyType` descriptor with `typeclass`, `pvalue`, `diSize`; generic parameters are rejected outside `VAR_INPUT`. `pvalue` points to the C++ object for the argument, so byte-level generic functions (e.g. `funGenericCompare`) work for elementary types but not yet for arrays/structs/strings whose in-memory layout is not byte-flat |
| D4 | `__VARINFO` field population | `__VARINFO` returns a live view of the variable, including any runtime changes to values or location | The returned `VAR_INFO` descriptor is a compile-time constant. String fields (`TypeName`, `Symbol`, `Comment`) are baked into the binary. Numeric fields (`BitSize`, `TypeClass`, `NumElements`, `ElemBitSize`, `BaseTypeClass`, `MemoryArea`, etc.) are derived from the declaration type. The descriptor is still not a live runtime view |
| D5 | Arithmetic temporary width | CODESYS computes integer temporaries with the native width of the target device (≥32-bit on x86/ARM, 64-bit on x64); truncation happens only on assignment or explicit `TO_*` | STruC++ uses the `STRUCPP_TARGET_WIDTH` macro (default 32 on the CLI, host pointer size in the raw headers) to set the native width. The CLI `--target-width 32|64` flag controls this for `--build` and `--test` binaries; users compiling generated `.cpp` manually must pass `-DSTRUCPP_TARGET_WIDTH=<32|64>` to match the PLC target |

## Not Yet Implemented

| Feature | Notes |
|---------|-------|
| UNION | CODESYS union type |

| ACTION blocks | Named action blocks |
| TRY/CATCH/FINALLY | Exception handling |
| Conditional compilation | Preprocessor-style conditionals |
