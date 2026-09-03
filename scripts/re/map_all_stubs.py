# -*- coding: utf-8 -*-
"""map_all_stubs.py -- map EVERY runtime stub call site to its real imported API.
NO-drift model: runtime .text == file .text at the same RVA, EXCEPT each stub site's
`call <poly_thunk>` (E8 rel32, 5B) was changed to `call rel32->STUB` (5B) AND the byte
right after it (was a data/pad byte) — but the site RVA and the poly_thunk address are
recovered from the FILE at the same RVA. Then poly_thunk -> jmp [IATslot] -> resolver ->
import name via the unpacked import directory (or runtime IAT slot value -> module!func).

Output: JSON list {site_va, site_rva, file_rva, poly_thunk_va(0x5C3xxx), iat_slot,
                   import_name(from file IAT), rt_slot_val, rt_module}.
Usage: python map_all_stubs.py <pid> <stub_hex> [outjson]
"""
import sys, ctypes, struct, json
from ctypes import wintypes
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
sys.stdout.reconfigure(encoding='utf-8')
PID=int(sys.argv[1]); STUB=int(sys.argv[2],16)
OUT=sys.argv[3] if len(sys.argv)>3 else None
UNP=r'raw\AGE.EXE__dumped.EXE'
EB=0x400000; TEXT_RVA=0x1000; TEXT_SIZE=0x11C000

d=open(UNP,'rb').read()
e=struct.unpack_from('<I',d,0x3C)[0]
ns=struct.unpack_from('<H',d,e+6)[0]; osize=struct.unpack_from('<H',d,e+20)[0]; sd=e+4+20+osize
secs=[]
for i in range(ns):
    sh=d[sd+i*40:sd+i*40+40]
    vs,va,rs,ro=struct.unpack_from('<IIII',sh,8)
    secs.append((va,vs,ro,rs))
def rva2off(rva):
    for va,vs,ro,rs in secs:
        if va<=rva<va+vs: return ro+(rva-va)
    return None
filetext=d[rva2off(TEXT_RVA):rva2off(TEXT_RVA)+TEXT_SIZE].ljust(TEXT_SIZE,b'\x00')

# ---- build poly-thunk map: poly section RVA 0x1C3000 (VA 0x5C3000), rs=0x800 ----
poly={}   # va_lo -> iat_slot
poly_rva=0x1C3000
po=rva2off(poly_rva)
plen=0x800   # poly rs=0x800
seg=d[po:po+plen]
o=0
while o+8<=len(seg):
    if seg[o]==0xFF and seg[o+1]==0x25:
        slot=struct.unpack_from('<I',seg,o+2)[0]
        poly[0x5C3000+o]=slot
        o+=6
    elif seg[o]==0x83 and seg[o+1]==0xC4 and seg[o+2]==0x04 and seg[o+3]==0xFF and seg[o+4]==0x25:
        # add esp,4 ; jmp [slot]  (8 bytes)
        slot=struct.unpack_from('<I',seg,o+5)[0]
        poly[0x5C3000+o]=slot
        o+=8
    else:
        o+=1
print('poly thunk entries(0x5C3000+off->slot):',len(poly))

# ---- build IAT import map from file import dir: slot_va -> (dll,func) ----
def cstr(o):
    if o is None: return '?'
    j=o
    while j<len(d) and d[j]!=0: j+=1
    return d[o:j].decode('ascii','replace') if j<=len(d) else '?'
imp={}
opt=e+4+20
magic=struct.unpack_from('<H',d,opt)[0]
dd=opt+(96 if magic==0x10b else 112)
ir,isz=struct.unpack_from('<II',d,dd+8)
if ir:
    io=rva2off(ir)
    idx=0
    while True:
        oft,ts,fc,fname,ft = struct.unpack_from('<IIIII',d,io+idx*20)
        if oft==0 and ft==0: break
        # fname = RVA of DLL name string; ft = RVA of IAT (FirstThunk)
        dn=cstr(rva2off(fname))
        # walk the IAT (FirstThunk) list for slot addresses; use INT (oft) for names
        int_off=rva2off(oft) if oft else None
        ft_off=rva2off(ft)
        j=0
        while True:
            ival=struct.unpack_from('<I',d,ft_off+j*4)[0]
            if ival==0: break
            # name from INT if available, else from the IAT value itself
            name='?'
            if int_off is not None:
                nval=struct.unpack_from('<I',d,int_off+j*4)[0]
                if nval&0x80000000:
                    name='ord#%d'%(nval&0xFFFF)
                else:
                    no=rva2off(nval); name=cstr(no+2)
            else:
                if not (ival&0x80000000):
                    no=rva2off(ival); name=cstr(no+2)
                else:
                    name='ord#%d'%(ival&0xFFFF)
            slotva=EB+ft+j*4
            imp[slotva]=(dn,name)
            j+=1
        idx+=1
print('IAT slots parsed from file:',len(imp))

# runtime text
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.ReadProcessMemory.restype=wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h=k.OpenProcess(0x0400|0x0010,False,PID)
def rd(a,n,cap=0x1000):
    out=bytearray();dd=0
    while dd<n:
        m=min(cap,n-dd);b=ctypes.create_string_buffer(m);r=ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h,ctypes.c_void_p(a+dd),b,m,ctypes.byref(r)) or r.value==0:
            return bytes(out) if dd else None
        out+=b.raw[:r.value];dd+=r.value
    return bytes(out)
rt=rd(EB+TEXT_RVA,TEXT_SIZE) or b''
rt=rt.ljust(TEXT_SIZE,b'\x00')
def rdslot(slot):
    b=rd(slot,4)
    return struct.unpack('<I',b)[0] if b and len(b)>=4 else 0
k.CloseHandle(h)

def calltgt(buf,i):
    rel=struct.unpack('<i',buf[i+1:i+5])[0]
    return EB+TEXT_RVA+i+5+rel

# runtime stub sites
sites=[]
for i in range(len(rt)-5):
    if rt[i]==0xE8 and calltgt(rt,i)==STUB:
        sites.append(i)

results=[]
for i in sites:
    rva=TEXT_RVA+i
    site_va=EB+rva
    # file at same rva: call rel32 -> thunk
    fc=calltgt(filetext,i)
    thunk_va=fc if 0x5C3000<=fc<0x5C3800 else None
    # poly thunk -> slot
    slot=None
    if thunk_va and thunk_va in poly:
        slot=poly[thunk_va]
    # import name from file
    iname='?'
    if slot and (EB+ (slot-0x51C000)+ (0x51C000)) in imp:
        pass
    # file imp keys are slot VAs (EB+itor). slot is a VA already (0x51Dxxx)
    if slot and slot in imp:
        dn,fn=imp[slot]; iname='%s!%s'%(dn,fn)
    rv=rdslot(slot) if slot else 0
    results.append({'site_va':site_va,'site_rva':rva,'file_rva':rva,'thunk_va':thunk_va,
                    'slot':slot,'import':iname,'rt_slot_val':rv,
                    'rt_bytes':rt[i:i+5].hex(),'file_bytes':filetext[i:i+5].hex()})

print('\nstub sites mapped:',len(results))
print('with poly thunk:',sum(1 for r in results if r['thunk_va']))
print('with iat slot:',sum(1 for r in results if r['slot']))
print('named via file IAT:',sum(1 for r in results if r['import']!='?'))
print('\n%-4s %-10s %-10s %-8s %-8s %-24s %s'%('id','site_va','thunk','slot','rt_val','import','mod'))
def modof(a):
    mods=[]
    for line in open(r'.tmp\age_modules_30624.txt',encoding='utf-8'):
        p=line.rstrip('\n').split('|')
        if len(p)!=3: continue
        b,sz,nm=p; mods.append((int(b,16),int(sz or '0',16),nm))
    for b,sz,nm in sorted(mods):
        if b<=a<b+(sz or 0): return nm
    return '?'
for i,r in enumerate(results):
    mo=modof(r['rt_slot_val']) if r['rt_slot_val'] else '?'
    print('%-4d %-10X %-8X %-8X %08X %-24s %s'%(i,r['site_va'],r['thunk_va'] or 0,r['slot'] or 0,r['rt_slot_val'],r['import'] or '?',mo))
if OUT:
    json.dump({'stub':hex(STUB),'results':results},open(OUT,'w',encoding='utf-8'),indent=2,ensure_ascii=False)
    print('saved',OUT)
