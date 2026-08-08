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
END_TYPE

PROGRAM UnionTest
  VAR
    addr : INADDR;
    b1 : BYTE;
    b2 : BYTE;
    b3 : BYTE;
    b4 : BYTE;
    w1 : WORD;
    w2 : WORD;
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
