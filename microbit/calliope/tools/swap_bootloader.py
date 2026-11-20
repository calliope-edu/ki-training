"""
Replace the mini 3 bootloader region [0x77000, 0x7E000) of a CODAL build with
the region from another hex, keeping everything else of the build.

  python -I swap_bootloader.py <build.hex> <bootloader-source.hex> <out.hex>

The CODAL libraries borrowed from calliope-dev bake in whichever bootloader
their codal-microbit-v2 pin carries; the ML data program ships with the one
the trainer's previous data collection program carried (25580 bytes, md5
b6b60be32a3f...), so BLE flashing behaves as before. The source's FULL
coverage of the region is copied (bootloaders differ in size; a partial copy
truncates the larger one and the mini no longer boots). Prints extent + md5.
"""
import hashlib
import sys

LO, HI = 0x77000, 0x7E000


def load(path):
    mem, base = {}, 0
    for line in open(path):
        line = line.strip()
        if not line.startswith(":"):
            continue
        b = bytes.fromhex(line[1:])
        t = b[3]
        if t == 4:
            base = ((b[4] << 8) | b[5]) << 16
        elif t == 2:
            base = ((b[4] << 8) | b[5]) << 4
        elif t == 0:
            addr = base + ((b[1] << 8) | b[2])
            for i, v in enumerate(b[4:4 + b[0]]):
                mem[addr + i] = v
    return mem


def dump(mem, path):
    out, upper = [], None
    addrs = sorted(mem)
    i = 0
    while i < len(addrs):
        start = addrs[i]
        chunk = [mem[start]]
        while (i + len(chunk) < len(addrs) and addrs[i + len(chunk)] == start + len(chunk)
               and len(chunk) < 16 and ((start + len(chunk)) & 0xFFFF) != 0):
            chunk.append(mem[start + len(chunk)])
        if start >> 16 != upper:
            upper = start >> 16
            rec = bytes([2, 0, 0, 4, upper >> 8, upper & 0xFF])
            out.append(":" + (rec + bytes([(-sum(rec)) & 0xFF])).hex().upper())
        rec = bytes([len(chunk), (start >> 8) & 0xFF, start & 0xFF, 0]) + bytes(chunk)
        out.append(":" + (rec + bytes([(-sum(rec)) & 0xFF])).hex().upper())
        i += len(chunk)
    out.append(":00000001FF")
    open(path, "w").write("\n".join(out) + "\n")


def extent(mem):
    a = LO
    while a in mem:
        a += 1
    region = bytes(mem[x] for x in range(LO, a))
    return a - LO, hashlib.md5(region).hexdigest()


if __name__ == "__main__":
    base, boot = load(sys.argv[1]), load(sys.argv[2])
    out = {a: v for a, v in base.items() if not LO <= a < HI}
    out.update({a: v for a, v in boot.items() if LO <= a < HI})
    dump(out, sys.argv[3])
    check = load(sys.argv[3])
    assert all(check.get(a) == v for a, v in base.items() if not LO <= a < HI), "runtime changed"
    n, md5 = extent(check)
    print(f"bootloader extent {n} bytes, md5 {md5}")
