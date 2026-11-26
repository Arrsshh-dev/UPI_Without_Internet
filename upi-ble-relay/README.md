# upi-ble-relay — Raspberry Pi BLE Gateway

A Python BLE GATT peripheral that receives encrypted UPI payment packets
from phones over Bluetooth, stores them durably in SQLite, and uploads
them to the Spring Boot backend when internet is available.

> **Honest scope:** This is a prototype for offline payment *instruction transfer*
> with deferred simulated settlement. A BLE acknowledgement means "received by
> the gateway", never "paid". This is not connected to NPCI, any bank, or
> real UPI infrastructure.

---

## Architecture

```
┌──────────────┐    BLE GATT     ┌────────────────┐    HTTP (when online)    ┌──────────────┐
│  Sender App  │ ──── write ───► │  Raspberry Pi  │ ──── POST /ingest ────► │   Backend    │
│  (iPhone)    │ ◄── notify ──── │  upi-ble-relay │                         │  Spring Boot │
└──────────────┘                 └────────────────┘                         └──────────────┘
                                   │                                           │
                                   ├─ SQLite queue (packets.db)                ├─ H2 ledger
                                   ├─ Chunk reassembly                         ├─ Decrypt
                                   └─ Sync worker (retry w/ backoff)           └─ Settle
```

## Directory Structure

```
upi-ble-relay/
├── relay/
│   ├── __init__.py
│   ├── config.py          # All config (env-overridable)
│   ├── reassembly.py      # Frame parsing + reassembly (pure, tested)
│   ├── store.py           # SQLite durable queue (pure, tested)
│   ├── sync_worker.py     # Upload loop with backoff (HTTP mocked in tests)
│   ├── gatt_server.py     # BlueZ GATT peripheral (⚠️ hardware-only)
│   └── cli.py             # CLI: simulate-write, sync-now, list, reset
├── tests/
│   └── test_relay.py      # 24 pytest cases
├── systemd/
│   └── upi-relay.service  # systemd unit file
├── requirements.txt
└── README.md              # ← You are here
```

---

## Quick Start (Laptop — No BLE Required)

Test the full pipeline locally using the CLI:

```powershell
# From the repo root on Windows
cd upi-ble-relay
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Run the test suite
python -m pytest tests/ -v

# Simulate a BLE write from a fixture file
python -m relay.cli simulate-write ../fixtures/packet-alice-bob-500.json

# List the queue
python -m relay.cli list

# Sync to the running backend (start the Spring Boot app first)
python -m relay.cli --backend-url http://localhost:8080 sync-now

# Check the queue again — should show UPLOADED/SETTLED
python -m relay.cli list
```

---

## Raspberry Pi Setup (Step by Step)

### Prerequisites

| Item | Minimum | Recommended |
|------|---------|-------------|
| Raspberry Pi | 3B+ | 4B or 5 |
| OS | Raspberry Pi OS Lite (64-bit) | Same |
| BlueZ | 5.50+ | 5.66+ (ships with recent Pi OS) |
| Python | 3.9+ | 3.11+ |
| Network | WiFi or Ethernet (for sync) | Laptop hotspot |

### Step 1: Flash Raspberry Pi OS

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Flash **Raspberry Pi OS Lite (64-bit)** to your SD card
3. In Imager settings (⚙️):
   - Enable SSH
   - Set username: `pi`, password: your choice
   - Configure WiFi to your laptop's hotspot SSID
4. Insert SD card and boot the Pi

### Step 2: SSH into the Pi

```bash
# Find the Pi on your network (or use hostname)
ssh pi@raspberrypi.local
# or
ssh pi@<Pi-IP-address>
```

### Step 3: Update and install dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip bluetooth bluez libdbus-1-dev libglib2.0-dev

# Verify BlueZ version (need 5.50+)
bluetoothctl --version
```

### Step 4: Enable Bluetooth

```bash
# Ensure Bluetooth service is running
sudo systemctl enable bluetooth
sudo systemctl start bluetooth

# Verify adapter is detected
bluetoothctl show
# Should show: Controller XX:XX:XX:XX:XX:XX ... Powered: yes

# If Powered: no, run:
bluetoothctl power on
```

### Step 5: Clone the repo and install

```bash
cd ~
git clone https://github.com/perryvegehan/UPI_Without_Internet.git
cd UPI_Without_Internet/upi-ble-relay

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install bluezero    # BLE library (Pi only)
```

### Step 6: Configure the backend URL

The Pi needs to reach your Windows laptop running the Spring Boot backend.

```bash
# Find your laptop's IP on the hotspot network
# On Windows: ipconfig → look for the hotspot adapter IP (e.g. 192.168.137.1)

# Set the backend URL
export UPI_BACKEND_URL=http://192.168.137.1:8080

# Verify connectivity (backend must be running)
curl -s http://192.168.137.1:8080/api/server-key | head -c 40
# Should print the first 40 chars of the Base64 public key
```

### Step 7: Run the tests (no BLE needed)

```bash
python -m pytest tests/ -v
# All 24 tests should pass
```

### Step 8: Test the pipeline with fixtures

```bash
# Simulate a BLE write
python -m relay.cli simulate-write ../fixtures/packet-alice-bob-500.json

# Sync to the backend
python -m relay.cli --backend-url $UPI_BACKEND_URL sync-now

# Check result
python -m relay.cli list
# Should show: UPLOADED / SETTLED
```

### Step 9: Start the GATT server (BLE advertising)

```bash
# Must run as root for BLE advertising
sudo venv/bin/python -c "from relay.gatt_server import start_gatt_server; from relay.store import PacketStore; store = PacketStore('packets.db'); store.open(); start_gatt_server(store)"
```

The Pi should now advertise as **"UPI-Gateway-01"**.

**Verify with nRF Connect (iPhone/Android):**

1. Open nRF Connect → Scan → Find "UPI-Gateway-01"
2. Connect → Expand service `7e400001-b5a3-f393-e0a9-e50e24dcca9e`
3. Subscribe to notifications on `7e400003-...` (Status)
4. Write a test frame to `7e400002-...` (Packet):
   ```
   0/1|{"packetId":"nrf-test","ttl":5,"createdAt":1700000000000,"ciphertext":"<valid-b64>"}
   ```
5. Status char should notify with `STORED:nrf-test:<sha-prefix>`

### Step 10: Install as a systemd service (auto-start on boot)

```bash
# Edit the service file to match your backend IP
sudo cp systemd/upi-relay.service /etc/systemd/system/
sudo nano /etc/systemd/system/upi-relay.service
# Update: Environment=UPI_BACKEND_URL=http://<your-laptop-ip>:8080

sudo systemctl daemon-reload
sudo systemctl enable upi-relay
sudo systemctl start upi-relay

# Check logs
sudo journalctl -u upi-relay -f
```

### Step 11: Verify persistence across reboot

```bash
# Store a packet
python -m relay.cli simulate-write ../fixtures/packet-alice-bob-500.json

# Reboot the Pi
sudo reboot

# After reboot, SSH back in and check
cd ~/UPI_Without_Internet/upi-ble-relay
source venv/bin/activate
python -m relay.cli list
# The packet should still be in STORED state
```

---

## Configuration Reference

All settings are overridable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `UPI_SERVICE_UUID` | `7e400001-b5a3-...` | BLE GATT service UUID |
| `UPI_PACKET_CHAR_UUID` | `7e400002-b5a3-...` | Packet write characteristic UUID |
| `UPI_STATUS_CHAR_UUID` | `7e400003-b5a3-...` | Status read/notify characteristic UUID |
| `UPI_DEVICE_NAME` | `UPI-Gateway-01` | BLE advertised name |
| `UPI_CHUNK_SIZE` | `140` | Max chars per BLE frame payload |
| `UPI_TRANSFER_TIMEOUT` | `30` | Seconds before partial buffer expires |
| `UPI_DB_PATH` | `packets.db` | SQLite database file path |
| `UPI_BACKEND_URL` | `http://192.168.1.100:8080` | Spring Boot backend URL |
| `UPI_BRIDGE_NODE_ID` | `pi-gateway-01` | Bridge identifier sent to backend |
| `UPI_SYNC_INTERVAL` | `5` | Seconds between sync attempts |
| `UPI_SYNC_BACKOFF_CAP` | `30` | Max backoff seconds on failure |

---

## Frame Protocol

Each BLE write is one UTF-8 string: `<seq>/<total>|<payload>`

```
0/6|{"packetId":"abc-
1/6|123","ttl":5,"c
2/6|reatedAt":17000
3/6|00000000,"ciphe
4/6|rtext":"MIIB...
5/6|...base64..."}
```

**Status notify responses:**
- `PARTIAL:3/6` — Received 3 of 6 chunks
- `STORED:<packetId>:<sha256-first-12-hex>` — Stored successfully
- `DUPLICATE:<packetId>` — Already stored
- `ERR:out_of_order` — Gap in chunk sequence
- `ERR:invalid_json` — Reassembled payload isn't valid JSON
- `ERR:ciphertext_too_short` — Ciphertext < 284 bytes decoded

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Pi not advertising | `sudo hciconfig hci0 up` then restart the GATT server |
| "Permission denied" on BLE | Run with `sudo` — BLE advertising requires root |
| Cannot reach backend | Check `curl $UPI_BACKEND_URL/api/server-key` from the Pi |
| bluezero import error | `pip install bluezero` (Pi only, needs BlueZ dev libs) |
| nRF Connect can't find Pi | Move phone closer; ensure `bluetoothctl show` says `Powered: yes` |
| Packets stuck in STORED | Check `--backend-url` is correct; check Pi has internet |

---

## ⚠️ Hardware Verification Status

| Feature | Verified? | Notes |
|---------|-----------|-------|
| Reassembly logic | ✅ Tested | 14 pytest cases, pure Python |
| SQLite store | ✅ Tested | 6 pytest cases, WAL mode |
| Sync worker | ✅ Tested | 5 pytest cases, HTTP mocked |
| CLI simulate-write | ✅ Tested | Full pipeline without BLE |
| GATT server (bluezero) | ❌ Not verified | Requires real Pi + phone |
| BLE advertising | ❌ Not verified | Requires real Pi |
| nRF Connect interop | ❌ Not verified | Manual test with phone |
| Multi-phone connections | ❌ Not verified | Sequential only expected |
