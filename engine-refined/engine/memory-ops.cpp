/* =============================================================================
 * memory-ops.cpp — 数组/索引/取地址(lea)指令（memory/ptr）
 * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。
 * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。
 * 包含成员：7 个
 * 已分类 op：
  0x61 op_lookup_array (sub_42CB00)
  0x63 op_lea (sub_42CBA0)
  0x64 op_copy_local_array (sub_42CBE0)
  0x6C op_fill_zero (sub_42CE70)
  0x1B0 op_memcpy (sub_42D150)
  0x12C op_lookup_array_2d (sub_42EFD0)
  0x2D8 op_set_array_to (sub_430CF0)
 * ============================================================================= */

/* ===== [stained] sub_42CB00  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_lookup_array_42CB00
 * raw 行区间 [37742, 37751]; op=0x61 指令名『lookup-array』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_lookup_array_42CB00(_DWORD *_this)
{
  int v2; // eax
  int v4; // [esp-Ch] [ebp-18h]

  this->frames[this->cur_script].arity = 7;
  v4 = this->readIntOperand_41BF50( 3);
  v2 = this->operandAddress_42AEA0( 2);
  return this->sub_418CC0( 1, v2, v4, -1, -1);
}


/* ===== [stained] sub_42CBA0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_lea_42CBA0
 * raw 行区间 [37766, 37773]; op=0x63 指令名『lea』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_lea_42CBA0(_DWORD *_this)
{
  int v2; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = this->operandAddress_42AEA0( 2);
  return this->writePointerOperand_418B90( 1, v2, -1, -1);
}


/* ===== [stained] sub_42CBE0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_copy_local_array_42CBE0
 * raw 行区间 [37776, 37801]; op=0x64 指令名『copy-local-array』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_copy_local_array_42CBE0(_DWORD *_this)
{
  int *v2; // edi
  int v3; // ebx
  int result; // eax
  int v5; // ecx
  int v6; // edx

  this->frames[this->cur_script].arity = 5;
  v2 = (int *)this->operandAddress_42AEA0( 1);
  v3 = this->frames[this->cur_script].str_table + 4 * this->readIntOperand_41BF50( 2) + 4;
  result = *(_DWORD *)(this->frames[this->cur_script].str_table + 4 * this->readIntOperand_41BF50( 2));
  if ( result > 0 )
  {
    v5 = v3 - (_DWORD)v2;
    v6 = result;
    do
    {
      result = __ROL4__(this->key ^ __ROR4__(*(int *)((char *)v2 + v5), 7), 21);
      *v2++ = result;
      --v6;
    }
    while ( v6 );
  }
  return result;
}


/* ===== [stained] sub_42CE70  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_fill_zero_42CE70
 * raw 行区间 [37876, 37894]; op=0x6C 指令名『fill-zero』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_fill_zero_42CE70(_DWORD *_this)
{
  _DWORD *v2; // edi
  int result; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = (_DWORD *)this->operandAddress_42AEA0( 1);
  result = this->readIntOperand_41BF50( 2);
  if ( result > 0 )
  {
    do
    {
      *v2++ = _this[97060];
      --result;
    }
    while ( result );
  }
  return result;
}


/* ===== [stained] sub_42D150  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_memcpy_42D150
 * raw 行区间 [37985, 37996]; op=0x1B0 指令名『memcpy』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
void * Engine::op_memcpy_42D150(_DWORD *_this)
{
  void *v2; // eax
  const void *v4; // [esp-8h] [ebp-Ch]
  size_t v5; // [esp-4h] [ebp-8h]

  this->frames[this->cur_script].arity = 7;
  v5 = 4 * this->readIntOperand_41BF50( 3);
  v4 = (const void *)this->operandAddress_42AEA0( 1);
  v2 = (void *)this->operandAddress_42AEA0( 2);
  return memcpy(v2, v4, v5);
}


/* ===== [stained] sub_42EFD0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_lookup_array_2d_42EFD0
 * raw 行区间 [39137, 39150]; op=0x12C 指令名『lookup-array-2d』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_lookup_array_2d_42EFD0(_DWORD *_this)
{
  int v2; // edi
  int v3; // edi
  int v4; // eax
  int v6; // [esp-Ch] [ebp-20h]

  this->frames[this->cur_script].arity = 11;
  v2 = this->readIntOperand_41BF50( 4);
  v3 = this->readIntOperand_41BF50( 3) * v2;
  v6 = v3 + this->readIntOperand_41BF50( 5);
  v4 = this->operandAddress_42AEA0( 2);
  return this->sub_418CC0( 1, v4, v6, -1, -1);
}


/* ===== [stained] sub_430CF0  状态: ANALYZED =====
 * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → op_set_array_to_430CF0
 * raw 行区间 [40206, 40224]; op=0x2D8 指令名『set-array-to』
 * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。
 */
int Engine::op_set_array_to_430CF0(_DWORD *_this)
{
  void *v2; // edi
  int result; // eax
  unsigned int v4; // ecx
  int v5; // [esp+Ch] [ebp-4h]

  this->frames[this->cur_script].arity = 7;
  v2 = (void *)this->operandAddress_42AEA0( 1);
  v5 = __ROL4__(this->key ^ __ROR4__(this->readIntOperand_41BF50( 2), 7), 21);
  result = this->readIntOperand_41BF50( 3);
  if ( result > 0 )
  {
    v4 = result;
    result = v5;
    memset32(v2, v5, v4);
  }
  return result;
}

