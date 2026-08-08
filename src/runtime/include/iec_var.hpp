// SPDX-License-Identifier: GPL-3.0-or-later WITH STruCpp-runtime-exception
// Copyright (C) 2025 Autonomy / OpenPLC Project
// This file is part of the STruC++ Runtime Library and is covered by the
// STruC++ Runtime Library Exception. See COPYING.RUNTIME for details.
//
// ============================================================================
// WARNING: KEEP THIS HEADER C++14-CLEAN.
// ----------------------------------------------------------------------------
// strucpp targets C++17 and its EMITTED code is compiled as C++17 — but this
// header is part of the C/C++ Function Block include chain, which is NOT.
// OpenPLC Editor's Arduino flow emits `c_blocks_code.cpp`, including
// `iec_var.hpp` + `iec_string.hpp` (which transitively pull in `iec_traits.hpp`
// and `iec_types.hpp`). That translation unit is compiled under whatever
// `-std=` the Arduino core picks, and every mbed-based core — Nano RP2040
// Connect, Nano 33 BLE, Opta, GIGA, Portenta, Edge — hard-codes `-std=gnu++14`.
// So any C++17/20 construct reachable from here breaks the user's C/C++ POU
// build, even though the rest of strucpp is happily on C++17.
//
// In this header (and anything it includes) do NOT use C++17/20 features
// unguarded. In particular:
//   * `std::trait_v<T>`               -> `std::trait<T>::value`
//   * `if constexpr`                  -> SFINAE / tag dispatch
//   * inline variables / `inline constexpr`
//   * `auto` non-type template params -> typed NTTPs
//   * C++17/20 library headers (<optional>, <variant>, <string_view>,
//     <concepts>, ...) -> include ONLY behind `#if __cplusplus >= ...`
//     (see the guarded <concepts> block in iec_types.hpp for the pattern).
//
// Boundary introduced in commit be85d8a. If you change which headers
// `c_blocks_code.cpp` pulls in, update this set of warnings accordingly.
// ============================================================================
/**
 * STruC++ Runtime - IEC Variable Wrapper
 *
 * This header defines the IECVar template class that wraps IEC types
 * with support for variable forcing (a key OpenPLC feature).
 *
 * Located variables (AT %IX0.0, etc.) use this same wrapper, and the
 * raw_ptr() method provides access to the underlying storage for
 * runtime binding to I/O image tables.
 */

#pragma once

#include "iec_types.hpp"
#include "iec_arith.hpp"
#include <type_traits>
#include <utility>

namespace strucpp {

// Forward declaration for pointer-to-integer assignment
template<typename T> class IEC_Ptr;

// =============================================================================
// IEC Variable Wrapper
// =============================================================================

/**
 * Template wrapper for IEC variables with forcing support.
 *
 * This class wraps any IEC type and provides:
 * - Normal get/set operations
 * - Variable forcing (override value for debugging/testing)
 * - Implicit conversion for natural syntax
 * - Arithmetic operators for numeric types
 *
 * @tparam T The underlying C++ type (e.g., int16_t for INT)
 */
template<typename T>
class IECVar {
public:
    using value_type = T;

    // =========================================================================
    // Constructors
    // =========================================================================

    /** Default constructor - initializes to zero/false */
    IECVar() noexcept : value_{}, forced_{false}, forced_value_{} {}

    /** Construct with initial value (non-explicit to allow IEC_INT val = 10 syntax) */
    IECVar(T v) noexcept : value_{v}, forced_{false}, forced_value_{} {}

    /** Cross-type converting constructor: IECVar<SINT_t> → IECVar<INT_t> etc.
     *  Enables implicit widening when struct fields (now IECVar-wrapped) are passed
     *  to functions expecting a wider IECVar type. Without this, C++ would need
     *  two user-defined conversions (IECVar<U>→U→T→IECVar<T>) which is disallowed. */
    template<typename U, std::enable_if_t<
        std::is_convertible<U, T>::value && !std::is_same<U, T>::value, int> = 0>
    IECVar(const IECVar<U>& other) noexcept
        : value_{static_cast<T>(other.get())}, forced_{false}, forced_value_{} {}

    /** Copy constructor — fresh IECVar starts unforced regardless of source. */
    IECVar(const IECVar& other) noexcept
        : value_{other.get()}, forced_{false}, forced_value_{} {}

    /** Move constructor — same semantics as copy. */
    IECVar(IECVar&& other) noexcept
        : value_{other.get()}, forced_{false}, forced_value_{} {}

    /**
     * Copy assignment.
     *
     * Assigning FROM another IECVar must go through `set()` so forcing
     * state is preserved on the destination. A memberwise copy would
     * clobber `forced_` / `forced_value_`, silently unforcing variables
     * that the debugger is holding — precisely what generated PLC code
     * does every scan cycle with `BLINK := TOF0.Q`.
     */
    IECVar& operator=(const IECVar& other) noexcept {
        set(other.get());
        return *this;
    }

    /** Move assignment — same semantics as copy. */
    IECVar& operator=(IECVar&& other) noexcept {
        set(other.get());
        return *this;
    }

    // =========================================================================
    // Value Access
    // =========================================================================

    /**
     * Get the current value.
     * Returns the forced value if forcing is active, otherwise the normal value.
     */
    T get() const noexcept {
        return forced_ ? forced_value_ : value_;
    }

    /**
     * Set the value.
     * If forcing is active, the set is ignored to ensure drivers reading
     * the raw storage always see the forced value for output variables.
     */
    void set(T v) noexcept {
        if (!forced_) {
            value_ = v;
        }
    }

    /**
     * Get the underlying value (ignoring forcing).
     * Useful for debugging to see what the program would have set.
     */
    T get_underlying() const noexcept {
        return value_;
    }

    // =========================================================================
    // Forcing Support
    // =========================================================================

    /**
     * Force the variable to a specific value.
     * While forced, get() will return the forced value regardless of set() calls.
     * Also updates the raw storage so drivers reading via raw_ptr() see the forced value.
     */
    void force(T v) noexcept {
        forced_ = true;
        forced_value_ = v;
        value_ = v;  // Update raw value so external readers (plugins) see forced value
    }

    /**
     * Remove forcing and return to normal operation.
     */
    void unforce() noexcept {
        forced_ = false;
    }

    /**
     * Check if the variable is currently forced.
     */
    bool is_forced() const noexcept {
        return forced_;
    }

    /**
     * Get the forced value (only valid if is_forced() is true).
     */
    T get_forced_value() const noexcept {
        return forced_value_;
    }

    // =========================================================================
    // Raw Pointer Access (for Located Variables)
    // =========================================================================

    /**
     * Get a pointer to the underlying raw storage.
     * Used by the runtime to bind located variables to I/O image tables.
     * Plugins and drivers read/write through this pointer.
     *
     * For inputs: drivers write to this pointer, get() returns forced value when forced
     * For outputs: force() updates this storage, so drivers always read the forced value
     */
    T* raw_ptr() noexcept { return &value_; }

    /**
     * Get a const pointer to the underlying raw storage.
     */
    const T* raw_ptr() const noexcept { return &value_; }

    // =========================================================================
    // Implicit Conversions
    // =========================================================================

    /** Implicit conversion to underlying type for natural syntax */
    operator T() const noexcept {
        return get();
    }

    /** Assignment from raw value */
    IECVar& operator=(T v) noexcept {
        set(v);
        return *this;
    }

    /** Cross-type assignment: IECVar<SINT_t> → IECVar<INT_t> etc.
     *  Resolves ambiguity when assigning between different IECVar specializations
     *  by providing a direct match (template is preferred over two indirect paths
     *  that each require one user-defined conversion). */
    template<typename U, std::enable_if_t<
        std::is_convertible<U, T>::value && !std::is_same<U, T>::value, int> = 0>
    IECVar& operator=(const IECVar<U>& other) noexcept {
        set(static_cast<T>(other.get()));
        return *this;
    }

    /** Assignment from IEC_Ptr (CODESYS: DWORD_VAR := PT stores address as integer).
     *  WARNING: On 64-bit platforms, assigning to types narrower than pointer width
     *  (e.g., DWORD) truncates the address. Use ULINT, LWORD, or PTR_INT_t for
     *  portable pointer-to-integer storage. */
    template<typename U, typename V = T, std::enable_if_t<std::is_integral<V>::value, int> = 0>
    IECVar& operator=(const IEC_Ptr<U>& ptr) noexcept {
        set(static_cast<T>(ptr.to_addr()));
        return *this;
    }

    /** Assignment from a raw pointer — stores the address as an integer.
     *  Used by the ADR(x) lowering `_TMP : __XWORD := &(x)`. Integral targets
     *  only; routed through uintptr_t so it is pointer-width-correct per
     *  target (no truncation when T is __XWORD/XWORD_t). */
    template<typename U, typename V = T, std::enable_if_t<std::is_integral<V>::value, int> = 0>
    IECVar& operator=(U* p) noexcept {
        set(static_cast<T>(reinterpret_cast<std::uintptr_t>(p)));
        return *this;
    }

    // =========================================================================
    // Container Access Forwarding (for array/struct types)
    // =========================================================================

    /** Forward operator-> to underlying type (struct/FB member access) */
    template<typename U = T, std::enable_if_t<std::is_class<U>::value, int> = 0>
    T* operator->() noexcept { return &value_; }

    template<typename U = T, std::enable_if_t<std::is_class<U>::value, int> = 0>
    const T* operator->() const noexcept { return &value_; }

    /** Forward operator[] to underlying type (1D array access) */
    template<typename Index>
    auto operator[](Index i) noexcept -> decltype(std::declval<T&>()[i]) {
        return value_[i];
    }

    template<typename Index>
    auto operator[](Index i) const noexcept -> decltype(std::declval<const T&>()[i]) {
        return value_[i];
    }

    /** Forward operator() to underlying type (2D+ array access) */
    template<typename... Args>
    auto operator()(Args... args) noexcept -> decltype(std::declval<T&>()(args...)) {
        return value_(args...);
    }

    template<typename... Args>
    auto operator()(Args... args) const noexcept -> decltype(std::declval<const T&>()(args...)) {
        return value_(args...);
    }

    // =========================================================================
    // Arithmetic Operators
    // =========================================================================

    IECVar& operator+=(T v) noexcept {
        set(iec_add(get(), v));
        return *this;
    }

    IECVar& operator-=(T v) noexcept {
        set(iec_sub(get(), v));
        return *this;
    }

    IECVar& operator*=(T v) noexcept {
        set(iec_mul(get(), v));
        return *this;
    }

    IECVar& operator/=(T v) {
        set(iec_div(get(), v));
        return *this;
    }

    IECVar& operator%=(T v) {
        set(iec_mod(get(), v));
        return *this;
    }

    // Prefix increment
    IECVar& operator++() noexcept {
        set(iec_add(get(), T(1)));
        return *this;
    }

    // Postfix increment
    IECVar operator++(int) noexcept {
        IECVar tmp = *this;
        ++(*this);
        return tmp;
    }

    // Prefix decrement
    IECVar& operator--() noexcept {
        set(iec_sub(get(), T(1)));
        return *this;
    }

    // Postfix decrement
    IECVar operator--(int) noexcept {
        IECVar tmp = *this;
        --(*this);
        return tmp;
    }

    // =========================================================================
    // Bitwise Operators (for bit string types)
    // =========================================================================

    IECVar& operator&=(T v) noexcept {
        set(get() & v);
        return *this;
    }

    IECVar& operator|=(T v) noexcept {
        set(get() | v);
        return *this;
    }

    IECVar& operator^=(T v) noexcept {
        set(get() ^ v);
        return *this;
    }

private:
    T value_;           ///< The actual value
    bool forced_;       ///< Whether forcing is active
    T forced_value_;    ///< The forced value (when forced_ is true)
};

// =============================================================================
// Binary Operators
// =============================================================================

// -----------------------------------------------------------------------------
// IEC arithmetic result type.
//
// CODESYS computes temporary results with the target device's native width
// (at least 32-bit on x86/ARM, 64-bit on x64) and only truncates when the
// value is assigned or an explicit conversion (e.g. TO_WORD) is used.  Each IEC
// integer operand is promoted to a type of at least IEC_NATIVE_WIDTH that can
// represent all its values, then the C usual-arithmetic common type of the
// two promoted types is used.  Real operands keep their real type and the
// wider real type is selected.
// -----------------------------------------------------------------------------
namespace detail {

template<typename T>
struct iec_arith_info {
    static constexpr bool is_iec = false;
    static constexpr unsigned width = 0;
    static constexpr bool is_signed = false;
    static constexpr bool is_real = false;
};

template<> struct iec_arith_info<int8_t>   { static constexpr bool is_iec = true; static constexpr unsigned width = 8;  static constexpr bool is_signed = true;  static constexpr bool is_real = false; };
template<> struct iec_arith_info<uint8_t>  { static constexpr bool is_iec = true; static constexpr unsigned width = 8;  static constexpr bool is_signed = false; static constexpr bool is_real = false; };
template<> struct iec_arith_info<int16_t>  { static constexpr bool is_iec = true; static constexpr unsigned width = 16; static constexpr bool is_signed = true;  static constexpr bool is_real = false; };
template<> struct iec_arith_info<uint16_t> { static constexpr bool is_iec = true; static constexpr unsigned width = 16; static constexpr bool is_signed = false; static constexpr bool is_real = false; };
template<> struct iec_arith_info<int32_t>  { static constexpr bool is_iec = true; static constexpr unsigned width = 32; static constexpr bool is_signed = true;  static constexpr bool is_real = false; };
template<> struct iec_arith_info<uint32_t> { static constexpr bool is_iec = true; static constexpr unsigned width = 32; static constexpr bool is_signed = false; static constexpr bool is_real = false; };
template<> struct iec_arith_info<int64_t>  { static constexpr bool is_iec = true; static constexpr unsigned width = 64; static constexpr bool is_signed = true;  static constexpr bool is_real = false; };
template<> struct iec_arith_info<uint64_t> { static constexpr bool is_iec = true; static constexpr unsigned width = 64; static constexpr bool is_signed = false; static constexpr bool is_real = false; };
template<> struct iec_arith_info<float>    { static constexpr bool is_iec = true; static constexpr unsigned width = 32; static constexpr bool is_signed = true;  static constexpr bool is_real = true; };
template<> struct iec_arith_info<double>   { static constexpr bool is_iec = true; static constexpr unsigned width = 64; static constexpr bool is_signed = true;  static constexpr bool is_real = true; };

template<unsigned Width, bool IsSigned, bool IsReal>
struct iec_arith_select;

template<> struct iec_arith_select<8,  true, false> { using type = int8_t; };
template<> struct iec_arith_select<8,  false, false> { using type = uint8_t; };
template<> struct iec_arith_select<16, true,  false> { using type = int16_t; };
template<> struct iec_arith_select<16, false, false> { using type = uint16_t; };
template<> struct iec_arith_select<32, true,  false> { using type = int32_t; };
template<> struct iec_arith_select<32, false, false> { using type = uint32_t; };
template<> struct iec_arith_select<32, true,  true>  { using type = float; };
template<> struct iec_arith_select<64, true,  false> { using type = int64_t; };
template<> struct iec_arith_select<64, false, false> { using type = uint64_t; };
template<> struct iec_arith_select<64, true,  true>  { using type = double; };

// Native integer width: use the host pointer size as a stand-in for the
// CODESYS target processor word size (32-bit on x86, 64-bit on x64).  This can
// be overridden at compile time with -DSTRUCPP_TARGET_WIDTH=32 (or 64) to
// match the actual CODESYS target and the published doc examples.
#ifndef STRUCPP_TARGET_WIDTH
#define STRUCPP_TARGET_WIDTH (sizeof(void*) * 8)
#endif
using iec_native_int_t = typename iec_arith_select<STRUCPP_TARGET_WIDTH, true, false>::type;
using iec_native_uint_t = typename iec_arith_select<STRUCPP_TARGET_WIDTH, false, false>::type;
static constexpr unsigned iec_native_width = STRUCPP_TARGET_WIDTH;

// Promote an IEC integer to a type of at least the native width.  Unsigned
// types are promoted to signed when the signed native-min type can represent
// all their values, matching C integer promotion (e.g. BYTE -> int).
template<typename T, bool IsIEC = iec_arith_info<T>::is_iec, bool IsReal = iec_arith_info<T>::is_real>
struct iec_promote { using type = T; };

template<typename T>
struct iec_promote<T, true, false> {
    static constexpr unsigned width = iec_arith_info<T>::width;
    static constexpr bool is_signed = iec_arith_info<T>::is_signed;
    static constexpr unsigned target_width = (width > iec_native_width) ? width : iec_native_width;
    // Use a signed promotion when the wider signed type can hold every value
    // of the source type.  For an unsigned type of width w and a signed type
    // of width W, that is true exactly when W > w.
    static constexpr bool promote_signed = is_signed || (target_width > width);
    using type = typename iec_arith_select<target_width, promote_signed, false>::type;
};

template<typename T>
struct iec_promote<T, true, true> { using type = T; };

template<typename T>
using iec_promote_t = typename iec_promote<T>::type;

// SFINAE-friendly detection of `std::common_type<T, U>::type`.  If the two
// types have no common type (e.g. an IECVar wrapper and an arithmetic type),
// `iec_common_type_select::type` is `void` rather than a substitution failure.
template<typename...>
struct iec_voider { using type = void; };
template<typename... Ts>
using iec_void_t = typename iec_voider<Ts...>::type;

template<typename T, typename U, typename = void>
struct iec_common_type_select { using type = void; };

template<typename T, typename U>
struct iec_common_type_select<T, U, iec_void_t<typename std::common_type<T, U>::type>> {
    using type = typename std::common_type<T, U>::type;
};

template<typename T, typename U>
struct iec_arith_result_impl {
    using type = typename iec_common_type_select<
        iec_promote_t<T>,
        iec_promote_t<U>
    >::type;
};

} // namespace detail

template<typename T, typename U>
using iec_arith_result_t = typename detail::iec_arith_result_impl<T, U>::type;

// Result type for MIN/MAX/LIMIT/SEL when operands have different IEC types.
// For mixed-sign integer pairs we widen to a signed type with twice the operand
// width so the full value range is representable (e.g. DINT+UDINT -> LINT).
// When no wider signed type exists (LINT+ULINT) we fall back to iec_arith_result_t.
namespace detail {
    template<unsigned Width, bool IsSigned, bool IsReal>
    struct iec_wider_signed_select { using type = void; };

    template<> struct iec_wider_signed_select<8,  true, false> { using type = int16_t; };
    template<> struct iec_wider_signed_select<16, true, false> { using type = int32_t; };
    template<> struct iec_wider_signed_select<32, true, false> { using type = int64_t; };

    template<unsigned Width>
    struct iec_wider_signed_select<Width, false, false> {
        using type = typename std::conditional<
            (Width <= 32),
            typename iec_arith_select<Width * 2, true, false>::type,
            void
        >::type;
    };

    template<unsigned Width>
    struct iec_wider_signed_select<Width, true, true> { using type = double; };

    template<unsigned Width>
    struct iec_wider_signed_select<Width, false, true> { using type = double; };
}

template<typename T, typename U, typename = void>
struct iec_minmax_result { using type = iec_arith_result_t<T, U>; };

template<typename T, typename U>
struct iec_minmax_result<T, U, std::enable_if_t<
    std::is_integral<T>::value && std::is_integral<U>::value &&
    detail::iec_arith_info<T>::is_iec && detail::iec_arith_info<U>::is_iec &&
    (std::is_signed<T>::value != std::is_signed<U>::value)>> {
    static constexpr unsigned max_width =
        (detail::iec_arith_info<T>::width > detail::iec_arith_info<U>::width)
            ? detail::iec_arith_info<T>::width
            : detail::iec_arith_info<U>::width;
    using wider = typename detail::iec_wider_signed_select<max_width, true, false>::type;
    using type = typename std::conditional<
        !std::is_same<wider, void>::value,
        wider,
        typename detail::iec_arith_select<max_width, true, false>::type
    >::type;
};

template<typename T, typename U>
using iec_minmax_result_t = typename iec_minmax_result<T, U>::type;

// Common result type for a heterogeneous value list (e.g. MUX inputs or
// variadic MIN/MAX).  Built by folding iec_minmax_result_t over the pack.
namespace detail {
    template<typename...>
    struct iec_common_result_impl;

    template<typename T>
    struct iec_common_result_impl<T> {
        using type = T;
    };

    template<typename T, typename U, typename... Rest>
    struct iec_common_result_impl<T, U, Rest...> {
        using first = iec_minmax_result_t<T, U>;
        using type = typename iec_common_result_impl<first, Rest...>::type;
    };
}

template<typename... Ts>
using iec_common_result_t = typename detail::iec_common_result_impl<Ts...>::type;

template<typename T, typename U>
inline IECVar<iec_arith_result_t<T, U>> operator+(const IECVar<T>& a, const IECVar<U>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_add(static_cast<R>(a.get()), static_cast<R>(b.get())));
}

template<typename T, typename U>
inline IECVar<iec_arith_result_t<T, U>> operator-(const IECVar<T>& a, const IECVar<U>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_sub(static_cast<R>(a.get()), static_cast<R>(b.get())));
}

template<typename T, typename U>
inline IECVar<iec_arith_result_t<T, U>> operator*(const IECVar<T>& a, const IECVar<U>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mul(static_cast<R>(a.get()), static_cast<R>(b.get())));
}

template<typename T, typename U>
inline IECVar<iec_arith_result_t<T, U>> operator/(const IECVar<T>& a, const IECVar<U>& b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_div(static_cast<R>(a.get()), static_cast<R>(b.get())));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_integral<iec_arith_result_t<T, U>>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator%(const IECVar<T>& a, const IECVar<U>& b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mod(static_cast<R>(a.get()), static_cast<R>(b.get())));
}

// Mixed IECVar / raw arithmetic. This catches IEC literals like `10` (C++ int)
// and raw intermediates (e.g. `IEC_DINT * IEC_INT` evaluating in the common
// underlying type) so they go through the IEC faulting helpers instead of the
// builtin C++ operators.
template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator+(const IECVar<T>& a, U b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_add(static_cast<R>(a.get()), static_cast<R>(b)));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator+(U a, const IECVar<T>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_add(static_cast<R>(a), static_cast<R>(b.get())));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator-(const IECVar<T>& a, U b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_sub(static_cast<R>(a.get()), static_cast<R>(b)));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator-(U a, const IECVar<T>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_sub(static_cast<R>(a), static_cast<R>(b.get())));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator*(const IECVar<T>& a, U b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mul(static_cast<R>(a.get()), static_cast<R>(b)));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator*(U a, const IECVar<T>& b) noexcept {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mul(static_cast<R>(a), static_cast<R>(b.get())));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator/(const IECVar<T>& a, U b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_div(static_cast<R>(a.get()), static_cast<R>(b)));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator/(U a, const IECVar<T>& b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_div(static_cast<R>(a), static_cast<R>(b.get())));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_integral<iec_arith_result_t<T, U>>::value &&
                                     std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator%(const IECVar<T>& a, U b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mod(static_cast<R>(a.get()), static_cast<R>(b)));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_integral<iec_arith_result_t<T, U>>::value &&
                                     std::is_arithmetic<typename std::remove_reference<U>::type>::value>>
inline IECVar<iec_arith_result_t<T, U>> operator%(U a, const IECVar<T>& b) {
    using R = iec_arith_result_t<T, U>;
    return IECVar<R>(iec_mod(static_cast<R>(a), static_cast<R>(b.get())));
}

namespace detail {
    // Distinguish IECVar<T> from raw arithmetic/IEC types for symmetric overloads.
    template<typename T> struct is_iec_var : std::false_type {};
    template<typename T> struct is_iec_var<IECVar<T>> : std::true_type {};

    template<typename T>
    inline T iec_unwrap_value(const IECVar<T>& v) noexcept { return v.get(); }
    template<typename T>
    inline T iec_unwrap_value(T v) noexcept { return v; }

    template<typename T, typename U, typename = void>
    struct iec_both_integral : std::false_type {};
    template<typename T, typename U>
    struct iec_both_integral<T, U, std::enable_if_t<std::is_integral<T>::value && std::is_integral<U>::value>> : std::true_type {};

    template<typename T, typename U>
    inline bool iec_cmp_equal_impl(T a, U b, std::true_type) noexcept {
        constexpr bool tSigned = std::is_signed<T>::value;
        constexpr bool uSigned = std::is_signed<U>::value;
        if (tSigned == uSigned) {
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) == static_cast<R>(b);
        }
        if (tSigned && !uSigned) {
            if (a < T(0)) return false;
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) == static_cast<R>(b);
        }
        if (!tSigned && uSigned) {
            if (b < U(0)) return false;
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) == static_cast<R>(b);
        }
        return false;
    }

    template<typename T, typename U>
    inline bool iec_cmp_equal_impl(T a, U b, std::false_type) noexcept {
        using R = iec_arith_result_t<T, U>;
        return static_cast<R>(a) == static_cast<R>(b);
    }

    template<typename T, typename U>
    inline bool iec_cmp_less_impl(T a, U b, std::true_type) noexcept {
        constexpr bool tSigned = std::is_signed<T>::value;
        constexpr bool uSigned = std::is_signed<U>::value;
        if (tSigned == uSigned) {
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) < static_cast<R>(b);
        }
        if (tSigned && !uSigned) {
            if (a < T(0)) return true;
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) < static_cast<R>(b);
        }
        if (!tSigned && uSigned) {
            if (b < U(0)) return false;
            using R = iec_arith_result_t<T, U>;
            return static_cast<R>(a) < static_cast<R>(b);
        }
        return false;
    }

    template<typename T, typename U>
    inline bool iec_cmp_less_impl(T a, U b, std::false_type) noexcept {
        using R = iec_arith_result_t<T, U>;
        return static_cast<R>(a) < static_cast<R>(b);
    }
}

// Sign-aware comparison helpers (C++17 stand-in for std::cmp_less / cmp_equal).
template<typename T, typename U>
inline bool iec_cmp_equal(T a, U b) noexcept {
    return detail::iec_cmp_equal_impl(a, b, typename detail::iec_both_integral<T, U>::type());
}

template<typename T, typename U>
inline bool iec_cmp_not_equal(T a, U b) noexcept {
    return !iec_cmp_equal(a, b);
}

template<typename T, typename U>
inline bool iec_cmp_less(T a, U b) noexcept {
    return detail::iec_cmp_less_impl(a, b, typename detail::iec_both_integral<T, U>::type());
}

template<typename T, typename U>
inline bool iec_cmp_greater(T a, U b) noexcept {
    return iec_cmp_less(b, a);
}

template<typename T, typename U>
inline bool iec_cmp_less_equal(T a, U b) noexcept {
    return !iec_cmp_less(b, a);
}

template<typename T, typename U>
inline bool iec_cmp_greater_equal(T a, U b) noexcept {
    return !iec_cmp_less(a, b);
}

// =============================================================================
// Comparison Operators
// =============================================================================

// Generic heterogeneous comparisons covering IECVar<T> vs IECVar<U> and
// IECVar<T> vs any raw arithmetic/IEC value.  They use iec_cmp_* so mixed
// signed/unsigned comparisons do not silently decay to unsigned C++
// arithmetic (e.g. INT#-1 < UDINT#1 must be true).
template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator==(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator==(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator!=(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_not_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator!=(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_not_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator<(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_less(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator<(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_less(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator>(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_greater(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator>(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_greater(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator<=(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_less_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator<=(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_less_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<std::is_arithmetic<U>::value || detail::is_iec_var<U>::value>>
inline bool operator>=(const IECVar<T>& a, const U& b) noexcept {
    return iec_cmp_greater_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

template<typename T, typename U,
         typename = std::enable_if_t<(std::is_arithmetic<U>::value || detail::is_iec_var<U>::value) && !detail::is_iec_var<U>::value>>
inline bool operator>=(const U& a, const IECVar<T>& b) noexcept {
    return iec_cmp_greater_equal(detail::iec_unwrap_value(a), detail::iec_unwrap_value(b));
}

// =============================================================================
// Bitwise Operators
// =============================================================================

template<typename T>
inline IECVar<T> operator&(const IECVar<T>& a, const IECVar<T>& b) noexcept {
    return IECVar<T>(a.get() & b.get());
}

template<typename T>
inline IECVar<T> operator|(const IECVar<T>& a, const IECVar<T>& b) noexcept {
    return IECVar<T>(a.get() | b.get());
}

template<typename T>
inline IECVar<T> operator^(const IECVar<T>& a, const IECVar<T>& b) noexcept {
    return IECVar<T>(a.get() ^ b.get());
}

// Mixed-type bitwise operators
template<typename T> inline IECVar<T> operator&(const IECVar<T>& a, T b) noexcept { return IECVar<T>(a.get() & b); }
template<typename T> inline IECVar<T> operator&(T a, const IECVar<T>& b) noexcept { return IECVar<T>(a & b.get()); }
template<typename T> inline IECVar<T> operator|(const IECVar<T>& a, T b) noexcept { return IECVar<T>(a.get() | b); }
template<typename T> inline IECVar<T> operator|(T a, const IECVar<T>& b) noexcept { return IECVar<T>(a | b.get()); }
template<typename T> inline IECVar<T> operator^(const IECVar<T>& a, T b) noexcept { return IECVar<T>(a.get() ^ b); }
template<typename T> inline IECVar<T> operator^(T a, const IECVar<T>& b) noexcept { return IECVar<T>(a ^ b.get()); }

template<typename T>
inline IECVar<T> operator~(const IECVar<T>& a) noexcept {
    return IECVar<T>(~a.get());
}

// =============================================================================
// IEC Type Aliases with Forcing Support
// =============================================================================

// Boolean
using IEC_BOOL = IECVar<BOOL_t>;

// Bit strings
using IEC_BYTE = IECVar<BYTE_t>;
using IEC_WORD = IECVar<WORD_t>;
using IEC_DWORD = IECVar<DWORD_t>;
using IEC_LWORD = IECVar<LWORD_t>;
// CODESYS __XWORD — pointer-width unsigned (see XWORD_t in iec_types.hpp).
using IEC_XWORD = IECVar<XWORD_t>;

// Signed integers
using IEC_SINT = IECVar<SINT_t>;
using IEC_INT = IECVar<INT_t>;
using IEC_DINT = IECVar<DINT_t>;
using IEC_LINT = IECVar<LINT_t>;
// CODESYS __XINT — target-width signed integer (see XINT_t in iec_types.hpp).
using IEC_XINT = IECVar<XINT_t>;

// Unsigned integers
using IEC_USINT = IECVar<USINT_t>;
using IEC_UINT = IECVar<UINT_t>;
using IEC_UDINT = IECVar<UDINT_t>;
using IEC_ULINT = IECVar<ULINT_t>;
// CODESYS __UXINT — target-width unsigned integer (see UXINT_t in iec_types.hpp).
using IEC_UXINT = IECVar<UXINT_t>;

// Real numbers
using IEC_REAL = IECVar<REAL_t>;
using IEC_LREAL = IECVar<LREAL_t>;

// Time types
using IEC_TIME = IECVar<TIME_t>;
using IEC_DATE = IECVar<DATE_t>;
using IEC_TOD = IECVar<TOD_t>;
using IEC_DT = IECVar<DT_t>;

// IEC v3 Long time types
using IEC_LTIME = IECVar<LTIME_t>;
using IEC_LDATE = IECVar<LDATE_t>;
using IEC_LTOD = IECVar<LTOD_t>;
using IEC_LDT = IECVar<LDT_t>;

// Character types
using IEC_CHAR = IECVar<CHAR_t>;
using IEC_WCHAR = IECVar<WCHAR_t>;

// Aliases for compatibility
using IEC_TIME_OF_DAY = IEC_TOD;
using IEC_DATE_AND_TIME = IEC_DT;
using IEC_LONG_TIME_OF_DAY = IEC_LTOD;
using IEC_LONG_DATE_AND_TIME = IEC_LDT;

} // namespace strucpp
