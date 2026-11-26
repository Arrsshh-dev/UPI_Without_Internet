"""
BlueZ GATT Peripheral for the UPI BLE Relay.

⚠️  HARDWARE-ONLY — requires a Raspberry Pi with BlueZ 5.50+ and Python 3.9+.
    Cannot be tested on a laptop without BLE hardware.
    See README.md for the manual test checklist using nRF Connect.

This module uses dbus-next (async) to register a GATT application with BlueZ.
If bluezero is available and works, it will use that instead (simpler API).
"""
from __future__ import annotations

import logging
import json
import sys
import threading
from typing import Optional

from . import config
from .reassembly import Reassembler
from .store import PacketStore

log = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
#  IMPORTANT: This module is a SKELETON.
#  It will only run on a real Raspberry Pi with BlueZ.
#  The import guards below prevent crashes on dev machines.
# ═══════════════════════════════════════════════════════════════════════

try:
    from bluezero import adapter, peripheral
    HAS_BLUEZERO = True
except ImportError:
    HAS_BLUEZERO = False
    log.info("bluezero not installed — GATT server unavailable (expected on non-Pi)")


class GattServer:
    """
    BLE GATT peripheral that accepts chunked MeshPacket writes
    and notifies the sender of reassembly / storage status.

    Service UUID:  7e400001-b5a3-f393-e0a9-e50e24dcca9e
    Packet char:   7e400002-... (Write with Response)
    Status char:   7e400003-... (Read + Notify)
    """

    def __init__(self, store: PacketStore, adapter_addr: Optional[str] = None):
        if not HAS_BLUEZERO:
            raise RuntimeError(
                "bluezero is not installed. "
                "Run: pip install bluezero   (on Raspberry Pi only)"
            )
        self._store = store
        self._reassembler = Reassembler()
        self._last_status = "READY"
        self._adapter_addr = adapter_addr

    def _on_packet_write(self, value: list[int], options: dict) -> None:
        """Called when a BLE client writes to the Packet characteristic."""
        try:
            frame = bytes(value).decode("utf-8")
            log.debug("BLE write: %s", frame[:80])

            result = self._reassembler.process_frame(frame)

            if result.status == "COMPLETE":
                # Store the fully reassembled packet
                is_new, msg = self._store.store_packet(
                    result.packet_json,
                    result.packet_dict,
                    total_chunks=0,  # filled by reassembly count
                    source_device="ble-client",
                )
                self._last_status = msg
            else:
                self._last_status = result.message

            log.info("Status → %s", self._last_status)
            # Note: bluezero notification is sent via the read callback
            # The client should subscribe to Status char notifications

        except Exception as e:
            log.error("Error processing BLE write: %s", e)
            self._last_status = f"ERR:internal_error"

    def _on_status_read(self) -> list[int]:
        """Called when a BLE client reads the Status characteristic."""
        return list(self._last_status.encode("utf-8"))

    def run(self) -> None:
        """Start the GATT server (blocking)."""
        # Find the default adapter
        adapters = list(adapter.Adapter.available())
        if not adapters:
            log.error("No Bluetooth adapters found")
            sys.exit(1)

        adapter_addr = self._adapter_addr or adapters[0].address
        log.info("Using adapter: %s", adapter_addr)

        # Create peripheral
        pi_periph = peripheral.Peripheral(
            adapter_addr,
            local_name=config.DEVICE_NAME,
        )

        # Add service
        pi_periph.add_service(
            srv_id=1,
            uuid=config.SERVICE_UUID,
            primary=True,
        )

        # Packet characteristic (Write)
        pi_periph.add_characteristic(
            srv_id=1, chr_id=1,
            uuid=config.PACKET_CHAR_UUID,
            value=[],
            notifying=False,
            flags=["write"],
            write_callback=self._on_packet_write,
        )

        # Status characteristic (Read + Notify)
        pi_periph.add_characteristic(
            srv_id=1, chr_id=2,
            uuid=config.STATUS_CHAR_UUID,
            value=list("READY".encode("utf-8")),
            notifying=True,
            flags=["read", "notify"],
            read_callback=self._on_status_read,
        )

        log.info(
            "Starting GATT server '%s' with service %s",
            config.DEVICE_NAME, config.SERVICE_UUID,
        )
        log.info("Advertising... (Ctrl+C to stop)")

        try:
            pi_periph.publish()
        except KeyboardInterrupt:
            log.info("GATT server stopped.")


def start_gatt_server(store: PacketStore) -> None:
    """Convenience entry point."""
    server = GattServer(store)
    server.run()


# ═══════════════════════════════════════════════════════════════════════
#  Manual test checklist (paste into nRF Connect on iPhone/Android):
#
#  1. Scan → find "UPI-Gateway-01"
#  2. Connect → expand service 7e400001-...
#  3. Write to 7e400002-...:
#       0/1|{"packetId":"test-1","ttl":5,"createdAt":1700000000000,"ciphertext":"AAAA..."}
#     (use a valid base64 ciphertext of ≥ 284 bytes)
#  4. Read 7e400003-... → should show STORED:test-1:<sha256-prefix>
#  5. Subscribe to 7e400003-... notifications
#  6. Write a multi-chunk packet and observe PARTIAL:1/3, PARTIAL:2/3, STORED:...
#
#  Verified on: [ ] RPi 3B+   [ ] RPi 4   [ ] RPi 5
#  BlueZ version: ____   Python version: ____
# ═══════════════════════════════════════════════════════════════════════
