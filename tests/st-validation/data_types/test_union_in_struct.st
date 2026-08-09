TEST 'Struct containing a union compiles and accesses union members'
  VAR uut : UnionStructTest; expected : UDINT; END_VAR
  uut();
  ASSERT_EQ(uut.s.u.n, UDINT#16#01020304);
  ASSERT_EQ(uut.s.x, 42);
  ASSERT_EQ(uut.s, uut.s);
END_TEST
