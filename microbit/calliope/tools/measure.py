"""
Measure the ML data program's sample rate and values over USB serial or BLE.

  python -I measure.py usb COM9 [seconds]
  python -I measure.py ble "Calliope mini" [seconds]     (name substring)
  python -I measure.py both COM9 "Calliope mini" [seconds]  (both at once)

USB: parses the framed stream (see ../source/MlUsb.h), sends the REQ_READ
0x0200 handshake once, and reports frames/s, sequence gaps, interval stats
and the mean X/Y/Z. BLE: subscribes to the micro:bit accelerometer data
characteristic and reports notifications/s and the mean X/Y/Z. The BLE mode
also works against the old data collection program, for comparison.
"""
import asyncio
import statistics
import struct
import sys
import time

SFD = 0xFF


def chk(buf):
    return sum(buf) % 0xFF


def summary(label, stamps, xyz, extra=""):
    if len(stamps) < 2:
        print(f"{label}: {len(stamps)} samples, nothing to measure {extra}")
        return
    span = stamps[-1] - stamps[0]
    rate = (len(stamps) - 1) / span if span > 0 else 0
    gaps = [(b - a) * 1000 for a, b in zip(stamps, stamps[1:])]
    xs, ys, zs = zip(*xyz)
    print(f"{label}: {len(stamps)} samples in {span:.2f}s = {rate:.1f}/s; "
          f"interval ms mean {statistics.mean(gaps):.1f} median {statistics.median(gaps):.1f} "
          f"max {max(gaps):.1f}; mean x {statistics.mean(xs):.0f} y {statistics.mean(ys):.0f} "
          f"z {statistics.mean(zs):.0f} (sd {statistics.pstdev(xs):.0f}/{statistics.pstdev(ys):.0f}/"
          f"{statistics.pstdev(zs):.0f}) {extra}")


def usb(port, seconds):
    import serial
    s = serial.Serial(port, 115200, timeout=0.05)
    s.reset_input_buffer()
    s.write(bytes([SFD, 0x01, 0x02, 0x00]))
    buf = bytearray()
    stamps, xyz, seqs = [], [], []
    infos, buttons, bad, other = [], [], 0, 0
    end = time.time() + seconds
    while time.time() < end:
        buf += s.read(256)
        while True:
            i = buf.find(bytes([SFD]))
            if i < 0:
                buf.clear()
                break
            del buf[:i]
            if len(buf) < 6:
                break
            n = buf[4]
            if n > 64:
                del buf[:1]
                continue
            if len(buf) < 6 + n:
                break
            frame = bytes(buf[:6 + n])
            if chk(frame[:-1]) != frame[-1]:
                bad += 1
                del buf[:1]
                continue
            del buf[:6 + n]
            ch = (frame[2] << 8) | frame[3]
            data = frame[5:-1]
            now = time.time()
            if ch == 0x0203 and len(data) >= 7:
                x, y, z = struct.unpack("<hhh", data[:6])
                stamps.append(now)
                xyz.append((x, y, z))
                seqs.append(data[6])
            elif ch == 0x0200:
                infos.append((round(now, 2), list(data)))
            elif ch == 0x0210:
                buttons.append(list(data))
            elif ch == 0x02F0:
                print("timing n/avgBody/maxBody/avgSleep/lastWait:", list(data[:5]))
            else:
                other += 1
    s.close()
    lost = sum(((b - a) % 256) - 1 for a, b in zip(seqs, seqs[1:]))
    summary("USB motion", stamps, xyz, f"lost {lost} by seq, bad checksums {bad}, other frames {other}")
    print(f"USB info frames: {len(infos)} first {infos[:2]}")
    print(f"USB button frames: {buttons[:20]}")


ACC_SERVICE = "e95d0753-251d-470a-a062-fa1922dfa9a8"
ACC_DATA = "e95dca4b-251d-470a-a062-fa1922dfa9a8"
ACC_PERIOD = "e95dfb24-251d-470a-a062-fa1922dfa9a8"


async def ble(name, seconds):
    from bleak import BleakClient, BleakScanner
    dev = await BleakScanner.find_device_by_filter(
        lambda d, ad: (d.name or ad.local_name or "").find(name) >= 0, timeout=15)
    if not dev:
        print(f"BLE: no device named *{name}* found")
        return
    print(f"BLE: connecting to {dev.name} {dev.address}")
    stamps, xyz = [], []

    def on(_, data):
        stamps.append(time.time())
        xyz.append(struct.unpack("<hhh", bytes(data[:6])))

    async with BleakClient(dev) as c:
        try:
            period = struct.unpack("<H", await c.read_gatt_char(ACC_PERIOD))[0]
            print(f"BLE accelerometer period: {period} ms")
        except Exception as e:  # noqa: BLE001
            print(f"BLE period read failed: {e}")
        await c.start_notify(ACC_DATA, on)
        await asyncio.sleep(seconds)
        await c.stop_notify(ACC_DATA)
    summary("BLE accel", stamps, xyz)


if __name__ == "__main__":
    mode, target = sys.argv[1], sys.argv[2]
    secs = float(sys.argv[3]) if len(sys.argv) > 3 and mode != "both" else 10
    if mode == "usb":
        usb(target, secs)
    elif mode == "ble":
        asyncio.run(ble(target, secs))
    elif mode == "both":
        # USB and BLE at once: measure.py both COM9 "Calliope mini" 20
        import threading
        name = sys.argv[3]
        secs = float(sys.argv[4]) if len(sys.argv) > 4 else 20
        t = threading.Thread(target=usb, args=(target, secs + 12))
        t.start()
        asyncio.run(ble(name, secs))
        t.join()
