TYPE
  UDINT_IN_BYTES :
    STRUCT
      b1 : BYTE;
      b2 : BYTE;
      b3 : BYTE;
      b4 : BYTE;
    END_STRUCT;

  UDINT_IN_WORDS :
    STRUCT
      w1 : WORD;
      w2 : WORD;
    END_STRUCT;

  INADDR :
    UNION
      ulAddr : UDINT;
      S_un_b : UDINT_IN_BYTES;
      S_un_w : UDINT_IN_WORDS;
    END_UNION;

  SOCKADDRESS :
    STRUCT
      sin_family : INT;
      sin_port : UINT;
      sin_addr : INADDR;
    END_STRUCT;
END_TYPE

PROGRAM UnionInStructTest
  VAR
    addr : SOCKADDRESS;
    b1 : BYTE;
    b4 : BYTE;
    w2 : WORD;
    u : UDINT;
  END_VAR

  addr.sin_family := INT#2;
  addr.sin_port := UINT#16#1F90;
  addr.sin_addr.ulAddr := UDINT#16#01020304;
  b1 := addr.sin_addr.S_un_b.b1;
  b4 := addr.sin_addr.S_un_b.b4;
  w2 := addr.sin_addr.S_un_w.w2;
  u := addr.sin_addr.ulAddr;
END_PROGRAM
