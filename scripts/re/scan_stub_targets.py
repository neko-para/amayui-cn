# -*- coding: utf-8 -*-
"""scan_stub_targets.py -- analyze engine .text for call rel32 destinations to locate
the ASProtect import stub (a shared outside-image destination reachable by many sites).
Usage:
  python scan_stub_targets.py <engine_image.bin>   # whole image file (base 0x400000)
  python scan_stub_targets.py --live <pid>          # read runtime .text from process
"""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')

EB = 0x400000
IMG_LO = 0x400000
IMG_HI = 0x400000 + 0x26F000

if len(sys.argv) >= 2 and sys.argv[1] == '--live':
    import ctypes
    from ctypes import wintypes
    PID = int(sys.argv[2]) if len(sys.argv) > 2 else 30624
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    k.ReadProcessMemory.restype=wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
    k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
    h=k.OpenProcess(0x0400|0x0010,False,PID)
    def rd(a,n):
        out=bytearray(); d=0
        while d<n:
            m=min(0x10000,n-d); b=ctypes.create_string_buffer(m); r=ctypes.c_size_t(0)
            if not k.ReadProcessMemory(h,ctypes.c_void_p(a+d),b,m,ctypes.byref(r)) or r.value==0:
                return bytes(out) if d else None
            out+=b.raw[:r.value]; d+=r.value
        return bytes(out)
    img = rd(EB+0x1000, 0x11C000)   # .text only
    base_off = 0x1000               # img[i] corresponds to VA = EB + 0x1000 + i
    k.CloseHandle(h)
else:
    img = open(sys.argv[1], 'rb').read()   # whole image
    base_off = 0                          # img[i] corresponds to VA = EB + i

from collections import Counter
targets = Counter()
for i in range(len(img)-5):
    if img[i] == 0xE8:
        rel = img[i+1]|(img[i+2]<<8)|(img[i+3]<<16)|(img[i+4]<<24)
        if rel & 0x80000000: rel -= 0x100000000
        site_va = EB + base_off + i
        dst = site_va + 5 + rel
        targets[dst] += 1

print('total call rel32 sites (in scanned window):', sum(targets.values()))
print('distinct targets:', len(targets))

print('\ntargets OUTSIDE engine image (candidate stub), count>=5:')
outs = [(d,c) for d,c in targets.items() if not (IMG_LO <= d < IMG_HI) and c >= 5]
outs.sort(key=lambda x:-x[1])
if outs:
    for d,c in outs[:25]:
        print('  0x%08X  count=%5d' % (d,c))
    # dump the top outside-target bytes if reading from live
else:
    print('  (none with count>=5)')
print('\ntop 12 all targets:')
for d,c in targets.most_common(12):
    where = 'IN-IMG' if IMG_LO <= d < IMG_HI else 'OUTSIDE'
    print('  0x%08X  count=%5d  %s' % (d,c,where))
