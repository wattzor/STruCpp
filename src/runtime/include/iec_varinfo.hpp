// SPDX-License-Identifier: GPL-3.0-or-later WITH STruCpp-runtime-exception
// Copyright (C) 2025 Autonomy / OpenPLC Project
// This file is part of the STruC++ Runtime Library and is covered by the
// STruC++ Runtime Library Exception. See COPYING.RUNTIME for details.
/**
 * STruC++ Runtime - CODESYS __VARINFO / __SYSTEM.VAR_INFO descriptor.
 *
 * Mirrors the CODESYS VAR_INFO structure used by the __VARINFO(<variable>)
 * operator. Field order and types follow the CODESYS Development System
 * documentation.
 */

#pragma once

#include "iec_system.hpp"
#include "iec_string.hpp"

namespace strucpp {

/**
 * Compile-time variable information descriptor.
 *
 * All numeric fields are populated by the compiler from the target variable's
 * type and declaration location. String fields are filled with the variable's
 * type name, symbol name and trailing declaration comment (if any).
 */
struct VAR_INFO {
    IEC_DWORD BYTEADDRESS;
    IEC_DINT BYTEOFFSET;
    IEC_INT AREA;
    IEC_INT BITNR;
    IEC_UDINT BITSIZE;
    IEC_UDINT BITADDRESS;
    IEC_TYPE_CLASS TYPECLASS;
    IECString<79> TYPENAME;
    IEC_UDINT NUMELEMENTS;
    IEC_TYPE_CLASS BASETYPECLASS;
    IEC_UDINT ELEMBITSIZE;
    IEC_MEMORY_AREA MEMORYAREA;
    IECString<39> SYMBOL;
    IECString<79> COMMENT;
};

} // namespace strucpp
