// SPDX-License-Identifier: GPL-3.0-or-later WITH STruCpp-runtime-exception
// Copyright (C) 2025 Autonomy / OpenPLC Project
// This file is part of the STruC++ Runtime Library and is covered by the
// STruC++ Runtime Library Exception. See COPYING.RUNTIME for details.
/**
 * STruC++ Runtime - IEC 61131-3 arithmetic helpers.
 *
 * Defines overflow/wrap-safe integer operations and defined-fault division
 * helpers used by both IECVar operators and the standard function library.
 *
 * Kept in a separate header so iec_var.hpp (which must stay C++14-clean and
 * usable by Arduino POU code) and iec_std_lib.hpp can share the same
 * semantics without a circular dependency.
 */

#pragma once

#include "iec_fault.hpp"
#include <cstdint>
#include <limits>
#include <type_traits>
#include <utility>

#if STRUCPP_HAS_EXCEPTIONS
#include <stdexcept>
#endif

namespace strucpp {

/**
 * Raise an arithmetic runtime fault.
 * On hosted/exception builds throws std::runtime_error so the test harness
 * can catch it. On -fno-exceptions firmware targets it calls the platform
 * iec_runtime_fault() hook and does not return.
 */
#if STRUCPP_HAS_EXCEPTIONS
inline void iec_arithmetic_fault(const char* context) {
    throw std::runtime_error(context ? context : "Arithmetic fault");
}
#else
[[noreturn]] inline void iec_arithmetic_fault(const char* context) noexcept {
    iec_runtime_fault(IecFault::DivisionByZero, context);
}
#endif

namespace detail {

template<typename T>
using make_unsigned_t = typename std::make_unsigned<T>::type;

template<typename T>
struct is_wrapped_integral
    : std::integral_constant<bool,
          std::is_integral<T>::value && !std::is_same<T, bool>::value> {};

// Addition/subtraction/multiplication on signed integers are performed in
// unsigned to get two's-complement wrap semantics, then cast back.  This
// avoids signed-overflow UB while matching CODESYS modulo-2^n behaviour.
// Unsigned and floating-point types pass through unchanged.

template<typename T>
inline T iec_add_impl(T a, T b, std::true_type) noexcept {
    using UT = make_unsigned_t<T>;
    return static_cast<T>(static_cast<UT>(a) + static_cast<UT>(b));
}

template<typename T>
inline T iec_add_impl(T a, T b, std::false_type) noexcept {
    return a + b;
}

template<typename T>
inline T iec_sub_impl(T a, T b, std::true_type) noexcept {
    using UT = make_unsigned_t<T>;
    return static_cast<T>(static_cast<UT>(a) - static_cast<UT>(b));
}

template<typename T>
inline T iec_sub_impl(T a, T b, std::false_type) noexcept {
    return a - b;
}

template<typename T>
inline T iec_mul_impl(T a, T b, std::true_type) noexcept {
    using UT = make_unsigned_t<T>;
    return static_cast<T>(static_cast<UT>(a) * static_cast<UT>(b));
}

template<typename T>
inline T iec_mul_impl(T a, T b, std::false_type) noexcept {
    return a * b;
}

} // namespace detail

template<typename T>
inline T iec_add(T a, T b) noexcept {
    return detail::iec_add_impl(a, b, typename detail::is_wrapped_integral<T>::type());
}

template<typename T>
inline T iec_sub(T a, T b) noexcept {
    return detail::iec_sub_impl(a, b, typename detail::is_wrapped_integral<T>::type());
}

template<typename T>
inline T iec_mul(T a, T b) noexcept {
    return detail::iec_mul_impl(a, b, typename detail::is_wrapped_integral<T>::type());
}

template<typename T>
inline T iec_div(T a, T b) {
    if (b == T(0)) {
        iec_arithmetic_fault("Division by zero");
    }
    if (std::is_integral<T>::value && std::is_signed<T>::value &&
        b == T(-1) && a == std::numeric_limits<T>::min()) {
        // INT_MIN / -1 is not representable in two's complement.  CODESYS
        // wraps just like negation of INT_MIN, so the result is INT_MIN.
        return a;
    }
    return a / b;
}

template<typename T>
inline T iec_mod(T a, T b) {
    if (b == T(0)) {
        iec_arithmetic_fault("Division by zero");
    }
    if (std::is_integral<T>::value && std::is_signed<T>::value && b == T(-1)) {
        return T(0);
    }
    return a % b;
}

} // namespace strucpp
