# -*- coding: utf-8 -*-
"""compare_imports.py: cross-check runtime direct-import slot/name mapping against the
unpacked sibling (天结_unpacked) per-DLL import order, to detect off-by-one (错位)."""
import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

UNP = r'scripts\re\engine_imports.json'
RT = r'.tmp\import_map.json'

unp = json.load(open(UNP, encoding='utf-8'))
unp_perdll = {}
for dll in unp['dlls']:
    unp_perdll[dll['dll'].lower()] = [f['name'] for f in dll['functions'] if 'name' in f]

rt = json.load(open(RT, encoding='utf-8'))
sm = rt['slotmap']
rt_perdll = defaultdict(list)
for slot_hex, v in sm.items():
    mod = (v.get('module') or '').lower()
    if v.get('func') and v['func'] != '?':
        rt_perdll[mod].append((int(slot_hex,16), v['func']))
for mod in rt_perdll: rt_perdll[mod].sort()
rt_seq = {mod: [f for _, f in items] for mod, items in rt_perdll.items()}

def is_subseq(seq, full):
    it = iter(full)
    return all(x in it for x in seq)

def find_first_divergence(seq, full):
    # walk seq; for each, find position in full that is NOT before the previous match
    pos = -1
    for x in seq:
        if x in full:
            # find first occurrence of x at index > pos... but duplicate names confuse.
            found = -1
            for idx, y in enumerate(full):
                if y == x and idx > pos:
                    found = idx; break
            if found == -1:
                return ('%s not found in-order after %d' % (x, pos))
            pos = found
        else:
            return ('%s not in unpacked list' % x)
    return None

print('=== per-DLL: runtime direct-import sequence vs unpacked (subsequence check) ===')
for mod in unp_perdll:
    if mod not in rt_seq:
        print('\n[%s]  (no runtime direct-imports)' % mod)
        continue
    full = unp_perdll[mod]
    seq = rt_seq[mod]
    sub = is_subseq(seq, full)
    print('\n[%s]  runtime=%d  unpacked=%d  in-order-subsequence=%s' % (mod, len(seq), len(full), sub))
    if not sub:
        div = find_first_divergence(seq, full)
        print('   !! divergence: %s' % div)
    # print the sequence
    print('   unpacked:', full)
    print('   runtime :', seq)

# also list runtime modules not in unpacked
extra = [m for m in rt_seq if m not in unp_perdll]
print('\n=== runtime modules NOT in unpacked list ===')
for m in extra:
    print('  %s : %s' % (m, rt_seq[m]))
