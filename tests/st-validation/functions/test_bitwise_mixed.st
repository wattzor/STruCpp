TEST 'AND with mixed bit types'
  VAR uut : BitwiseMixed; END_VAR
  uut();
  ASSERT_EQ(uut.and_dw, 255);
END_TEST

TEST 'OR with mixed bit types'
  VAR uut : BitwiseMixed; END_VAR
  uut();
  ASSERT_EQ(uut.or_dw, 255);
END_TEST

TEST 'XOR with mixed bit types'
  VAR uut : BitwiseMixed; END_VAR
  uut();
  ASSERT_EQ(uut.xor_dw, 255);
END_TEST

TEST 'AND variadic with mixed bit types'
  VAR uut : BitwiseMixed; END_VAR
  uut();
  ASSERT_EQ(uut.and3_dw, 3);
END_TEST

TEST 'OR with smaller first operand'
  VAR uut : BitwiseMixed; END_VAR
  uut();
  ASSERT_EQ(uut.mixed_or_dw, 65535);
END_TEST
