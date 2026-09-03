# -*- coding: utf-8 -*-
"""poly_provenance.py -- decide whether the 'poly' trampoline table (RVA 0x1C3000, the
per-site `jmp [IATslot]` thunks) is ORIGINAL engine code or an ASProtect artifact.
Three-way comparison:
  A) raw\\AGE.EXE__dumped.EXE  (candidate "unpacked AGE" used as ground truth)
  B) raw\\天结_unpacked.exe    (sister game's unpacked engine; known same engine)
  C) LIVE process 30624 memory
Checks:
  1) Does B even HAVE a poly section at RVA 0x1C3000 / a 'poly'-named section?
  2) At a known business call site (RVA 0x1288), what does each of A/B/C have?
  3) Does B use direct `call [IATslot]` (FF 15) or per-site `call rel32->thunk`?
"""
import struct, ctypes, json
from ctypes import wintypes

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

def report(tag,d,secs):
    print('==== %s ===='%tag)
    # sections
    for s in secs:
        print('  sec %-8s VA=%08X vs=%X rs=%X'%(s['nm'],0x400000+s['va'],s['vs'],s['rs']))
    has_poly=any(s['nm'].startswith('poly') for s in secs)
    print('  has poly-named section:',has_poly)
    # at RVA 0x1288 (business site)
    o=r2o(secs,0x1288)
    if o is not None:
        print('  @site RVA 0x1288  bytes=%s'%d[o:o+8].hex())
    # at poly RVA 0x1C3000
    po=r2o(secs,0x1C3000)
    if po is not None:
        print('  @poly RVA 0x1C3000 bytes=%s'%d[po:po+16].hex())
    else:
        print('  @poly RVA 0x1C3000: (no mapping in this file)')
    # count per-site thunk pattern `call rel32 -> poly-region` in .text
    to=r2o(secs,0x1000)
    if to is not None:
        ft=d[to:to+0x11C000].ljust(0x11C000,b'\x00')
        cnt=0; direct=0
        for i in range(len(ft)-5):
            if ft[i]==0xE8:
                rel=struct.unpack('<i',ft[i+1:i+5])[0]
                tgt=0x400000+0x1000+i+5+rel
                if 0x1C3000+0x400000==0: pass
                if 0x400000+0x1C3000<=tgt<0x400000+0x1C3800: cnt+=1
            if ft[i]==0xFF and ft[i+1]==0x15:
                slot=struct.unpack_from('<I',ft,i+2)[0]
                if 0x51C000<=slot<0x51E000: direct+=1
        print('  .text: call->polythunk count=%d ; direct call[IATslot] count=%d'%(cnt,direct))
    print()

for tag,path in [('A: AGE.EXE__dumped.EXE',r'raw\AGE.EXE__dumped.EXE'),
                 ('B: 天结_unpacked.exe',r'raw\天结_unpacked.exe')]:
    d,secs=parse(path)
    report(tag,d,secs)
