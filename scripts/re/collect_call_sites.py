# -*- coding: utf-8 -*-
"""collect_call_sites.py -- find all call rel32 -> STUB sites in engine .text (live).
Usage: python collect_call_sites.py <pid> <stub_hex> [outjson]
"""
import sys, ctypes, json, struct
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
PID = int(sys.argv[1])
STUB = int(sys.argv[2], 16)
OUT = sys.argv[3] if len(sys.argv)>3 else None
EB = 0x400000; TEXT_RVA=0x1000; TEXT_SIZE=0x11C000
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
text = rd(EB+TEXT_RVA, TEXT_SIZE) or b''
sites=[]
for i in range(len(text)-5):
    if text[i]==0xE8:
        rel=text[i+1]|(text[i+2]<<8)|(text[i+3]<<16)|(text[i+4]<<24)
        if rel&0x80000000: rel-=0x100000000
        site_va=EB+TEXT_RVA+i
        dst=site_va+5+rel
        if dst==STUB:
            sites.append({'site_va':site_va,'ra':site_va+5,'off':i,'rva':0x1000+i})
k.CloseHandle(h)
# dedupe by site_va
seen=set(); uniq=[]
for s in sites:
    if s['site_va'] not in seen:
        seen.add(s['site_va']); uniq.append(s)
uniq.sort(key=lambda s:s['site_va'])
print('call->stub sites:', len(uniq))
for s in uniq[:80]:
    print('  site=%08X ra=%08X rva=%05X' % (s['site_va'], s['ra'], s['rva']))
if OUT:
    with open(OUT,'w',encoding='utf-8') as f:
        json.dump({'pid':PID,'stub':hex(STUB),'sites':uniq},f,indent=2,ensure_ascii=False)
    print('saved',OUT)
