"""
Extract one board's image from a micro:bit Universal Hex.

  python -I split_universal.py <universal.hex> <board id hex, e.g. 9900> <out.hex>

Note: the trainer's universal-hex.hex carries the mini 3 (nRF52) image under
board id 0x9900 and the mini 2 (nRF51) image under 0x9903.
"""
import sys
src, board, out = sys.argv[1], int(sys.argv[2],16), sys.argv[3]
cur=None; base=None; emitted=None; lines=[]
for l in open(src):
    l=l.strip()
    if not l.startswith(':'): continue
    b=bytearray.fromhex(l[1:]); t=b[3]
    if t==0x0A: cur=(b[4]<<8)|b[5]; continue
    if t in (0x04,0x02): base=l; continue
    if cur!=board or t not in (0x00,0x0D,0x03,0x05): continue
    if base!=emitted: lines.append(base); emitted=base
    if t==0x0D: b[3]=0
    b[-1]=(-sum(b[:-1]))&0xFF
    lines.append(':'+b.hex().upper())
lines.append(':00000001FF')
open(out,'w').write('\n'.join(lines)+'\n')
