# -*- coding: utf-8 -*-
"""tool_independence.py -- verify that the trampoline (poly thunk) is a ROUTING artifact of
a given unpack tool, NOT a change to which function each call site invokes.
Compare two DIFFERENT unpack products of the same packed AGE:
  D = raw\\AGE.EXE__dumped.EXE      (tool A: 289 per-site `call->poly_thunk>jmp[IATslot]`)
  U = raw\\天结_unpacked.exe         (tool B + 汉化修改: 0 thunk, all `call [IATslot]` direct)
Claim to test: every import name reached via D's poly-thunk table is ALSO reachable as a
direct `call [IAT slot]` in U (i.e., the thunk injects no NEW import semantics; it only
routes existing calls through a table).
"""
import struct, collections
D=r'raw\AGE.EXE__dumped.EXE'
U=r'raw\天结_unpacked.exe'
EB=0x400000; T=0x1000; TS=0x11C000
def load(p):
    d=open(p,'rb').read()
    e=struct.unpack_from('<I',d,0x3C)[0]
    ns=struct.unpack_from('<H',d,e+6)[0]; osz=struct.unpack_from('<H',d,e+20)[0]; sd=e+4+20+osz
    secs=[]
    for i in range(ns):
        sh=d[sd+i*40:sd+i*40+40]
        nm=sh[:8].rstrip(b'\x00').decode('latin1'); vs,va,rs,ro=struct.unpack_from('<IIII',sh,8)
        secs.append((va,vs,ro,rs,nm))
    return d,secs
def r2o(secs,rva):
    for va,vs,ro,rs,nm in secs:
        if va<=rva<va+vs: return ro+(rva-va)
    return None
def text(d,secs):
    o=r2o(secs,T)
    return d[o:o+TS].ljust(TS,b'\x00')
# IAT import name map: slot_va(file) -> (dll,func) via import dir
def iatmap(p):
    d,secs=load(p)
    e=struct.unpack_from('<I',d,0x3C)[0]; opt=e+4+20
    magic=struct.unpack_from('<H',d,opt)[0]; dd=opt+(96 if magic==0x10b else 112)
    ir,isz=struct.unpack_from('<II',d,dd+8)
    def cstr(o):
        if o is None: return '?'
        j=o
        while j<len(d) and d[j]!=0: j+=1
        return d[o:j].decode('ascii','replace') if j<=len(d) else '?'
    imp={}
    if ir:
        io=r2o(secs,ir); idx=0
        while True:
            oft,ts,fc,fname,ft=struct.unpack_from('<IIIII',d,io+idx*20)
            if oft==0 and ft==0: break
            dn=cstr(r2o(secs,fname))
            ft_off=r2o(secs,ft); int_off=r2o(secs,oft) if oft else None
            j=0
            while True:
                ival=struct.unpack_from('<I',d,ft_off+j*4)[0]
                if ival==0: break
                name='?'
                if int_off is not None:
                    nv=struct.unpack_from('<I',d,int_off+j*4)[0]
                    name=('ord#%d'%(nv&0xFFFF)) if (nv&0x80000000) else cstr(r2o(secs,nv)+2)
                elif not (ival&0x80000000):
                    name=cstr(r2o(secs,ival)+2)
                else:
                    name='ord#%d'%(ival&0xFFFF)
                imp[EB+ft+j*4]=(dn,name)
                j+=1
            idx+=1
    return imp
impD=iatmap(D); impU=iatmap(U)
print('import slots parsed  D=%d  U=%d'%(len(impD),len(impU)))
dD,_=load(D); dU,_=load(U); tD=text(dD,_); tU=text(dU,_)
SLOT_LO=0x51C000; SLOT_HI=0x51E000
def direct_slots(buf):
    # call [IATslot] = FF 15 [+disp32 slot]
    s=set()
    for i in range(len(buf)-6):
        if buf[i]==0xFF and buf[i+1]==0x15:
            sl=struct.unpack_from('<I',buf,i+2)[0]
            if SLOT_LO<=sl<SLOT_HI: s.add(sl)
    return s
def direct_poly(buf):
    # call rel32 -> [thunk] ; resolve each thunk's jmp[slot]
    res=set(); poly=[]
    po=None
    # build poly slot map from D
    return res,poly
slotsD=direct_slots(tD); slotsU=direct_slots(tU)
print('direct call[IAT slot] count  D=%d  U=%d'%(len(slotsD),len(slotsU)))
# In D: slots reached via poly thunk table
dD2,_=load(D)
po=r2o(_,0x1C3000); seg=dD2[po:po+0x800]
poly_slots=set(); o=0
while o+8<=len(seg):
    if seg[o]==0xFF and seg[o+1]==0x25:
        poly_slots.add(struct.unpack_from('<I',seg,o+2)[0]); o+=6
    elif seg[o]==0x83 and seg[o+2]==0x04 and seg[o+3]==0xFF and seg[o+4]==0x25:
        poly_slots.add(struct.unpack_from('<I',seg,o+5)[0]); o+=8
    else: o+=1
print('D poly-thunk table reaches %d distinct slots'%len(poly_slots))
print('  are those slots also present as direct call[IAT] in U?')
missing=[s for s in poly_slots if s not in slotsU and s in impU]
print('  poly slots whose func is NOT directly-called in U(in IAT):',len(missing))
for s in missing[:10]: print('     slot %08X = %s'%(s,impU.get(s)))
# names comparison: import FUNCTION NAMES reachable
def names(slots,imp):
    return set(imp.get(s,('?','?'))[1] for s in slots)
nD=names(slotsD|poly_slots,impD); nU=names(slotsU,impU)
print('\nfunction-name set reachable in D(direct+poly)=%d  in U=%d'%(len(nD),len(nU)))
onlyD=nD-nU; onlyU=nU-nD
print('funcs only in D:',sorted(onlyD))
print('funcs only in U:',sorted(onlyU))
