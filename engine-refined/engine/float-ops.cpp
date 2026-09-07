/* =============================================================================
 * float-ops.cpp — 浮点指令（pure numeric-float）
 * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。
 * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。
 * 包含成员：9 个
 * 已分类 op：
  0x2D5 op_float_mov (sub_430C30)
  0x2D6 op_int_to_float (sub_430C70)
  0x2D7 op_float_to_int (sub_430CB0)
  0x2DF op_float_eq (sub_430E30)
  0x2E0 op_float_ne (sub_430EA0)
  0x2E1 op_float_lt (sub_430F10)
  0x2E2 op_float_lte (sub_430F80)
  0x2E3 op_float_gt (sub_430FF0)
  0x2E4 op_float_gte (sub_431060)
 * ============================================================================= */

/* ===== [stained] sub_430C30  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_mov_430C30
 * raw 行区间 [40176, 40183]; op=0x2D5 指令名『float-mov』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_mov_430C30(_DWORD *_this)
{
  float v3; // [esp+0h] [ebp-8h]

  this->frames[this->cur_script].arity = 5;
  v3 = this->readFloatOperand_41C300( 2);
  return this->writeFloatOperand_42BA00( 1, v3);
}


/* ===== [stained] sub_430C70  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_int_to_float_430C70
 * raw 行区间 [40186, 40193]; op=0x2D6
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_int_to_float_430C70(_DWORD *_this)
{
  float v3; // [esp+0h] [ebp-Ch]

  this->frames[this->cur_script].arity = 5;
  v3 = (float)this->readIntOperand_41BF50( 2);
  return this->writeFloatOperand_42BA00( 1, v3);
}


/* ===== [stained] sub_430CB0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_to_int_430CB0
 * raw 行区间 [40196, 40203]; op=0x2D7
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_to_int_430CB0(_DWORD *_this)
{
  double v2; // st7

  this->frames[this->cur_script].arity = 5;
  v2 = this->readFloatOperand_41C300( 2);
  return this->writeIntOperand_42B4B0( 1, (int)v2);
}


/* ===== [stained] sub_430E30  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_eq_430E30
 * raw 行区间 [40264, 40274]; op=0x2DF
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_eq_430E30(_DWORD *_this)
{
  double v2; // st6

  this->frames[this->cur_script].arity = 7;
  v2 = this->readFloatOperand_41C300( 2);
  if ( v2 == this->readFloatOperand_41C300( 3) )
    return this->writeIntOperand_42B4B0( 1, 1);
  else
    return this->writeIntOperand_42B4B0( 1, 0);
}


/* ===== [stained] sub_430EA0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_ne_430EA0
 * raw 行区间 [40277, 40287]; op=0x2E0
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_ne_430EA0(_DWORD *_this)
{
  double v2; // st6

  this->frames[this->cur_script].arity = 7;
  v2 = this->readFloatOperand_41C300( 2);
  if ( v2 == this->readFloatOperand_41C300( 3) )
    return this->writeIntOperand_42B4B0( 1, 0);
  else
    return this->writeIntOperand_42B4B0( 1, 1);
}


/* ===== [stained] sub_430F10  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_lt_430F10
 * raw 行区间 [40290, 40300]; op=0x2E1
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_lt_430F10(_DWORD *_this)
{
  double v3; // [esp+4h] [ebp-8h]

  this->frames[this->cur_script].arity = 7;
  v3 = this->readFloatOperand_41C300( 2);
  if ( this->readFloatOperand_41C300( 3) <= v3 )
    return this->writeIntOperand_42B4B0( 1, 0);
  else
    return this->writeIntOperand_42B4B0( 1, 1);
}


/* ===== [stained] sub_430F80  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_lte_430F80
 * raw 行区间 [40303, 40313]; op=0x2E2
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_lte_430F80(_DWORD *_this)
{
  double v3; // [esp+4h] [ebp-8h]

  this->frames[this->cur_script].arity = 7;
  v3 = this->readFloatOperand_41C300( 2);
  if ( this->readFloatOperand_41C300( 3) < v3 )
    return this->writeIntOperand_42B4B0( 1, 0);
  else
    return this->writeIntOperand_42B4B0( 1, 1);
}


/* ===== [stained] sub_430FF0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_gt_430FF0
 * raw 行区间 [40316, 40326]; op=0x2E3
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_gt_430FF0(_DWORD *_this)
{
  double v3; // [esp+4h] [ebp-8h]

  this->frames[this->cur_script].arity = 7;
  v3 = this->readFloatOperand_41C300( 2);
  if ( this->readFloatOperand_41C300( 3) >= v3 )
    return this->writeIntOperand_42B4B0( 1, 0);
  else
    return this->writeIntOperand_42B4B0( 1, 1);
}


/* ===== [stained] sub_431060  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_float_gte_431060
 * raw 行区间 [40329, 40339]; op=0x2E4
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_float_gte_431060(_DWORD *_this)
{
  double v3; // [esp+4h] [ebp-8h]

  this->frames[this->cur_script].arity = 7;
  v3 = this->readFloatOperand_41C300( 2);
  if ( this->readFloatOperand_41C300( 3) > v3 )
    return this->writeIntOperand_42B4B0( 1, 0);
  else
    return this->writeIntOperand_42B4B0( 1, 1);
}

