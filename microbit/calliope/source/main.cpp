/**
 * ML data program for the Calliope mini (mini 1/2 on microbit-dal, mini 3 on
 * codal-microbit-v2; one source, selected by MICROBIT_CODAL).
 *
 * Over Bluetooth it is the trainer's data collection program: the standard
 * micro:bit accelerometer, button, LED, IO pin and UART services, the pairing
 * pattern on the display, smileys on connect and disconnect.
 *
 * Over USB it additionally streams accelerometer samples (every 20 ms) and
 * button changes as framed serial packets (MlUsb.h), so a host such as
 * Calliope Campus gets motion data without Bluetooth. The Blocks runtime stays
 * untouched; on the mini 2 it has no room for this.
 */
#include "MicroBit.h"
#include "MicroBitUARTService.h"
#include "MicroBitAccelerometerService.h"
#include "MicroBitIOPinService.h"
#include "MicroBitLEDService.h"
#include "MicroBitButtonService.h"
#include "MlUsb.h"

MicroBit uBit;

static MicroBitUARTService *uart;
static MicroBitImage pairPattern;
static int connected = 0;

static const uint8_t CODEBOOK[MICROBIT_NAME_LENGTH][MICROBIT_NAME_CODE_LETTERS] = {
    {'z', 'v', 'g', 'p', 't'},
    {'u', 'o', 'i', 'e', 'a'},
    {'z', 'v', 'g', 'p', 't'},
    {'u', 'o', 'i', 'e', 'a'},
    {'z', 'v', 'g', 'p', 't'}};

static const uint8_t HAPPY[25] = {
    0, 0, 0, 0, 0,
    0, 1, 0, 1, 0,
    0, 0, 0, 0, 0,
    1, 0, 0, 0, 1,
    0, 1, 1, 1, 0};

static const uint8_t SAD[25] = {
    0, 0, 0, 0, 0,
    0, 1, 0, 1, 0,
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    1, 0, 0, 0, 1};

static ManagedString deviceName() {
#if MICROBIT_CODAL
  return ManagedString(microbit_friendly_name());
#else
  return uBit.getName();
#endif
}

/** The name pattern (one column bar per name letter) users match to find their mini. */
static MicroBitImage makePairPattern() {
  ManagedString name = deviceName();
  MicroBitImage image(5, 5);
  for (int i = 0; i < MICROBIT_NAME_LENGTH; i++) {
    for (int j = 0; j < MICROBIT_NAME_CODE_LETTERS; j++) {
      if (name.charAt(i) == CODEBOOK[i][j]) {
        for (int k = 0; k < j + 1; k++) {
          image.setPixelValue(i, 4 - k, 255);
        }
      }
    }
  }
  return image;
}

static void onConnected(MicroBitEvent) {
  connected = 1;
  uBit.sleep(3000);
  if (!connected) {
    return;
  }
  uart->send(ManagedString("id_prop")); // must precede the vi_ message
  uart->send(ManagedString("vi_") + ManagedString(ML_FIRMWARE_BUILD));
  MicroBitImage happy(5, 5, HAPPY);
  uBit.display.print(happy);
}

static void onDisconnected(MicroBitEvent) {
  connected = 0;
  MicroBitImage sad(5, 5, SAD);
  uBit.display.print(sad);
  uBit.sleep(2000);
  if (!connected) {
    uBit.display.print(pairPattern);
  }
}

static void startBle() {
  uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_CONNECTED, onConnected);
  uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_DISCONNECTED, onDisconnected);

  uart = new MicroBitUARTService(*uBit.ble, 32, 32);
  new MicroBitLEDService(*uBit.ble, uBit.display);
  new MicroBitIOPinService(*uBit.ble, uBit.io);
  new MicroBitButtonService(*uBit.ble);
  new MicroBitAccelerometerService(*uBit.ble, uBit.accelerometer);
}

#if !MICROBIT_CODAL
/**
 * On the Calliope DAL, services added synchronously right after uBit.init()
 * may not appear in GATT discovery, and init() only advertises when A+B are
 * held at boot. As in the DAL Blocks runtime: add the services from a fiber
 * once the BLE stack has settled, then advertise explicitly.
 */
static void bleFiber() {
  uBit.sleep(200);
  startBle();
  uBit.bleManager.advertise();
}
#endif

int main() {
  uBit.init();

  pairPattern = makePairPattern();
  uBit.display.print(pairPattern);

#if MICROBIT_CODAL
  startBle();
#else
  create_fiber(bleFiber);
#endif

  mlUsbStart();

  release_fiber();
}
