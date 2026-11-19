/**
 * ML data program for the Calliope mini — USB serial stream. See MlUsb.h for
 * the wire format.
 */
#include "MlUsb.h"

extern MicroBit uBit;

#if MICROBIT_CODAL
#define ML_SERIAL_IN_USE DEVICE_SERIAL_IN_USE
#define ML_HARDWARE 2
#else
#define ML_SERIAL_IN_USE MICROBIT_SERIAL_IN_USE
#define ML_HARDWARE 1
#endif

#define ML_SFD 0xFF
#define ML_RES_READ 0x01
#define ML_RES_NOTIFY 0x21

#define ML_TX_BUFFER 128
#define ML_RX_BUFFER 32

#define ML_INFO_LEN 6
#define ML_MOTION_LEN 7
#define ML_BUTTON_LEN 2
#define ML_MAX_FRAME (6 + ML_INFO_LEN)

static uint8_t motionSeq = 0;

static uint8_t chksum(const uint8_t *buf, int len) {
  unsigned int sum = 0;
  for (int i = 0; i < len; i++) {
    sum += buf[i];
  }
  return (uint8_t)(sum % 0xFF);
}

/**
 * Build and send one frame. Waits at most `maxWaitMs` for the TX ring to have
 * room for the whole frame, so a partial frame is never queued; gives up (and
 * drops the frame) after that. Returns true when the frame was queued.
 */
static bool sendFrame(uint8_t type, uint16_t ch, const uint8_t *data, int len, int maxWaitMs) {
  uint8_t frame[ML_MAX_FRAME];
  int size = 6 + len;
  frame[0] = ML_SFD;
  frame[1] = type;
  frame[2] = (uint8_t)(ch >> 8);
  frame[3] = (uint8_t)(ch & 0xFF);
  frame[4] = (uint8_t)len;
  memcpy(&frame[5], data, len);
  frame[size - 1] = chksum(frame, size - 1);

  for (int waited = 0; (ML_TX_BUFFER - uBit.serial.txBufferedSize()) < size; waited++) {
    if (waited >= maxWaitMs) {
      return false;
    }
    fiber_sleep(1);
  }
  for (int attempt = 0; attempt <= maxWaitMs; attempt++) {
    if (uBit.serial.send(frame, size, ASYNC) != ML_SERIAL_IN_USE) {
      return true;
    }
    fiber_sleep(1);
  }
  return false;
}

static void sendInfo() {
  uint8_t data[ML_INFO_LEN];
  data[0] = ML_HARDWARE;
  data[1] = 0x4D; // 'M': the ML data program
  data[2] = ML_PROTOCOL_VERSION;
  data[3] = ML_FIRMWARE_BUILD;
  data[4] = ML_SAMPLE_PERIOD_MS;
  data[5] = (uint8_t)uBit.accelerometer.getRange();
  sendFrame(ML_RES_READ, ML_CH_INFO, data, ML_INFO_LEN, 20);
}

static void putInt16(uint8_t *dst, int value) {
  int16_t v = (int16_t)value;
  dst[0] = (uint8_t)(v & 0xFF);
  dst[1] = (uint8_t)((v >> 8) & 0xFF);
}

/**
 * Motion fiber: one sample every ML_SAMPLE_PERIOD_MS, paced against an
 * absolute deadline so scheduler rounding (the DAL ticks every 6 ms) never
 * accumulates into a lower rate. A missed TX slot drops that frame only; the
 * sequence number still advances so the host can count the gap.
 */
static void motionFiber() {
  uint8_t data[ML_MOTION_LEN];
  unsigned long next = system_timer_current_time();
#ifdef ML_DEBUG_TIMING
  uint32_t dbgBody = 0, dbgSleep = 0, dbgMaxBody = 0, dbgN = 0;
  unsigned long dbgAt = next;
#endif
  while (true) {
#ifdef ML_DEBUG_TIMING
    unsigned long t0 = system_timer_current_time();
#endif
    putInt16(&data[0], uBit.accelerometer.getX());
    putInt16(&data[2], uBit.accelerometer.getY());
    putInt16(&data[4], uBit.accelerometer.getZ());
    data[6] = motionSeq++;
    sendFrame(ML_RES_NOTIFY, ML_CH_MOTION, data, ML_MOTION_LEN, 0);

    next += ML_SAMPLE_PERIOD_MS;
    long wait = (long)(next - system_timer_current_time());
    if (wait < -ML_SAMPLE_PERIOD_MS) {
      // Fell more than a period behind (e.g. a long display print or flash
      // write): resynchronise rather than bursting to catch up.
      next = system_timer_current_time();
      wait = 0;
    }
#ifdef ML_DEBUG_TIMING
    unsigned long t1 = system_timer_current_time();
    fiber_sleep(wait > 0 ? wait : 0);
    unsigned long t2 = system_timer_current_time();
    dbgBody += t1 - t0;
    dbgSleep += t2 - t1;
    if (t1 - t0 > dbgMaxBody) dbgMaxBody = t1 - t0;
    dbgN++;
    if (t2 - dbgAt >= 1000) {
      uint8_t d[6] = {(uint8_t)dbgN, (uint8_t)(dbgBody / dbgN), (uint8_t)dbgMaxBody,
                      (uint8_t)(dbgSleep / dbgN), (uint8_t)(wait > 0 ? wait : 0), 0};
      sendFrame(ML_RES_NOTIFY, 0x02F0, d, 6, 0);
      dbgBody = dbgSleep = dbgMaxBody = dbgN = 0;
      dbgAt = t2;
    }
#else
    fiber_sleep(wait > 0 ? wait : 0);
#endif
  }
}

/** Announce fiber: ML_INFO once per second, whether or not anyone asked. */
static void announceFiber() {
  while (true) {
    sendInfo();
    fiber_sleep(1000);
  }
}

static uint8_t readByte() {
  if (uBit.serial.rxBufferedSize() > 0) {
    return uBit.serial.read(ASYNC);
  }
  return uBit.serial.read(SYNC_SLEEP);
}

/** Request fiber: answer the host's REQ_READ 0x0200 with ML_INFO. */
static void requestFiber() {
  const uint8_t pattern[4] = {ML_SFD, 0x01, (uint8_t)(ML_CH_INFO >> 8), (uint8_t)(ML_CH_INFO & 0xFF)};
  int matched = 0;
  while (true) {
    uint8_t b = readByte();
    if (b == pattern[matched]) {
      matched++;
      if (matched == (int)sizeof(pattern)) {
        matched = 0;
        sendInfo();
      }
    } else {
      matched = (b == pattern[0]) ? 1 : 0;
    }
  }
}

static void onButton(MicroBitEvent e) {
  uint8_t state;
  if (e.value == MICROBIT_BUTTON_EVT_DOWN) {
    state = 1;
  } else if (e.value == MICROBIT_BUTTON_EVT_UP) {
    state = 0;
  } else if (e.value == MICROBIT_BUTTON_EVT_HOLD) {
    state = 2;
  } else {
    return;
  }
  uint8_t data[ML_BUTTON_LEN];
  data[0] = (e.source == MICROBIT_ID_BUTTON_A) ? 1 : 2;
  data[1] = state;
  sendFrame(ML_RES_NOTIFY, ML_CH_BUTTON, data, ML_BUTTON_LEN, 20);
}

void mlUsbStart() {
#if MICROBIT_CODAL
  uBit.serial.setBaud(115200);
#else
  uBit.serial.baud(115200);
#endif
  uBit.serial.setTxBufferSize(ML_TX_BUFFER);
  uBit.serial.setRxBufferSize(ML_RX_BUFFER);

  uBit.messageBus.listen(MICROBIT_ID_BUTTON_A, MICROBIT_EVT_ANY, onButton);
  uBit.messageBus.listen(MICROBIT_ID_BUTTON_B, MICROBIT_EVT_ANY, onButton);

  create_fiber(motionFiber);
  create_fiber(announceFiber);
  create_fiber(requestFiber);
}
