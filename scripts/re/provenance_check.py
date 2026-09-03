# -*- coding: utf-8 -*-
"""provenance_check.py -- decide what __dumped.EXE really is by comparing three artifacts
at the same addresses:
  LIVE process (30624) memory
  raw\\AGE.EXE__dumped.EXE   (the "dumped" file)
  raw\\天结_unpacked.exe      (true clean engine)
Questions:
  1) Does LIVE memory contain a jmp[IATslot] thunk table at 0x5C3000 (poly)?
  2) At business site RVA 0x1288, what do all three have?
  3) Is LIVE .text == __dumped .text (byte-identical), or do they differ only at call targets?
  4) Are the LIVE IAT slots readable/plain (resolvable) or encrypted?
"""
import struct, ctypes
from ctypes import wintypes
UNP=r'raw\天结_unpacked.exe'
DMP=r'raw\AGE.EXE__dumped.EXE'
EB=0x400000; TEXT_RVA=0x1000; TEXT_SIZE=0x11C000

def parse(path):
    d=open(path,'rb').read()
    e=struct.unpack_from('<I',d,0x3C)[0]
    ns=struct.unpack_from('<H',d,e+6)[0]; osize=struct.unpack_from('<H',d,e+20)[0]; sd=e+4+20+osize
    secs=[]
    for i in range(ns):
        sh=d[sd+i*40:sd+i*40+40]
        nm=sh[:8].rstrip(b'\x00').decode('latin1')
        vs,va,rs,ro=struct.unpack_from('<IIII',sh,8)
        secs.append({'nm':nm,'va':va,'vs':vs,'ro':ro,'rs':rs})
    return d,secs
def r2o(secs,rva):
    for s in secs:
        if s['va']<=rva<s['va']+s['vs']: return s['ro']+(rva-s['va'])
    return None

# ---- live read ----
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.ReadProcessMemory.restype=wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h=k.OpenProcess(0x0400|0x0010,False,30624)
def rd(a,n,cap=0x1000):
    out=bytearray();dd=0
    while dd<n:
        m=min(cap,n-dd);b=ctypes.create_string_buffer(m);r=ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h,ctypes.c_void_p(a+dd),b,m,ctypes.byref(r)) or r.value==0:
            return bytes(out) if dd else None
        out+=b.raw[:r.value];dd+=r.value
    return bytes(out)
lt=rd(EB+TEXT_RVA,TEXT_SIZE) or b''; lt=lt.ljust(TEXT_SIZE,b'\x00')
poly_live=rd(0x5C3000,0x800)
slot0=rd(0x51D110,4); slot1=rd(0x51D150,4)
k.CloseHandle(h)

dd,dsecs=parse(DMP); du,usecs=parse(UNP)

def ft_of(d,secs):
    o=r2o(secs,TEXT_RVA)
    return d[o:o+TEXT_SIZE].ljust(TEXT_SIZE,b'\x00')
fD=ft_of(dd,dsecs); fU=ft_of(du,usecs)

print('=== Q1: does LIVE memory have jmp[IATslot] at poly 0x5C3000? ===')
print('  live @0x5C3000 first 24B:', (poly_live[:24].hex() if poly_live else 'NOT READABLE'))
print('  dumped @poly 0x5C3000 :', dd[r2o(dsecs,0x1C3000):r2o(dsecs,0x1C3000)+24].hex() if r2o(dsecs,0x1C3000) else '?')

print('\n=== Q2: business site RVA 0x1288 ===')
print('  live   :', lt[0x1288-0x1000:0x1288-0x1000+8].hex())
print('  dumped :', fD[0x1288-0x1000:0x1288-0x1000+8].hex())
print('  unpack :', fU[0x1288-0x1000:0x1288-0x1000+8].hex())

print('\n=== Q3: is LIVE .text == Dumped .text? (byte count) ===')
eq=sum(1 for i in range(TEXT_SIZE) if lt[i]==fD[i])
print('  equal bytes live-vs-dumped: %d/%d  diff=%d'%(eq,TEXT_SIZE,TEXT_SIZE-eq))

print('\n=== Q4: LIVE IAT slot values (readable or encrypted?) ===')
sv0=struct.unpack('<I',slot0)[0] if slot0 and len(slot0)>=4 else 0
sv1=struct.unpack('<I',slot1)[0] if slot1 and len(slot1)>=4 else 0
print('  live [0x51D110]=%08X   live [0x51D150]=%08X'%(sv0,sv1))
print('  (sanely in a module? 0x51D110 decodes to: %X -> 0x51D150 slot ->') 
# resolve what dumped says for these slots
print('  dumped .idata slot0/1 names present (see earlier map)')

print('\n=== Q5: live .text vs UNPACK .text (the real clean engine) ===')
eq2=sum(1 for i in range(TEXT_SIZE) if lt[i]==fU[i])
print('  equal bytes live-vs-unpacked: %d/%d  diff=%d'%(eq2,TEXT_SIZE,TEXT_SIZE-eq2))
