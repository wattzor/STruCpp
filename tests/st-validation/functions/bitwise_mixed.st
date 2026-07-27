PROGRAM BitwiseMixed
  VAR
    and_dw : DWORD;
    or_dw : DWORD;
    xor_dw : DWORD;
    and3_dw : DWORD;
    mixed_or_dw : DWORD;
  END_VAR

  and_dw := AND(DWORD#16#000000FF, WORD#16#00FF);
  or_dw := OR(DWORD#16#000000FF, WORD#16#00FF);
  xor_dw := XOR(DWORD#16#0000000F, WORD#16#00F0);
  and3_dw := AND(DWORD#16#00FF, WORD#16#000F, BYTE#16#03);
  mixed_or_dw := OR(WORD#16#00FF, DWORD#16#FF00);
END_PROGRAM
