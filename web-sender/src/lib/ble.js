/**
 * Web Bluetooth transport for writing chunked MeshPackets to upi-ble-relay.
 * Untested on real hardware until verified on a phone against the Raspberry Pi.
 */
import { PACKET_CHAR_UUID, SERVICE_UUID, STATUS_CHAR_UUID } from '../config.js';
import { chunkString } from './chunker.js';

export function isWebBluetoothSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.bluetooth !== 'undefined';
}

/**
 * Connect to the Pi gateway, subscribe to status notifications, write frames
 * sequentially with writeValueWithResponse, and verify the returned hash prefix.
 */
export async function sendPacketOverBle({
  packetJson,
  packetId,
  expectedSha256Prefix,
  onConnecting,
  onConnected,
  onProgress,
  onDisconnected,
}) {
  if (!isWebBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser.');
  }

  onConnecting?.();

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
  });

  if (onDisconnected) {
    device.addEventListener('gattserverdisconnected', () => onDisconnected());
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const packetChar = await service.getCharacteristic(PACKET_CHAR_UUID);
  const statusChar = await service.getCharacteristic(STATUS_CHAR_UUID);

  onConnected?.(device.name || 'UPI-Gateway-01');

  let lastStatus = '';
  let resolveFinalStatus = null;

  const finalPromise = new Promise((resolve) => {
    resolveFinalStatus = resolve;
  });

  const handleNotification = (event) => {
    const val = new TextDecoder('utf-8').decode(event.target.value);
    lastStatus = val;
    if (
      val.startsWith('STORED:') ||
      val.startsWith('DUPLICATE:') ||
      val.startsWith('ERR:')
    ) {
      resolveFinalStatus?.(val);
    }
  };

  try {
    await statusChar.startNotifications();
    statusChar.addEventListener('characteristicvaluechanged', handleNotification);
  } catch {
    // Fallback to explicit read after writes if notify subscription fails
  }

  const encoder = new TextEncoder();
  const frames = chunkString(packetJson);

  try {
    for (let i = 0; i < frames.length; i++) {
      const bytes = encoder.encode(frames[i]);
      if (typeof packetChar.writeValueWithResponse === 'function') {
        await packetChar.writeValueWithResponse(bytes);
      } else {
        await packetChar.writeValue(bytes);
      }
      onProgress?.(i + 1, frames.length);
    }

    // Wait briefly for notification, or read status characteristic directly
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(async () => {
        try {
          const val = await statusChar.readValue();
          resolve(new TextDecoder('utf-8').decode(val));
        } catch {
          resolve(lastStatus);
        }
      }, 1500)
    );

    const finalStatus = await Promise.race([finalPromise, timeoutPromise]);

    if (!finalStatus) {
      throw new Error('Gateway did not acknowledge storage.');
    }
    if (finalStatus.startsWith('ERR:')) {
      throw new Error(`Gateway rejected transfer (${finalStatus}).`);
    }

    let hashMatched = false;
    if (finalStatus.startsWith('STORED:')) {
      const parts = finalStatus.split(':');
      const returnedPrefix = parts[2] || '';
      hashMatched =
        Boolean(expectedSha256Prefix) &&
        returnedPrefix.toLowerCase() === expectedSha256Prefix.toLowerCase();
      if (!hashMatched) {
        throw new Error('Gateway verification hash mismatch.');
      }
    } else if (finalStatus.startsWith(`DUPLICATE:${packetId}`) || finalStatus.startsWith('DUPLICATE:')) {
      hashMatched = true;
    }

    return {
      statusMessage: finalStatus,
      hashMatched,
      totalChunks: frames.length,
    };
  } finally {
    try {
      statusChar.removeEventListener('characteristicvaluechanged', handleNotification);
      await statusChar.stopNotifications();
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (device.gatt.connected) {
        device.gatt.disconnect();
      }
    } catch {
      // Ignore disconnect errors
    }
  }
}
