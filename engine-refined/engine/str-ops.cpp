/* =============================================================================
 * str-ops.cpp — 字符串指令（pure string）
 * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。
 * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。
 * 包含成员：6 个
 * 已分类 op：
  0x1A6 op_halve_strlen (sub_42D110)
  0x1A3 op_string_lookup_set (sub_42DF40)
  0x2C5 op_strlen (sub_430900)
  0x192 op_set_string (sub_433660)
  0x193 op_concat (sub_433710)
  0x1C8 op_to_string (sub_433820)
 * ============================================================================= */

/* ===== [stained] sub_42D110  状态: PARTIAL =====
 * Engine 成员函数  → op_halve_strlen_42D110
 * raw 行区间 [37975, 37982]; op=0x1A6 指令名『halve-strlen』
 * 分析结论（已读体）: op1 = strlen(op2) >> 1  (halved byte length); 操作数类型=int/string(SSO); 操作数=[1:int/dest, 2:string(SSO)/src]; arity=5; evidence=v2=strlen(sub_41B640(2)); return writeIntOperand_42B4B0(1, v2>>1); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_41B640（未命名/未分析）；分析后方可标已分析
 */
int Engine::op_halve_strlen_42D110(_DWORD *_this)
{
  unsigned int v2; // kr00_4

  this->frames[this->cur_script].arity = 5;
  v2 = strlen(this->sub_41B640( 2));
  return this->writeIntOperand_42B4B0( 1, v2 >> 1);
}


/* ===== [stained] sub_42DF40  状态: PARTIAL =====
 * Engine 成员函数  → op_string_lookup_set_42DF40
 * raw 行区间 [38443, 38459]; op=0x1A3 指令名『string-lookup-set』
 * 分析结论（已读体）: read op1 value, wsprintf "%c%8.8x", look up in engine global string table (_this+5452) via sub_428E00, write op1 = associated int; returns looked-up value (or 0); 操作数类型=int; 操作数=[1:int/dest/in]; arity=3; evidence=v2=sub_418A30(1); wsprintfA(v6,"%c%8.8x",3,v2); v3=sub_428E00(_this+5452,v6); if(v3)v4=*v3; else v4=0; writeIntOperand(1,v4); decEnc=false; pure=false
 * ⚠ 未分析被调: sub_428E00；分析这些函数后方可标已分析
 */
int Engine::op_string_lookup_set_42DF40(_DWORD *_this)
{
  int v2; // eax
  int *v3; // eax
  int v4; // eax
  char v6[12]; // [esp+4h] [ebp-10h] BYREF

  this->frames[this->cur_script].arity = 3;
  v2 = this->sub_418A30( 1);
  wsprintfA(v6, "%c%8.8x", 3, v2);
  v3 = (int *)sub_428E00(this->string_table_base, v6);
  if ( v3 )
    v4 = *v3;
  else
    v4 = 0;
  return this->writeIntOperand_42B4B0( 1, v4);
}


/* ===== [stained] sub_430900  状态: PARTIAL =====
 * Engine 成员函数  → op_strlen_430900
 * raw 行区间 [40064, 40071]; op=0x2C5 指令名『strlen』
 * 分析结论（已读体）: op1 = strlen(op2)  (sub_41B640 reads SSO string); byte length; 操作数类型=int/string(SSO); 操作数=[1:int/dest, 2:string(SSO)/src]; arity=5; evidence=v2=strlen(sub_41B640(2)); return writeIntOperand_42B4B0(1,v2); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_41B640（未命名/未分析）；分析后方可标已分析
 */
int Engine::op_strlen_430900(_DWORD *_this)
{
  int v2; // kr00_4

  this->frames[this->cur_script].arity = 5;
  v2 = strlen(this->sub_41B640( 2));
  return this->writeIntOperand_42B4B0( 1, v2);
}


/* ===== [stained] sub_433660  状态: PARTIAL =====
 * Engine 成员函数  → op_set_string_433660
 * raw 行区间 [41936, 41949]; op=0x192 指令名『set-string』
 * 分析结论（已读体）: op1(SSO) = op2(SSO); string copy via sub_42A420(read op2) + sub_433310(write op1); 操作数类型=string(SSO)/string(SSO); 操作数=[1:string(SSO)/dest, 2:string(SSO)/src]; arity=5; evidence=v2=sub_42A420(v3,2); sub_433310(1,(int)v2); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42A420, sub_433310（未命名/未分析）；分析后方可标已分析
 */
void Engine::op_set_string_433660(_DWORD *_this)
{
  _DWORD *v2; // eax
  void *v3[7]; // [esp+8h] [ebp-2Ch] BYREF
  int v4; // [esp+30h] [ebp-4h]

  this->frames[this->cur_script].arity = 5;
  v2 = this->sub_42A420( v3, 2);
  v4 = 0;
  this->sub_433310( 1, (int)v2);
  v4 = -1;
  if ( v3[5] >= (void *)0x10 )
    operator delete(v3[0]);
}


/* ===== [stained] sub_433710  状态: PARTIAL =====
 * Engine 成员函数  → op_concat_433710
 * raw 行区间 [41952, 41987]; op=0x193 指令名『concat』
 * 分析结论（已读体）: op1(SSO) = op2(SSO) + op3(SSO); string concat via sub_42AA90 + sub_433310(write op1); 操作数类型=string(SSO)/string(SSO)/string(SSO); 操作数=[1:string(SSO)/dest, 2:string(SSO)/src, 3:string(SSO)/src]; arity=7; evidence=v2=sub_42A420(v5,3); v3=sub_42A420(v8,2); v4=sub_42AA90(v6,v3,v2); sub_433310(1,(int)v4); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_42A420, sub_42AA90, sub_433310（未命名/未分析）；分析这些函数后方可标已分析
 */
void Engine::op_concat_433710(_DWORD *_this)
{
  _DWORD *v2; // edi
  _DWORD *v3; // eax
  _DWORD *v4; // eax
  void *v5[7]; // [esp+10h] [ebp-64h] BYREF
  void *v6[5]; // [esp+2Ch] [ebp-48h] BYREF
  unsigned int v7; // [esp+40h] [ebp-34h]
  void *v8[5]; // [esp+48h] [ebp-2Ch] BYREF
  unsigned int v9; // [esp+5Ch] [ebp-18h]
  int v10; // [esp+70h] [ebp-4h]

  this->frames[this->cur_script].arity = 7;
  v2 = this->sub_42A420( v5, 3);
  v10 = 0;
  v3 = this->sub_42A420( v8, 2);
  LOBYTE(v10) = 1;
  v4 = sub_42AA90(v6, v3, v2);
  LOBYTE(v10) = 2;
  this->sub_433310( 1, (int)v4);
  LOBYTE(v10) = 1;
  if ( v7 >= 0x10 )
    operator delete(v6[0]);
  v7 = 15;
  v6[4] = 0;
  LOBYTE(v6[0]) = 0;
  LOBYTE(v10) = 0;
  if ( v9 >= 0x10 )
    operator delete(v8[0]);
  v9 = 15;
  v8[4] = 0;
  LOBYTE(v8[0]) = 0;
  v10 = -1;
  if ( v5[5] >= (void *)0x10 )
    operator delete(v5[0]);
}


/* ===== [stained] sub_433820  状态: PARTIAL =====
 * Engine 成员函数  → op_toString_433820
 * raw 行区间 [41990, 42010]; op=0x1C8 指令名『toString』
 * 分析结论（已读体）: op1(SSO) = sprintf("%d", op2)  (int -> decimal string); via sub_408050 + sub_433310; 操作数类型=string(SSO)/int; 操作数=[1:string(SSO)/dest, 2:int/src]; arity=5; evidence=v2=readInt(2); sub_408050(Buffer,256,"%d",v2); ... sub_433310(1,(int)v3); decEnc=false; pure=true
 * ⚠ 未分析被调: sub_408050, sub_40C210, sub_433310（未命名/未分析）；分析后方可标已分析
 */
void Engine::op_toString_433820(_DWORD *_this)
{
  int v2; // eax
  void *v3[5]; // [esp+Ch] [ebp-12Ch] BYREF
  unsigned int v4; // [esp+20h] [ebp-118h]
  char Buffer[256]; // [esp+28h] [ebp-110h] BYREF
  int v6; // [esp+134h] [ebp-4h]

  this->frames[this->cur_script].arity = 5;
  v2 = this->readIntOperand_41BF50( 2);
  sub_408050(Buffer, 256, "%d", v2);
  v4 = 15;
  v3[4] = 0;
  LOBYTE(v3[0]) = 0;
  sub_40C210((int)v3, Buffer, strlen(Buffer));
  v6 = 0;
  this->sub_433310( 1, (int)v3);
  v6 = -1;
  if ( v4 >= 0x10 )
    operator delete(v3[0]);
}

