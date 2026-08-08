TEST 'Union type punning (UDINT overlay with bytes and words)'
  VAR uut : UnionTest; END_VAR
  uut();
  ASSERT_EQ(uut.b1, BYTE#16#04);
  ASSERT_EQ(uut.b2, BYTE#16#03);
  ASSERT_EQ(uut.b3, BYTE#16#02);
  ASSERT_EQ(uut.b4, BYTE#16#01);
  ASSERT_EQ(uut.w1, WORD#16#0304);
  ASSERT_EQ(uut.w2, WORD#16#0102);
  ASSERT_EQ(uut.u, UDINT#16#01020304);
END_TEST
