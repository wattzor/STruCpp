TYPE
  UBytes :
    STRUCT
      b1 : BYTE;
      b2 : BYTE;
      b3 : BYTE;
      b4 : BYTE;
    END_STRUCT;

  U :
    UNION
      n : UDINT;
      bytes : UBytes;
    END_UNION;

  S :
    STRUCT
      u : U;
      x : INT;
    END_STRUCT;
END_TYPE

PROGRAM UnionStructTest
  VAR
    s : S;
  END_VAR

  s.u.n := UDINT#16#01020304;
  s.x := 42;
END_PROGRAM
