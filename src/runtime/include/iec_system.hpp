// SPDX-License-Identifier: GPL-3.0-or-later WITH STruCpp-runtime-exception
// Copyright (C) 2025 Autonomy / OpenPLC Project
// This file is part of the STruC++ Runtime Library and is covered by the
// STruC++ Runtime Library Exception. See COPYING.RUNTIME for details.
/**
 * STruC++ Runtime - CODESYS __SYSTEM namespace.
 *
 * Provides the TYPE_CLASS and MEMORY_AREA enumerations used by the
 * __VARINFO / ANY runtime descriptors. Values are fixed ABI constants and
 * match the CODESYS Development System documentation.
 */

#pragma once

#include <cstdint>
#include "iec_enum.hpp"

namespace strucpp {

namespace __SYSTEM {

enum class TYPE_CLASS : std::uint32_t {
    TYPE_BOOL = 0,
    TYPE_BIT = 1,
    TYPE_BYTE = 2,
    TYPE_WORD = 3,
    TYPE_DWORD = 4,
    TYPE_LWORD = 5,
    TYPE_SINT = 6,
    TYPE_INT = 7,
    TYPE_DINT = 8,
    TYPE_LINT = 9,
    TYPE_USINT = 10,
    TYPE_UINT = 11,
    TYPE_UDINT = 12,
    TYPE_ULINT = 13,
    TYPE_REAL = 14,
    TYPE_LREAL = 15,
    TYPE_STRING = 16,
    TYPE_WSTRING = 17,
    TYPE_TIME = 18,
    TYPE_DATE = 19,
    TYPE_DATEANDTIME = 20,
    TYPE_TIMEOFDAY = 21,
    TYPE_POINTER = 22,
    TYPE_REFERENCE = 23,
    TYPE_SUBRANGE = 24,
    TYPE_ENUM = 25,
    TYPE_ARRAY = 26,
    TYPE_PARAMS = 27,
    TYPE_USERDEF = 28,
    TYPE_NONE = 29,
    TYPE_ANY = 30,
    TYPE_ANYBIT = 31,
    TYPE_ANYDATE = 32,
    TYPE_ANYINT = 33,
    TYPE_ANYNUM = 34,
    TYPE_ANYREAL = 35,
    TYPE_LAZY = 36,
    TYPE_LTIME = 37,
    TYPE_BITCONST = 38,
    TYPE_UXINT = 39,
    TYPE_XWORD = 40,
    TYPE_XINT = 41,
    TYPE_XSRTING = 42,
    TYPE_VARLENARRAY = 43,
    TYPE_ANYSTRING = 44,
    TYPE_VECTOR = 45,
    TYPE_LDATE = 46,
    TYPE_LDATEANDTIME = 47,
    TYPE_LTIMEOFDAY = 48,
};

enum class MEMORY_AREA : std::int32_t {
    MEM_UNKNOWN = -1,
    MEM_MEMORY = 0,
    MEM_INPUT = 1,
    MEM_OUTPUT = 2,
    MEM_RETAIN = 3,
    MEM_GLOBAL = 4,
    MEM_LOCAL = 5,
};

} // namespace __SYSTEM

using IEC_TYPE_CLASS = IEC_ENUM_Var<__SYSTEM::TYPE_CLASS>;
using IEC_MEMORY_AREA = IEC_ENUM_Var<__SYSTEM::MEMORY_AREA>;

} // namespace strucpp
