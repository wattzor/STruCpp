---
name: STruCpp Test Matrix
description: End-to-end testing workflow for STruCpp (ST-to-C++ compiler) and the downstream Struc-ToolTest1 toolchain.
---

# STruCpp Test Matrix

## What this covers
- Local build, type-check, and lint.
- Vitest unit/integration suites.
- CLI constant-literal / narrowing smoke tests.
- Downstream `Struc-ToolTest1` (codesys-fbs-test) integration.

## Repository layout
- STruCpp source: `/home/ubuntu/STruCpp-fork`
- Downstream toolchain: `/home/ubuntu/Struc-ToolTest1`

## Prerequisites
- Node.js (package claims `>=22`, but the current environment runs successfully on Node 20; prefer Node 22 for safety).
- `g++` with C++17 support.
- `npm`/`npx` available.

## Build / refresh

Because `dist/` is used by the CLI and by downstream tools, rebuild it from `src/` before running CLI tests:

```bash
cd /home/ubuntu/STruCpp-fork
npm run build:tsc-only
```

`npm test` runs `scripts/rebuild-libs.mjs` as a Vitest global setup, which also recompiles TypeScript and rebuilds `.stlib` archives, so a manual rebuild is not strictly required before `npm test`.

## Core commands

```bash
npm run typecheck
npx eslint src/ --quiet
npx vitest run tests/integration/constant-narrowing.test.ts
npm test
```

## CLI smoke test pattern

Create small `.st` files of the form:

```iecst
PROGRAM Main
VAR
  x : <TYPE> := <LITERAL>;
END_VAR
END_PROGRAM
```

Then run:

```bash
node dist/node/cli.js file.st -o file.cpp --no-line-mapping
```

For successful compiles, validate the generated C++:

```bash
g++ -std=c++17 -I /home/ubuntu/STruCpp-fork/src/runtime/include -c file.cpp -o file.o
```

Expected results for the current PR matrix:

| Declaration | Result |
|-------------|--------|
| `x : INT := 32768;` | Error: `out of range for INT` |
| `x : BYTE := 300;` | Error: `out of range for BYTE` |
| `x : REAL := 1e40;` | Error: `overflows REAL` |
| `x : INT := 1.5;` | Warning: `Narrowing conversion from REAL to INT`, then `g++ -c` succeeds |
| `x : DINT := 300;` | OK, `g++ -c` succeeds |
| `x : BYTE := 16#FF;` | OK, `g++ -c` succeeds |
| `x : INT := 1.0;` | OK, `g++ -c` succeeds |
| `x : LREAL := 1e40;` | OK, `g++ -c` succeeds |

## Downstream Struc-ToolTest1

Point the downstream toolchain at the freshly built STruCpp CLI:

```bash
cd /home/ubuntu/Struc-ToolTest1
STRUCPP_PATH=/home/ubuntu/STruCpp-fork/dist/node/cli.js npm test
```

`resolveStruCpp` in `Struc-ToolTest1/src/utils.ts` checks this env var before `strucpp` on `PATH` or `node_modules/.bin/strucpp`.

On slower runners the downstream g++-heavy tests can exceed Vitest's default 5 s timeout; rerun with `--testTimeout 30000` if tests time out:

```bash
STRUCPP_PATH=/home/ubuntu/STruCpp-fork/dist/node/cli.js npm test -- --testTimeout 30000
```

## Common gotchas
- The CLI expects a complete `PROGRAM ... VAR ... END_VAR END_PROGRAM` body; bare `x : INT := 32768;` will not parse.
- `npm run build` (the default build script) rebuilds bundled `.stlib` libraries and is much slower than `npm run build:tsc-only`; use the latter when you only need to refresh `dist/`.
- Downstream tests compile generated C++ with `g++` and may fail if `STRUCPP_PATH` points to a stale `dist/node/cli.js`.
- `dist/` can retain artifacts from the previous branch. If a manual CLI build emits unexpected `NaN` values or fails to reflect the current `src/`, run `npm run build:tsc-only` (or let `npm test` global setup refresh `dist/`).

## Located-variable / OpenPLC I/O smoke test pattern

Create an ST file with both `VAR_GLOBAL` and `PROGRAM` located variables, for example:

```iecst
VAR_GLOBAL
  gIn  AT %IW10 : WORD;
  gOut AT %QW20 : WORD;
END_VAR

PROGRAM Main
VAR
  bIn  AT %IB1 : BYTE;
  bOut AT %QB2 : BYTE;
  bitIn  AT %IX0.3 : BOOL;
  bitOut AT %QX1.2 : BOOL;
END_VAR
  bOut := bIn;
  bitOut := bitIn;
  gOut := gIn;
END_PROGRAM
```

Compile and build a driver:

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js io.st -o io.cpp
cat > main.cpp <<'EOF'
#include "io.hpp"
#include <iostream>
int main() {
    using namespace strucpp;
    __init_global_located_pointers();
    Program_MAIN p;
    p.bind_located_vars();
    __located_vars = locatedVars;
    __located_vars_count = locatedVarsCount;

    __input_image().resize(32, 0);
    __input_image()[1] = 0xAB;                 // %IB1
    __input_image()[0] = 0x08;                 // %IX0.3
    __input_image()[10] = 0xEF;                // %IW10 low byte
    __input_image()[11] = 0xCD;                // %IW10 high byte

    __sync_located_in();
    p.run();
    __sync_located_out();

    bool ok = __output_image()[2] == 0xAB
           && (__output_image()[1] & (1u << 2))
           && __output_image()[20] == 0xEF
           && __output_image()[21] == 0xCD;
    std::cout << (ok ? "OK" : "FAIL") << std::endl;
    return ok ? 0 : 1;
}
EOF
g++ -std=c++17 -I /home/ubuntu/STruCpp-fork/src/runtime/include -I . main.cpp io.cpp -o io
./io
```

Placeholder addresses (`%I*`, `%QW*`, `%MD*`) should compile and produce a `locatedVars[]` descriptor with `byte_index=0` and `bit_index=0`.

## Generic FUNCTION smoke test pattern (CODESYS-compliant)

User-defined `FUNCTION`s with `ANY` / `ANY_*` parameter groups are lowered to C++ functions taking `strucpp::AnyType` descriptors. The descriptor exposes `.TYPECLASS`, `.DISIZE`, and `.PVALUE` and is constructed at the call site via `strucpp::make_any_type<TYPECLASS>(var)`. Generic parameters may only be passed to `ADR`, `SIZEOF`, and `XSIZEOF`; other standard-function calls with generic values are rejected. The function return type must be concrete.

Create an ST file with an `ANY` generic `FUNCTION` and a `PROGRAM` that calls it with variables:

```iecst
FUNCTION SameType : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR
VAR
  iCount : DINT;
END_VAR

IF any1.typeclass <> any2.typeclass THEN
  RETURN;
END_IF
IF any1.diSize <> any2.diSize THEN
  RETURN;
END_IF
FOR iCount := 0 TO any1.diSize - 1 DO
  IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
    RETURN;
  END_IF
END_FOR
SameType := TRUE;
RETURN;
END_FUNCTION

PROGRAM Main
VAR
  w1 : WORD := 16#00FF;
  w2 : WORD := 16#00FF;
  same : BOOL;
END_VAR
  same := SameType(w1, w2);
END_PROGRAM
```

Compile and build:

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js same_type.st -o same_type.cpp
cat > main.cpp <<'EOF'
#include "same_type.hpp"
#include <iostream>
int main() {
    strucpp::Program_MAIN p;
    p.run();
    std::cout << (p.SAME.get() ? "SAME_TRUE" : "SAME_FALSE") << std::endl;
    return 0;
}
EOF
g++ -std=c++17 -I /home/ubuntu/STruCpp-fork/src/runtime/include -I . main.cpp same_type.cpp -o same_type
./same_type
```

A working implementation prints `SAME_TRUE`.

Use `--build` for a quick executable smoke test:

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js same_type.st -o same_type.cpp --build
# produces ./same_type
```

## Generic FUNCTION caveats

- Allowed generic parameter types: `ANY`, `ANY_BIT`, `ANY_DATE`, `ANY_NUM`, `ANY_REAL`, `ANY_INT`, `ANY_STRING`.
- Rejected parameter types: `ANY_ELEMENTARY`, `ANY_MAGNITUDE`, `ANY_DERIVED`.
- Generic `VAR_INPUT` only accepts variables; literals and expressions are rejected.
- `FUNCTION` return types may not be `ANY` / `ANY_*`.
- The CLI loads bundled `.stlib` libraries by default. `iec-std-functions.stlib` currently defines `LIMIT` and similar functions with `ANY_ELEMENTARY` parameters, which can cause the CLI to accept code that the test API (no default libs) rejects. For adversarial generic-forwarding tests, use `--no-default-libs` so the bundled standard-function manifest does not mask the new analyzer errors.

Example adversarial `LIMIT` forwarding test:

```iecst
FUNCTION MaxAny : INT
VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
  MaxAny := LIMIT(mn, val, mx);
END_FUNCTION
PROGRAM Main END_PROGRAM
```

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js bad_limit.st -o bad_limit.cpp --no-default-libs
# should fail with: Cannot pass a value of generic type 'ANY_NUM' to standard function 'LIMIT' ...
```

## Named-argument generic FUNCTION smoke test pattern

Named arguments to user-defined generic `FUNCTION`s are reordered to declaration order and then wrapped with `make_any_type<TYPECLASS>(var)`, exactly like positional arguments. The call `SameType(any2 := w2, any1 := w1)` should generate the same C++ call order as `SameType(w1, w2)`.

```iecst
FUNCTION SameType : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR
VAR
  iCount : DINT;
END_VAR

IF any1.typeclass <> any2.typeclass THEN
  RETURN;
END_IF
IF any1.diSize <> any2.diSize THEN
  RETURN;
END_IF
FOR iCount := 0 TO any1.diSize - 1 DO
  IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
    RETURN;
  END_IF
END_FOR
SameType := TRUE;
RETURN;
END_FUNCTION

PROGRAM Main
VAR
  w1 : WORD := 16#00FF;
  w2 : WORD := 16#00FF;
  same : BOOL;
END_VAR
  same := SameType(any2 := w2, any1 := w1);
END_PROGRAM
```

After compiling, the generated C++ call site should look like:

```cpp
SAME = SAMETYPE(strucpp::make_any_type<strucpp::__SYSTEM::TYPE_CLASS::TYPE_WORD>(W1), strucpp::make_any_type<strucpp::__SYSTEM::TYPE_CLASS::TYPE_WORD>(W2));
```

Build and run the binary as above; it should print `SAME_TRUE`.

A non-generic named-argument regression example:

```iecst
FUNCTION Sum : INT
VAR_INPUT a, b : INT; END_VAR
  Sum := a + b;
END_FUNCTION

PROGRAM Main
VAR
  x : INT := 7;
  y : INT := 5;
  z : INT;
END_VAR
  z := Sum(b := y, a := x);
END_PROGRAM
```

This should compile and the generated call `SUM(Y, X)` should produce output `Z=12`.

## CODESYS `__XINT` / `__UXINT` target-width smoke test pattern

`__XINT` and `__UXINT` are target-width signed/unsigned integers; their C++
aliases (`IEC_XINT`, `IEC_UXINT`) resolve to 32-bit or 64-bit types based on the
`STRUCPP_TARGET_WIDTH` macro. The CLI `--target-width 32|64` passes the macro to
the g++ build.

A strong adversarial test that distinguishes a working target-width
implementation from a hard-coded 32/64-bit implementation:

```iecst
PROGRAM Main
VAR
  x : __XINT := 0;
  u : __UXINT := 0;
  lv : LINT;
  ulv : ULINT;
END_VAR
  x := x + LINT#4294967296 + DINT#1;
  u := u + ULINT#4294967296 + UDINT#1;
  lv := x;
  ulv := u;
END_PROGRAM
```

Compile once and then build twice with different target widths:

```bash
node dist/node/cli.js xint_target.st -o xint_target.cpp
cat > main_xint_target.cpp <<'EOF'
#include "xint_target.hpp"
#include <iostream>
int main() {
    strucpp::Program_MAIN p;
    p.run();
    std::cout << "X=" << static_cast<long long>(p.X.get())
              << " U=" << static_cast<unsigned long long>(p.U.get())
              << " LV=" << static_cast<long long>(p.LV.get())
              << " ULV=" << static_cast<unsigned long long>(p.ULV.get())
              << std::endl;
    return 0;
}
EOF
g++ -std=c++17 -DSTRUCPP_TARGET_WIDTH=32 -I src/runtime/include -I . \
    main_xint_target.cpp xint_target.cpp -o xint32 && ./xint32
g++ -std=c++17 -DSTRUCPP_TARGET_WIDTH=64 -I src/runtime/include -I . \
    main_xint_target.cpp xint_target.cpp -o xint64 && ./xint64
```

Expected:
- 32-bit: `X=1 U=1 LV=1 ULV=1`
- 64-bit: `X=4294967297 U=4294967297 LV=4294967297 ULV=4294967297`

For a `__XINT` returning user-defined function, build a REPL binary and run
`run` before `get`:

```iecst
FUNCTION AddX : __XINT
VAR_INPUT a : DINT; b : DINT; END_VAR
  AddX := a + b;
END_FUNCTION

PROGRAM Main
VAR
  r : __XINT;
  x : __XINT := 100;
  u : __UXINT := 200;
END_VAR
  r := AddX(a := 10, b := 20);
END_PROGRAM
```

```bash
node dist/node/cli.js xint_func.st -o xint_func.cpp --build --target-width 64
printf 'run\nget MAIN.R\nget MAIN.X\nget MAIN.U\nquit\n' | ./xint_func
```

Expected REPL output:
- `MAIN.R : __XINT = 30`
- `MAIN.X : __XINT = 100`
- `MAIN.U : __UXINT = 200`

### Caveats
- The REPL `var_set_value` switch does not currently handle `VarTypeTag::XINT`
  or `VarTypeTag::UXINT`, so `force` on `__XINT`/`__UXINT` variables reports an
  invalid value. Use `get` (after a `run` for computed values) or set initial
  values in `VAR` blocks.

## REFERENCE TO STRING / WSTRING / BYTE / INT function parameters

`REFERENCE TO STRING` and `REFERENCE TO WSTRING` parameters accept any sized
string variable (`STRING(80)`, `STRING(254)`, etc.) via `IEC_STRING_REFERENCE`
and `IEC_WSTRING_REFERENCE`. `REFERENCE TO BYTE`/`INT`/etc. are emitted as
`IEC_REFERENCE_TO<...>` and the call site wraps the argument explicitly.

Adversarial smoke test (compile and run a binary):

```iecst
FUNCTION ModifyRefs : INT
VAR_INPUT
  s : REFERENCE TO STRING;
  w : REFERENCE TO WSTRING;
  b : REFERENCE TO BYTE;
  n : REFERENCE TO INT;
END_VAR
  s := 'modified';
  w := WSTRING#"modified";
  b := 16#AB;
  n := n + 5;
  ModifyRefs := 0;
END_FUNCTION

PROGRAM Main
VAR
  s : STRING(80) := 'before';
  w : WSTRING(80) := WSTRING#"before";
  b : BYTE := 0;
  n : INT := 10;
END_VAR
  ModifyRefs(s, w, b, n);
END_PROGRAM
```

```bash
node dist/node/cli.js ref_probe.st -o ref_probe.cpp
cat > main.cpp <<'EOF'
#include "ref_probe.hpp"
#include <iostream>
#include <cstring>
int main() {
    strucpp::Program_MAIN p;
    p.run();
    std::cout << "B=" << static_cast<int>(p.B.get())
              << " N=" << p.N.get()
              << " S=" << p.S.get().c_str()
              << " Wlen=" << p.W.get().length()
              << " W0=" << static_cast<int>(p.W[0])
              << std::endl;
    return (p.B.get() == 0xAB && p.N.get() == 15
         && std::strcmp(p.S.get().c_str(), "modified") == 0
         && p.W.get().length() == 8
         && p.W[0] == char16_t('m')) ? 0 : 1;
}
EOF
g++ -std=c++17 -I /home/ubuntu/STruCpp-fork/src/runtime/include -I . \
    main.cpp ref_probe.cpp -o ref_probe
./ref_probe
```

Expected output: `B=171 N=15 S=modified Wlen=8 W0=109` and exit code `0`.

This proves the callee wrote back through each reference.

## CODESYS `UNION` smoke test pattern

`UNION` types overlay members in a single C++ `union`; they are useful for type-punning numeric/struct overlays such as a `UDINT` viewed as bytes or words.

### Manual CLI `--build` REPL verification

Use `tests/st-validation/data_types/union.st` (INADDR-style overlay):

```iecst
TYPE
  UDINT_IN_BYTES : STRUCT
    b1,b2,b3,b4 : BYTE;
  END_STRUCT;

  UDINT_IN_WORDS : STRUCT
    w1,w2 : WORD;
  END_STRUCT;

  INADDR : UNION
    ulAddr : UDINT;
    S_un_b : UDINT_IN_BYTES;
    S_un_w : UDINT_IN_WORDS;
  END_UNION;
END_TYPE

PROGRAM UnionTest
VAR
  addr : INADDR;
  b1,b2,b3,b4 : BYTE;
  w1,w2 : WORD;
  u : UDINT;
END_VAR
  addr.ulAddr := UDINT#16#01020304;
  b1 := addr.S_un_b.b1;
  b2 := addr.S_un_b.b2;
  b3 := addr.S_un_b.b3;
  b4 := addr.S_un_b.b4;
  w1 := addr.S_un_w.w1;
  w2 := addr.S_un_w.w2;
  u := addr.ulAddr;
END_PROGRAM
```

Compile with `--build`, then drive the REPL:

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js union.st -o union.cpp --build
printf 'run 1\nvars UNIONTEST\nquit\n' | ./union
```

Expected on a little-endian host:
- `UNIONTEST.ADDR : OTHER = <FB: INADDR>`
- `UNIONTEST.B1 : BYTE = 16#04`
- `UNIONTEST.B2 : BYTE = 16#03`
- `UNIONTEST.B3 : BYTE = 16#02`
- `UNIONTEST.B4 : BYTE = 16#01`
- `UNIONTEST.W1 : WORD = 16#0304`
- `UNIONTEST.W2 : WORD = 16#0102`
- `UNIONTEST.U : UDINT = 16909060` (=`16#01020304` decimal)

### Adversarial analyzer checks

Compile each with `--no-default-libs`; all should fail with a `UNION` diagnostic:

- `STRING` member → `cannot contain STRING/WSTRING`
- `ARRAY[...] OF ...` member → `cannot contain an array`
- `POINTER TO ...` / `REFERENCE TO ...` / `REF_TO ...` member → `cannot contain a pointer/reference`
- per-member initializer (`n : INT := 42`) → `cannot have an initializer`

A named-struct overlay (`UNION` containing a named `STRUCT` member) should compile and `g++ -std=c++17 -I src/runtime/include -c overlay.cpp` should succeed.

### `ASSERT_EQ` on unions and structs containing unions

PR #94 and later generate `operator==`/`operator!=` and a `friend std::ostream& operator<<` (guarded by `#ifdef STRUCPP_TEST`) for every non-empty `union`. The equality operator flattens inline anonymous struct members and compares all leaf fields; the stream operator emits all leaf fields.

A strong regression test is to use `ASSERT_EQ` on a `STRUCT` variable that contains a `UNION` member:

```iecst
TYPE
  MyUnion : UNION
    n : UDINT;
    w : WORD;
  END_UNION;

  SWithU : STRUCT
    u : MyUnion;
    x : INT;
  END_STRUCT;
END_TYPE

PROGRAM StructWithUnionTest
  VAR
    s : SWithU;
  END_VAR
  s.u.n := UDINT#16#DEADBEEF;
  s.x := 123;
END_PROGRAM
```

```iecst
TEST 'Struct containing a union equality'
  VAR uut : StructWithUnionTest; END_VAR
  uut();
  ASSERT_EQ(uut.s, uut.s);
  ASSERT_EQ(uut.s.u.n, UDINT#16#DEADBEEF);
  ASSERT_EQ(uut.s.x, 123);
END_TEST
```

This proves that:
- `operator==` is generated for the `UNION`.
- `operator==` is generated for the `STRUCT` and calls the union's `operator==`.
- `operator<<` is generated for both and compiles under `STRUCPP_TEST` (used for assertion failure messages).

## CODESYS `STRUCT` / array initializer and `iec_struct_init` smoke test pattern

CODESYS `STRUCT` initializers use `(field := value, ...)` syntax. Array literals/repetitions use `[N(value), ...]`. STruCpp lowers these to `strucpp::iec_struct_init<T>([](auto& v0) { ... })` calls.

A strong end-to-end smoke test covers:
- a struct type with field defaults,
- a program variable initialized with a struct initializer (out-of-order/omitted elements),
- a nested struct/array-of-struct type default,
- 1D/2D/3D array literals and repetition,
- an FB instance stored in an array element,
- exact integer, typed, and hexadecimal literal lowering.

```iecst
TYPE Point : STRUCT x : REAL := 1.0; y : REAL := 2.0; END_STRUCT; END_TYPE
TYPE Inner : STRUCT v : INT := 7; END_STRUCT; END_TYPE
TYPE Outer : STRUCT
  inner : Inner := (v := 42);
  inners : ARRAY[0..1] OF Inner := [2((v := 9))];
END_STRUCT; END_TYPE

TYPE
  UDINT_IN_BYTES : STRUCT b1,b2,b3,b4 : BYTE; END_STRUCT;
  UDINT_IN_WORDS : STRUCT w1,w2 : WORD; END_STRUCT;
  INADDR : UNION
    ulAddr : UDINT;
    S_un_b : UDINT_IN_BYTES;
    S_un_w : UDINT_IN_WORDS;
  END_UNION;
END_TYPE

FUNCTION_BLOCK Counter
VAR_INPUT step : REAL; END_VAR
VAR_OUTPUT out : REAL; END_VAR
  out := step;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  p : Point := (y := 5.0, x := 4.0);
  o : Outer;
  arr1d : ARRAY[0..4] OF INT := [3(1), 2(5)];
  arr3d : ARRAY[1..2,0..1,0..1] OF INT := [[[1,2],[3,4]],[[5,6],[7,8]]];
  arr2dInner : ARRAY[0..1,0..1] OF Inner := [[(v := 10),(v := 20)],[(v := 30),(v := 40)]];
  units : ARRAY[0..1] OF Counter;
  u : INADDR;
  big : ULINT := 18446744073709551615;
  hex : UDINT := 16#DEAD_BEEF;
  r : REAL := 1.5E3;
  result1, result2, result3 : REAL;
  iResult1, iResult2, iResult3, iResult4, iResult5 : INT;
  bResult1, bResult2, bResult3, bResult4 : BYTE;
  wResult1, wResult2 : WORD;
  uResult : UDINT;
END_VAR
  result1 := p.x;
  result2 := p.y;
  units[0](step := 2.0);
  result3 := units[0].out;
  iResult1 := o.inner.v;
  iResult2 := o.inners[0].v;
  iResult3 := arr2dInner[0,0].v;
  iResult4 := arr2dInner[1,1].v;
  iResult5 := arr3d[2,1,0];
  u.ulAddr := UDINT#16#01020304;
  bResult1 := u.S_un_b.b1;
  bResult2 := u.S_un_b.b2;
  bResult3 := u.S_un_b.b3;
  bResult4 := u.S_un_b.b4;
  wResult1 := u.S_un_w.w1;
  wResult2 := u.S_un_w.w2;
  uResult := u.ulAddr;
END_PROGRAM
```

Compile and run a driver:

```bash
node /home/ubuntu/STruCpp-fork/dist/node/cli.js init_test.st -o init_test.cpp --no-line-mapping
g++ -std=c++17 -I /home/ubuntu/STruCpp-fork/src/runtime/include -I . \
    main_init_test.cpp init_test.cpp -o init_test_run
./init_test_run
```

Expected generated C++ in `init_test.cpp`:
- Constructor contains `P(strucpp::iec_struct_init<POINT>([](auto& v0) { v0.Y = 5.0; v0.X = 4.0; }))`.
- `ARR1D({1, 1, 1, 5, 5})` and a nested 3D brace list for `ARR3D`.
- `ARR2DINNER` constructor contains `iec_struct_init` for each element.
- `BIG(18446744073709551615ULL)`, `HEX(0xDEADBEEF)`, `R(1.5E3)`.
- `run()` body contains `UNITS.at(0).STEP = 2.0;` then `UNITS.at(0)();` and `RESULT3 = UNITS.at(0).OUT;`.

Expected runtime stdout:
```
P.x=4 P.y=5
O.inner.v=42 O.inners[0].v=9
Arr2dInner[0,0].v=10 Arr2dInner[1,1].v=40
Arr3d[2,1,0]=7 Unit[0].out=2
Addr bytes: 4 3 2 1
Addr words: 772 258
Addr UDINT=16909060
Big=18446744073709551615 Hex=3735928559 R=1500
```

### Caveats
- Stage 1 builds may generate `iec_struct_init` calls without `#include "iec_struct.hpp"` and may emit `UNITS(10);` for `units[0](...)` instead of the indexed call. The full upstream #205/Stage 2 wiring adds the include and emits `UNITS.at(0) ...` correctly.

## Devin Secrets Needed
None.
