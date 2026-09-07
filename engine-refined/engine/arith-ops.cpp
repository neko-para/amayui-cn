/* =============================================================================
 * arith-ops.cpp — 整数算术/逻辑/比较指令（pure numeric-arith）
 * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。
 * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。
 * 包含成员：17 个
 * 已分类 op：
  0x50 op_add (sub_42C5E0)
  0x51 op_sub (sub_42C620)
  0x52 op_mul (sub_42C660)
  0x53 op_div (sub_42C6A0)
  0x54 op_mod (sub_42C6E0)
  0x55 op_mov (sub_42C720)
  0x56 op_and (sub_42C750)
  0x57 op_or (sub_42C790)
  0x58 op_sar (sub_42C7D0)
  0x59 op_shl (sub_42C820)
  0x5A op_eq (sub_42C870)
  0x5B op_ne (sub_42C8C0)
  0x5C op_lt (sub_42C910)
  0x5D op_lte (sub_42C960)
  0x5E op_gt (sub_42C9B0)
  0x5F op_gte (sub_42CA00)
 * ============================================================================= */

/* ===== [stained] sub_42C5E0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_add_42C5E0
 * raw 行区间 [37525, 37534]; op=0x50 指令名『add』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_add_42C5E0(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 + v2);
}


/* ===== [stained] sub_42C620  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_sub_42C620
 * raw 行区间 [37537, 37546]; op=0x51 指令名『sub』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_sub_42C620(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 - v2);
}


/* ===== [stained] sub_42C660  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_mul_42C660
 * raw 行区间 [37549, 37558]; op=0x52 指令名『mul』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_mul_42C660(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 * v2);
}


/* ===== [stained] sub_42C6A0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_div_42C6A0
 * raw 行区间 [37561, 37570]; op=0x53 指令名『div』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_div_42C6A0(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 / v2);
}


/* ===== [stained] sub_42C6E0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_mod_42C6E0
 * raw 行区间 [37573, 37582]; op=0x54 指令名『mod』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_mod_42C6E0(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 % v2);
}


/* ===== [stained] sub_42C720  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_mov_42C720
 * raw 行区间 [37585, 37592]; op=0x55 指令名『mov』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_mov_42C720(_DWORD *_this)
{
  int v2; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v2);
}


/* ===== [stained] sub_42C750  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_and_42C750
 * raw 行区间 [37595, 37604]; op=0x56 指令名『and』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_and_42C750(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 & v2);
}


/* ===== [stained] sub_42C790  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_or_42C790
 * raw 行区间 [37607, 37616]; op=0x57 指令名『or』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_or_42C790(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 | v2);
}


/* ===== [stained] sub_42C7D0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_sar_42C7D0
 * raw 行区间 [37619, 37628]; op=0x58 指令名『sar』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_sar_42C7D0(_DWORD *_this)
{
  char v2; // di
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 >> v2);
}


/* ===== [stained] sub_42C820  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_shl_42C820
 * raw 行区间 [37631, 37640]; op=0x59 指令名『shl』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_shl_42C820(_DWORD *_this)
{
  char v2; // di
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 << v2);
}


/* ===== [stained] sub_42C870  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_eq_42C870
 * raw 行区间 [37643, 37652]; op=0x5A 指令名『eq』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_eq_42C870(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 == v2);
}


/* ===== [stained] sub_42C8C0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_ne_42C8C0
 * raw 行区间 [37655, 37664]; op=0x5B 指令名『ne』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_ne_42C8C0(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 != v2);
}


/* ===== [stained] sub_42C910  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_lt_42C910
 * raw 行区间 [37667, 37676]; op=0x5C 指令名『lt』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_lt_42C910(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 < v2);
}


/* ===== [stained] sub_42C960  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_lte_42C960
 * raw 行区间 [37679, 37688]; op=0x5D 指令名『lte』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_lte_42C960(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 <= v2);
}


/* ===== [stained] sub_42C9B0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_gt_42C9B0
 * raw 行区间 [37691, 37700]; op=0x5E 指令名『gr』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_gt_42C9B0(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 > v2);
}


/* ===== [stained] sub_42CA00  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_gte_42CA00
 * raw 行区间 [37703, 37712]; op=0x5F 指令名『gre』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_gte_42CA00(_DWORD *_this)
{
  int v2; // edi
  int v3; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = this->readIntOperand_41BF50( 2);
  return this->writeIntOperand_42B4B0( 1, v3 >= v2);
}


/* ===== [stained] sub_42CA50  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_random_42CA50
 * raw 行区间 [37715, 37737]; op=0x60 指令名『random』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_random_42CA50(char *_this)
{
  int v2; // ecx
  char *v3; // esi
  int pExceptionObject[2]; // [esp+4h] [ebp-8h] BYREF

  *(_DWORD *)&_this[120 * *((_DWORD *)_this + 95776) + 383220] = 5;
  if ( (int)++*((_DWORD *)_this + 107724) > 12 )
    *((_DWORD *)_this + 107724) = 0;
  dword_55D54C = rand();
  v2 = this->readIntOperand_41BF50( 2);
  dword_55D548 = v2;
  if ( !v2 )
  {
    this->writeIntOperand_42B4B0( 1, 0);
    v3 = _this + 8;
    sub_408050(v3, 1024, aRandom0);
    pExceptionObject[0] = (int)v3;
    pExceptionObject[1] = 65541;
    _CxxThrowException(pExceptionObject, &_TI1_AVCommand_ShowMessage_Exception__);
  }
  return this->writeIntOperand_42B4B0( 1, dword_55D54C % v2);
}

