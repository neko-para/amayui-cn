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

/* ===== [stained] sub_42CB00  状态: PARTIAL =====
 * Engine 成员函数  → op_lookup_array_42CB00
 * raw 行区间 [37742, 37751]; op=0x61 指令名『lookup-array』
 * 分析结论（已读体）: op1 = &op2[op3]  (element address; index=readInt(op3), base=operandAddress(op2)); op1 written via sub_418CC0 type-tagged; 操作数类型=ptr/array/int; 操作数=[1:ptr/dest, 2:array/src(base), 3:int/index]; arity=7; evidence=v4=readIntOperand(3); v2=operandAddress(2); return sub_418CC0(1, v2, v4, -1, -1); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42AEA0, sub_418CC0（未命名/未分析）；分析后方可标已分析
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


/* ===== [stained] sub_42CBA0  状态: PARTIAL =====
 * Engine 成员函数  → op_lea_42CBA0
 * raw 行区间 [37766, 37773]; op=0x63 指令名『lea』
 * 分析结论（已读体）: op1 = &op2 (address of operand 2), stored as pointer operand; 操作数类型=ptr/any; 操作数=[1:ptr/dest, 2:any/src-address]; arity=5; evidence=v2=operandAddress(2); return writePointerOperand_418B90(1, v2, -1, -1); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42AEA0, sub_418B90（未命名/未分析）；分析后方可标已分析
 */
int Engine::op_lea_42CBA0(_DWORD *_this)
{
  int v2; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = this->operandAddress_42AEA0( 2);
  return this->writePointerOperand_418B90( 1, v2, -1, -1);
}


/* ===== [stained] sub_42CBE0  状态: PARTIAL =====
 * Engine 成员函数  → op_copy_local_array_42CBE0
 * raw 行区间 [37776, 37801]; op=0x64 指令名『copy-local-array』
 * 分析结论（已读体）: copy local array: from frames[cur_script].str_table[idx] (count=*(str_table+4*idx)) into op1 array, each element dec/enc-transformed (ROL4(key^ROR4(v,7),21)); op1 array memory written; 操作数类型=array/int; 操作数=[1:array/dest, 2:int/index]; arity=5; evidence=v2=operandAddress(1); result=*(str_table+4*readInt(2)); do result=__ROL4__(key^__ROR4__(*(v2+v5),7),21); *v2++=result; while(--v6); decEnc=true; pure=true
 * ⚠ 未分析被调: sub_42AEA0（未命名/未分析）；分析后方可标已分析
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


/* ===== [stained] sub_42CE70  状态: PARTIAL =====
 * Engine 成员函数  → op_fill_zero_42CE70
 * raw 行区间 [37876, 37894]; op=0x6C 指令名『fill-zero』
 * 分析结论（已读体）: fill op1 array[0..op2-1] with the constant stored at engine global offset 388240 (_this[97060]); op1 array memory written; 操作数类型=array/int; 操作数=[1:array/dest, 2:int/count]; arity=5; evidence=v2=operandAddress(1); result=readInt(2); do *v2++=_this[97060]; while(--result); decEnc=false; pure=false
 * ⚠ 未分析被调: sub_42AEA0（未命名/未分析）；分析后方可标已分析
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
      *v2++ = this->enc_zero;
      --result;
    }
    while ( result );
  }
  return result;
}


/* ===== [stained] sub_42D150  状态: PARTIAL =====
 * Engine 成员函数  → op_memcpy_42D150
 * raw 行区间 [37985, 37996]; op=0x1B0 指令名『memcpy』
 * 分析结论（已读体）: memcpy(dest=op2, src=op1, n=4*op3) — raw byte copy of op3 32-bit elements from op1 to op2; no dec/enc transform applied; 操作数类型=array/array/int; 操作数=[1:array/src, 2:array/dest, 3:int/count]; arity=7; evidence=v5=4*readInt(3); v4=operandAddress(1); v2=operandAddress(2); return memcpy(v2,v4,v5); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42AEA0（未命名/未分析）；分析后方可标已分析
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


/* ===== [stained] sub_42EFD0  状态: PARTIAL =====
 * Engine 成员函数  → op_lookup_array_2d_42EFD0
 * raw 行区间 [39137, 39150]; op=0x12C 指令名『lookup-array-2d』
 * 分析结论（已读体）: op1 = &op2[ op3*op4 + op5 ]  (2-D element address); op1 written type-tagged via sub_418CC0; 操作数类型=ptr/array/int/int/int; 操作数=[1:ptr/dest, 2:array/src(base), 3:int/row, 4:int/col-dim, 5:int/col]; arity=11; evidence=v2=readInt(4); v3=readInt(3)*v2; v6=v3+readInt(5); v4=operandAddress(2); return sub_418CC0(1,v4,v6,-1,-1); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42AEA0, sub_418CC0（未命名/未分析）；分析后方可标已分析
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


/* ===== [stained] sub_430CF0  状态: PARTIAL =====
 * Engine 成员函数  → op_set_array_to_430CF0
 * raw 行区间 [40206, 40224]; op=0x2D8 指令名『set-array-to』
 * 分析结论（已读体）: fill op1 array[0..op3-1] with DEC-encoded value of op2 (memset32), where D(v)=ROL4(key^ROR4(v,7),21); op1 array memory written; 操作数类型=array/int/int; 操作数=[1:array/dest, 2:int/value, 3:int/count]; arity=7; evidence=v2=operandAddress(1); v5=__ROL4__(key^__ROR4__(readInt(2),7),21); result=readInt(3); memset32(v2,v5,result); decEnc=true; pure=true
 * ⚠ 未分析被调: sub_42AEA0（未命名/未分析）；分析后方可标已分析
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

