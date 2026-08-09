TEST 'Union inside a struct compiles and overlays memory correctly'
  VAR uut : UnionInStructTest; END_VAR
  uut();
  ASSERT_EQ(uut.addr.sin_family, INT#2);
  ASSERT_EQ(uut.addr.sin_port, UINT#16#1F90);
  ASSERT_EQ(uut.b1, BYTE#16#04);
  ASSERT_EQ(uut.b4, BYTE#16#01);
  ASSERT_EQ(uut.w2, WORD#16#0102);
  ASSERT_EQ(uut.u, UDINT#16#01020304);
  ASSERT_EQ(uut.addr.sin_addr, uut.addr.sin_addr);
END_TEST
