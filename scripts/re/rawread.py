# -*- coding: utf-8 -*-
"""rawread.py -- read-target-va range from process, dump hex/disasm. Same-user read only.
Usage: python rawread.py <pid> <va_hex> <len_hex> [outbin]
"""
import sys, ctypes, os
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
PID = int(sys.argv[1])
VA = int(sys.argv[2], 16)
LEN = int(sys.argv[3], 16)
k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h = k.OpenProcess(0x0400|0x0010, False, PID)
if not h:
    print('OpenProcess FAIL err=%d' % ctypes.get_last_error()); sys.exit(1)
def rd(a,n):
    out=bytearray(); d=0
    while d<n:
        m=min(0x10000,n-d); b=ctypes.create_string_buffer(m); r=ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h, ctypes.c_void_p(a+d), b, m, ctypes.byref(r)) or r.value==0:
            return bytes(out) if d else None
        out+=b.raw[:r.value]; d+=r.value
    return bytes(out)
data = rd(VA, LEN)
if data is None:
    print('READ FAILED @%08X..%08X' % (VA, VA+LEN))
else:
    print('read %d bytes @%08X..%08X' % (len(data), VA, VA+LEN))
    for i in range(0, len(data), 16):
        row=data[i:i+16]
        print('  %08X  %s' % (VA+i, ' '.join('%02X'%x for x in row)))
    if len(sys.argv)>4:
        with open(sys.argv[4],'wb') as f: f.write(data)
        print('saved', sys.argv[4])
k.CloseHandle(h)
