/**
 * ML data program for the Calliope mini — USB serial stream.
 *
 * Streams accelerometer samples and button changes over the USB serial port
 * (mini 2: J-Link OB CDC bridge, mini 3: DAPLink CDC) at 115200 baud, framed
 * exactly like the Blocks runtime's serial protocol so the connection widget's
 * frame codec (mini-connection-widget `blocks-frame.ts`) parses it unchanged:
 *
 *   [0xFF (SFD), type, ch_hi, ch_lo, len, data[len], chk]
 *   chk = (sum of all preceding frame bytes) % 0xFF
 *
 * Channels live in their own 0x02xx range so nothing mistakes this program for
 * the Blocks runtime (which answers on 0x01xx):
 *
 *   0x0200 ML_INFO    RES_READ (0x01) reply to the host's REQ_READ
 *                     [FF 01 02 00], and announced unprompted once per second.
 *                     data: [0] hardware (1 = mini 1/2 DAL, 2 = mini 3 CODAL)
 *                           [1] program id 0x4D ('M')
 *                           [2] protocol version
 *                           [3] firmware build
 *                           [4] sample period in ms
 *                           [5] accelerometer range in g
 *                           [6] motion resyncs since boot (wraps at 256)
 *                           [7] worst motion lateness (ms) since the last ML_INFO
 *                           [8..9] uptime in seconds, uint16 little-endian
 *   0x0203 MOTION     NOTIFY (0x21) every sample period (20 ms):
 *                     data: X, Y, Z as int16 little-endian in milli-g,
 *                           micro:bit orientation (the same values the BLE
 *                           accelerometer service sends), then a uint8
 *                           sequence number that wraps at 256.
 *   0x0210 BUTTON     NOTIFY (0x21) on every button change:
 *                     data: [0] button (1 = A, 2 = B)
 *                           [1] state as the BLE button service reports it
 *                               (0 = released, 1 = pressed, 2 = long press)
 *
 * The stream runs from boot, with no command needed: the mini 2's DAL UART
 * receive path is known to go deaf under SoftDevice load (see the Blocks
 * runtime's BlocksProbe), so nothing here depends on the device hearing the
 * host. Over BLE the program behaves exactly like the data collection program.
 */
#ifndef ML_USB_H
#define ML_USB_H

#include "MicroBit.h"

#define ML_PROTOCOL_VERSION 1
#define ML_FIRMWARE_BUILD 1
#define ML_SAMPLE_PERIOD_MS 20

#define ML_CH_INFO 0x0200
#define ML_CH_MOTION 0x0203
#define ML_CH_BUTTON 0x0210

/** Start the USB stream: configures the serial port and spawns the motion,
 *  announce and request fibers, and listens for button events. */
void mlUsbStart();

#endif // ML_USB_H
