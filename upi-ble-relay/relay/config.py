"""
Configuration for the UPI BLE Relay gateway.
All values are overridable via environment variables.
"""
import os

# ── BLE GATT Service ──
SERVICE_UUID        = os.getenv("UPI_SERVICE_UUID",    "7e400001-b5a3-f393-e0a9-e50e24dcca9e")
PACKET_CHAR_UUID    = os.getenv("UPI_PACKET_CHAR_UUID","7e400002-b5a3-f393-e0a9-e50e24dcca9e")
STATUS_CHAR_UUID    = os.getenv("UPI_STATUS_CHAR_UUID","7e400003-b5a3-f393-e0a9-e50e24dcca9e")
DEVICE_NAME         = os.getenv("UPI_DEVICE_NAME",     "UPI-Gateway-01")

# ── Frame protocol ──
CHUNK_PAYLOAD_SIZE  = int(os.getenv("UPI_CHUNK_SIZE",  "140"))   # chars per frame payload
TRANSFER_TIMEOUT_S  = int(os.getenv("UPI_TRANSFER_TIMEOUT", "30"))

# ── SQLite store ──
DB_PATH             = os.getenv("UPI_DB_PATH",         "packets.db")

# ── Backend sync ──
BACKEND_URL         = os.getenv("UPI_BACKEND_URL",     "http://192.168.1.100:8080")
BRIDGE_NODE_ID      = os.getenv("UPI_BRIDGE_NODE_ID",  "pi-gateway-01")
SYNC_INTERVAL_S     = int(os.getenv("UPI_SYNC_INTERVAL", "5"))
SYNC_BACKOFF_CAP_S  = int(os.getenv("UPI_SYNC_BACKOFF_CAP", "30"))

# ── Minimum ciphertext decoded length: 256 (RSA) + 12 (IV) + 16 (tag) = 284 ──
MIN_CIPHERTEXT_BYTES = 284
