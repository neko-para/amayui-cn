# -*- coding: utf-8 -*-
"""memmap.py -- VirtualQueryEx over the process, no admin needed for same-user.
Usage: python memmap.py <pid> [lo_hex] [hi_hex]
"""
import sys, ctypes
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
PID=int(sys.argv[1]) if len(sys.argv)>1 else 30624
LO=int(sys.argv[2],16) if len(sys.argv)>2 else 0
HI=int(sys.argv[3],16) if len(sys.argv)>3 else 0x7FFFFFFF
k=ctypes.WinDLL('kernel32',use_last_error=True)
class MBI(ctypes.Structure):
    _fields_=[("BaseAddress",ctypes.c_void_p),("AllocationBase",ctypes.c_void_p),
        ("AllocationProtect",wintypes.DWORD),("Alignment",wintypes.DWORD),
        ("RegionSize",ctypes.c_size_t),("State",wintypes.DWORD),
        ("Protect",wintypes.DWORD),("Type",wintypes.DWORD)]
k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.VirtualQueryEx.restype=ctypes.c_size_t; k.VirtualQueryEx.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.POINTER(MBI),ctypes.c_size_t]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h=k.OpenProcess(0x0400|0x0010,False,PID)
PROT={0x01:'NOACC',0x02:'R',0x04:'RW',0x08:'RCW',0x10:'RX',0x20:'RWX',0x40:'R-X',0x80:'RW-',0x100:'G',
      0x200:'W',0x400:'WCOPY',0x800:'EXEC',0x1000:'EXECR'}
STATE={0x1000:'COMMIT',0x2000:'RESERVE',0x10000:'FREE'}
TYPE={0:'NONE',0x10000:'IMAGE',0x20000:'MAPPED',0x40000:'PRIVATE'}
def protname(p):
    if p in PROT: return PROT[p]
    return 'p%02X'%p
a=LO
rows=[]
while a<HI:
    m=MBI()
    if k.VirtualQueryEx(h,ctypes.c_void_p(a),ctypes.byref(m),ctypes.sizeof(m))==0: break
    b=m.BaseAddress or 0; s=m.RegionSize or 0
    if s==0: break
    n=b+s
    if n<=a: n=a+0x1000
    if m.State==0x1000:  # committed
        rows.append((b,s,m.Protect,m.AllocationProtect,m.Type,m.State))
    a=n
print('committed regions %d..%d: %d'%(LO,HI,len(rows)))
for b,s,p,ap,typ,st in rows:
    print('  %08X..%08X  sz=%06X  prot=%s alloc=%s type=%s'%(b,b+s,s,protname(p),protname(ap),TYPE.get(typ,hex(typ))))
k.CloseHandle(h)
