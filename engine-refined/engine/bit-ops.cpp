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

/* ===== [stained] sub_42F8B0  状态: PARTIAL =====
 * Engine 成员函数  → op_bit_set_42F8B0
 * raw 行区间 [39402, 39421]; op=0x135 指令名『bit-set』
 * 分析结论（已读体）: if op2>0x1F(>=32): error-report (sprintf aSetbit + sub_4034D0) w/o writing op1; else op1 = op1 | (1<<op2) written back; 操作数类型=int/int; 操作数=[1:int/dest/in, 2:int/bit]; arity=5; evidence=v2=readInt(2); if(v2>0x1F){sub_408050(...aSetbit); sub_4034D0(...);} else {v4=readInt(1); writeIntOperand(1,(1<<v3)|v4);}; decEnc=true; pure=false
 * ⚠ 未分析被调: sub_4034D0；分析这些函数后方可标已分析
 */
void Engine::op_bit_set_42F8B0(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = this->readIntOperand_41BF50( 2);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(this->message_buf), 1024, aSetbit);
    this->sub_4034D0( (const char *)(this->message_buf));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 1);
    this->writeIntOperand_42B4B0( 1, (1 << v3) | v4);
  }
}


/* ===== [stained] sub_42F920  状态: PARTIAL =====
 * Engine 成员函数  → op_bit_reset_42F920
 * raw 行区间 [39424, 39443]; op=0x136 指令名『bit-reset』
 * 分析结论（已读体）: if op2>0x1F: error-report (sprintf aRembit + sub_4034D0); else op1 = op1 & ~(1<<op2) written back; 操作数类型=int/int; 操作数=[1:int/dest/in, 2:int/bit]; arity=5; evidence=v2=readInt(2); if(v2>0x1F){...aRembit...} else {v4=readInt(1); writeIntOperand(1,~(1<<v3)&v4);}; decEnc=true; pure=false
 * ⚠ 未分析被调: sub_4034D0；分析这些函数后方可标已分析
 */
void Engine::op_bit_reset_42F920(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  this->frames[this->cur_script].arity = 5;
  v2 = this->readIntOperand_41BF50( 2);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(this->message_buf), 1024, aRembit);
    this->sub_4034D0( (const char *)(this->message_buf));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 1);
    this->writeIntOperand_42B4B0( 1, ~(1 << v3) & v4);
  }
}


/* ===== [stained] sub_42FB40  状态: PARTIAL =====
 * Engine 成员函数  → op_check_bit_42FB40
 * raw 行区间 [39549, 39568]; op=0x13F 指令名『check-bit』
 * 分析结论（已读体）: if op3>0x1F: error-report (sprintf aGetbit + sub_4034D0); else op1 = ((1<<op3) & op2) != 0; 操作数类型=int/int/int; 操作数=[1:int/dest, 2:int/value, 3:int/bit]; arity=7; evidence=v2=readInt(3); if(v2>0x1F){...aGetbit...} else {v4=readInt(2); writeIntOperand(1,((1<<v3)&v4)!=0);}; decEnc=true; pure=false
 * ⚠ 未分析被调: sub_4034D0；分析这些函数后方可标已分析
 */
void Engine::op_check_bit_42FB40(int _this)
{
  unsigned int v2; // eax
  char v3; // di
  int v4; // eax

  this->frames[this->cur_script].arity = 7;
  v2 = this->readIntOperand_41BF50( 3);
  v3 = v2;
  if ( v2 > 0x1F )
  {
    sub_408050((char *)(this->message_buf), 1024, aGetbit);
    this->sub_4034D0( (const char *)(this->message_buf));
  }
  else
  {
    v4 = this->readIntOperand_41BF50( 2);
    this->writeIntOperand_42B4B0( 1, ((1 << v3) & v4) != 0);
  }
}

