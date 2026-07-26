// SPDX-License-Identifier: GPL-3.0-or-later WITH STruCpp-runtime-exception
// Copyright (C) 2025 Autonomy / OpenPLC Project
// This file is part of the STruC++ Runtime Library and is covered by the
// STruC++ Runtime Library Exception. See COPYING.RUNTIME for details.
/**
 * STruC++ Runtime - CODESYS ANY / AnyType descriptor.
 *
 * Mirrors the CODESYS AnyType record used for VAR_INPUT ANY parameters.
 * Field names are emitted in uppercase so generated code can access them
 * case-insensitively after the lexer uppercases ST source.
 */

#pragma once

#include "iec_system.hpp"
#include "iec_ptr.hpp"
#include "iec_var.hpp"

namespace strucpp {

/**
 * CODESYS-compatible AnyType descriptor.
 *
 * - TYPECLASS: the __SYSTEM.TYPE_CLASS id of the actual argument.
 * - PVALUE:    pointer to the actual argument's memory (byte addressable).
 * - DISIZE:    size of the argument in bytes.
 */
struct AnyType {
    IEC_TYPE_CLASS TYPECLASS;
    IEC_Ptr<BYTE_t> PVALUE;
    IEC_DINT DISIZE;
};

/**
 * Build an AnyType descriptor from any lvalue or rvalue.
 *
 * The type-class id is supplied at the call site by codegen, so no
 * runtime type-traits machinery is needed.  A const reference extends
 * the lifetime of temporaries for the duration of the full call
 * expression, keeping the PVALUE valid while the ANY-receiving function
 * executes.
 */
template<__SYSTEM::TYPE_CLASS C, typename T>
inline AnyType make_any_type(const T& value) noexcept {
    return AnyType{ IEC_TYPE_CLASS{ C }, IEC_Ptr<BYTE_t>(&value), IEC_DINT(IEC_SIZEOF(value)) };
}

} // namespace strucpp
