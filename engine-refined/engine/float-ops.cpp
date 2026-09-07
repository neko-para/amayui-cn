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
 * Engine 成员函数  → op_float_mov_430C30
 * raw 行区间 [40176, 40183]; op=0x2D5 指令名『float-mov』
 * 分析结论（已读体）: op1(float) = op2(float); float move; 操作数类型=float/float; 操作数=[1:float/dest, 2:float/src]; arity=5; evidence=v3=readFloatOperand(2); return writeFloatOperand_42BA00(1,v3); decEnc=false; pure=true
 */
int Engine::op_float_mov_430C30(_DWORD *_this)
{
  float v3; // [esp+0h] [ebp-8h]

  this->frames[this->cur_script].arity = 5;
  v3 = this->readFloatOperand_41C300( 2);
  return this->writeFloatOperand_42BA00( 1, v3);
}


/* ===== [stained] sub_430C70  状态: ANALYZED =====
 * Engine 成员函数  → op_int_to_float_430C70
 * raw 行区间 [40186, 40193]; op=0x2D6
 * 分析结论（已读体）: op1(float) = (float)op2(int); int->float cast; 操作数类型=float/int; 操作数=[1:float/dest, 2:int/src]; arity=5; evidence=v3=(float)readIntOperand(2); return writeFloatOperand_42BA00(1,v3); decEnc=false; pure=true
 */
int Engine::op_int_to_float_430C70(_DWORD *_this)
{
  float v3; // [esp+0h] [ebp-Ch]

  this->frames[this->cur_script].arity = 5;
  v3 = (float)this->readIntOperand_41BF50( 2);
  return this->writeFloatOperand_42BA00( 1, v3);
}


/* ===== [stained] sub_430CB0  状态: ANALYZED =====
 * Engine 成员函数  → op_float_to_int_430CB0
 * raw 行区间 [40196, 40203]; op=0x2D7
 * 分析结论（已读体）: op1(int) = (int)op2(float)  (truncating); float->int cast; 操作数类型=int/float; 操作数=[1:int/dest, 2:float/src]; arity=5; evidence=v2=readFloatOperand(2); return writeIntOperand_42B4B0(1,(int)v2); decEnc=false; pure=true
 */
int Engine::op_float_to_int_430CB0(_DWORD *_this)
{
  double v2; // st7

  this->frames[this->cur_script].arity = 5;
  v2 = this->readFloatOperand_41C300( 2);
  return this->writeIntOperand_42B4B0( 1, (int)v2);
}


/* ===== [stained] sub_430E30  状态: ANALYZED =====
 * Engine 成员函数  → op_float_eq_430E30
 * raw 行区间 [40264, 40274]; op=0x2DF
 * 分析结论（已读体）: op1 = (op2 == op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v2=readFloat(2); if(v2==readFloat(3)) writeIntOperand(1,1); else writeIntOperand(1,0); decEnc=false; pure=true
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
 * Engine 成员函数  → op_float_ne_430EA0
 * raw 行区间 [40277, 40287]; op=0x2E0
 * 分析结论（已读体）: op1 = (op2 != op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v2=readFloat(2); if(v2==readFloat(3)) writeIntOperand(1,0); else writeIntOperand(1,1); decEnc=false; pure=true
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
 * Engine 成员函数  → op_float_lt_430F10
 * raw 行区间 [40290, 40300]; op=0x2E1
 * 分析结论（已读体）: op1 = (op2 < op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v3=readFloat(2); if(readFloat(3)<=v3) writeIntOperand(1,0); else writeIntOperand(1,1); decEnc=false; pure=true
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
 * Engine 成员函数  → op_float_lte_430F80
 * raw 行区间 [40303, 40313]; op=0x2E2
 * 分析结论（已读体）: op1 = (op2 <= op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v3=readFloat(2); if(readFloat(3)<v3) writeIntOperand(1,0); else writeIntOperand(1,1); decEnc=false; pure=true
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
 * Engine 成员函数  → op_float_gt_430FF0
 * raw 行区间 [40316, 40326]; op=0x2E3
 * 分析结论（已读体）: op1 = (op2 > op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v3=readFloat(2); if(readFloat(3)>=v3) writeIntOperand(1,0); else writeIntOperand(1,1); decEnc=false; pure=true
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
 * Engine 成员函数  → op_float_gte_431060
 * raw 行区间 [40329, 40339]; op=0x2E4
 * 分析结论（已读体）: op1 = (op2 >= op3) ? 1 : 0; 操作数类型=int/float/float; 操作数=[1:int/dest, 2:float/src, 3:float/src]; arity=7; evidence=v3=readFloat(2); if(readFloat(3)>v3) writeIntOperand(1,0); else writeIntOperand(1,1); decEnc=false; pure=true
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

