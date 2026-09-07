/* =============================================================================
 * bit-ops.cpp — 位操作指令（pure numeric-bit）
 * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。
 * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。
 * 包含成员：3 个
 * 已分类 op：
  0x135 op_bit_set (sub_42F8B0)
  0x136 op_bit_reset (sub_42F920)
  0x13F op_check_bit (sub_42FB40)
 * ============================================================================= */

/* ===== [stained] sub_42F8B0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_bit_set_42F8B0
 * raw 行区间 [39402, 39421]; op=0x135 指令名『bit-set』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
void Engine::op_bit_set_42F8B0(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 5;
  v2 = this->readIntOperand_41BF50( 2);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(_this + 8), 1024, aSetbit);
    this->sub_4034D0( (const char *)(_this + 8));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 1);
    this->writeIntOperand_42B4B0( 1, (1 << v3) | v4);
  }
}


/* ===== [stained] sub_42F920  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_bit_reset_42F920
 * raw 行区间 [39424, 39443]; op=0x136 指令名『bit-reset』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
void Engine::op_bit_reset_42F920(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 5;
  v2 = this->readIntOperand_41BF50( 2);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(_this + 8), 1024, aRembit);
    this->sub_4034D0( (const char *)(_this + 8));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 1);
    this->writeIntOperand_42B4B0( 1, ~(1 << v3) & v4);
  }
}


/* ===== [stained] sub_42FB40  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_check_bit_42FB40
 * raw 行区间 [39549, 39568]; op=0x13F 指令名『check-bit』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
void Engine::op_check_bit_42FB40(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(_this + 8), 1024, aGetbit);
    this->sub_4034D0( (const char *)(_this + 8));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 2);
    this->writeIntOperand_42B4B0( 1, ((1 << v3) & v4) != 0);
  }
}

