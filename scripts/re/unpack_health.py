# -*- coding: utf-8 -*-
"""unpack_health.py -- score how clean AGE.EXE__dumped.EXE is versus the true unpacked
engine and the packed original, across the classic ASProtect packer fingerprints.
Artifacts:
  P = install\\AGE.EXE            (原始带壳)
  D = raw\\AGE.EXE__dumped.EXE     (OllyDbg 插件脱壳产物)
  U = raw\\天结_unpacked.exe       (可信无壳引擎, 参照)
Checks:
  1) Sections: stripped names / all-RWX(0xE0000040) poisons / malformed sizes
  2) EntryPoint: still 0x1000 (packer stub) or the true OEP?
  3) Import dir location: real .idata vs packed fake (in .data/high-entropy)
  4) Import count & how many resolve vs IAT present
  5) Entropy of .text: high (=packed) vs ~6.x (=plain)
  6) Overlay / trailing bytes
  7) reloc / export junk dirs
Output: prints a verdict per axis.
"""
import struct, math, collections
def load(p):
    d=open(p,'rb').read()
    e=struct.unpack_from('<I',d,0x3C)[0]
    ns=struct.unpack_from('<H',d,e+6)[0]
    osize=struct.unpack_from('<H',d,e+20)[0]
    opt=e+4+20
    magic=struct.unpack_from('<H',d,opt)[0]
    is32=magic==0x10b
    if is32:
        ImageBase=struct.unpack_from('<I',d,opt+28)[0]
        EntryPoint=struct.unpack_from('<I',d,opt+16)[0]
        SizeOfImage=struct.unpack_from('<I',d,opt+56)[0]
        dd=opt+96
    else:
        EntryPoint=struct.unpack_from('<I',d,opt+16)[0]
        SizeOfImage=struct.unpack_from('<I',d,opt+56)[0]
        dd=opt+112
    secs=[]
    sd=e+4+20+osize
    for i in range(ns):
        sh=d[sd+i*40:sd+i*40+40]
        nm=sh[:8].rstrip(b'\x00').decode('latin1')
        vs,va,rs,ro=struct.unpack_from('<IIII',sh,8)
        ch=struct.unpack_from('<I',sh,36)[0]
        secs.append({'nm':nm,'va':va,'vs':vs,'rs':rs,'ro':ro,'ch':ch})
    nrd=[struct.unpack_from('<II',d,dd+k*8) for k in range(16)]
    return {'d':d,'E':e,'ns':ns,'secs':secs,'ImageBase':ImageBase,'EP':EntryPoint,
            'SizeOfImage':SizeOfImage,'nrd':nrd,'opt':opt,'is32':is32}
def entropy(b):
    if not b: return 0
    c=collections.Counter(b); n=len(b)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

paths={'原始带壳 P':'install\\AGE.EXE','脱壳产物 D':'raw\\AGE.EXE__dumped.EXE','可信无壳 U':'raw\\天结_unpacked.exe'}
res={}
for tag,p in paths.items():
    try:
        r=load(p); res[tag]=(r,p)
    except Exception as ex:
        print(tag,'LOADFAIL',ex)
print('=== 1) 节表健康 ===')
for tag,(r,p) in res.items():
    secs=r['secs']
    unnamed=sum(1 for s in secs if s['nm']=='')
    allrwx=sum(1 for s in secs if (s['ch']&0xE0000040)==0xE0000040)
    maxch=max((s['ch'] for s in secs),default=0)
    print('  %-10s nsec=%2d  unnamed=%d  RWX(0xE0000040)=%d  maxchar=%08X'%(tag,r['ns'],unnamed,allrwx,maxch))
    for s in secs:
        print('      %-8s RVA=%08X vs=%X rs=%X ch=%08X'%(s['nm'],s['va'],s['vs'],s['rs'],s['ch']))
print('\n=== 2) 入口点(EP) ===')
for tag,(r,p) in res.items():
    print('  %-10s EntryPoint RVA=%08X (0x1000=pak stub)'%(tag,r['EP']))
print('\n=== 3) 导入表目录 ===')
for tag,(r,p) in res.items():
    imp_rva,imp_sz=r['nrd'][1]
    print('  %-10s import dir RVA=%08X size=%X'%(tag,imp_rva,imp_sz))
print('\n=== 4) 各节熵 ===')
for tag,(r,p) in res.items():
    d=r['d']; out=[]
    for s in r['secs']:
        if s['rs'] and s['ro']+s['rs']<=len(d):
            seg=d[s['ro']:s['ro']+s['rs']]
            out.append((s['nm'] or '?',round(entropy(seg),3)))
    print('  %-10s'%tag, out)
print('\n=== 5) overlay / 文件尾 ===')
for tag,(r,p) in res.items():
    d=r['d']; end=max(s['ro']+s['rs'] for s in r['secs']) if r['secs'] else 0
    print('  %-10s filesize=%d  lastsec_end=%d  overlay=%d  SizeOfImage=%X'%(tag,len(d),end,len(d)-end,r['SizeOfImage']))
print('\n=== 6) 导入目录真正解析到几个函数(对 U 可信基准) ===')
def count_imports(r):
    d=r['d']; opt=r['opt']; is32=r['is32']; dd=opt+(96 if is32 else 112)
    # sec map
    secs=r['secs']
    def r2o(rva):
        for s in secs:
            if s['va']<=rva<s['va']+s['vs']: return s['ro']+(rva-s['va'])
        return None
    ir,isz=r['nrd'][1]
    if not ir: return 0
    o=r2o(ir)
    if o is None: return 0
    cnt=0
    idx=0
    while True:
        oft,ts,fc,fname,ft=struct.unpack_from('<IIIII',d,o+idx*20)
        if oft==0 and ft==0: break
        if not ft: idx+=1; continue
        fo=r2o(ft)
        j=0
        while True:
            v=struct.unpack_from('<I',d,fo+j*4)[0]
            if v==0: break
            cnt+=1; j+=1
        idx+=1
    return cnt
for tag,(r,p) in res.items():
    print('  %-10s imported-functions-count=%d'%(tag,count_imports(r)))
