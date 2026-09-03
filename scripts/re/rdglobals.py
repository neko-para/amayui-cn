# -*- coding: utf-8 -*-
"""rdglobals.py -- read a set of global VA values from the process.
Usage: python rdglobals.py <pid> <va_hex> [va_hex ...]
Each reads 4 bytes (dword) and 8 bytes. Optionally follow pointer chain with -d <depth>.
"""
import sys, ctypes
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
PID=int(sys.argv[1])
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.ReadProcessMemory.restype=wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h=k.OpenProcess(0x0400|0x0010,False,PID)
def rd(a,n):
    b=ctypes.create_string_buffer(n); r=ctypes.c_size_t(0)
    if not k.ReadProcessMemory(h,ctypes.c_void_p(a),b,n,ctypes.byref(r)): return None
    return b.raw[:r.value]
for a in sys.argv[2:]:
    va=int(a,16)
    d=rd(va,4)
    if d is None:
        print('%08X  -> (unreadable)'%va); continue
    v=d[0]|(d[1]<<8)|(d[2]<<16)|(d[3]<<24)
    print('%08X  [0]=%08X'%(va,v))
    # follow a couple levels
    cur=v
    for lv in range(1,4):
        nd=rd(cur,4)
        if nd is None:
            print('   -> [%d] %08X (unreadable after)'%(lv,cur)); break
        nv=nd[0]|(nd[1]<<8)|(nd[2]<<16)|(nd[3]<<24)
        print('   -> [%d] %08X = %08X'%(lv,cur,nv))
        cur=nv
k.CloseHandle(h)
