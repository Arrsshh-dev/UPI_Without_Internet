# Offline Pay (`web-sender/`)

React 18 + Vite client for **offline payment instruction transfer with deferred simulated settlement**.

> **Honest scope:** Creating or sending an instruction to the Bluetooth gateway does **not** complete a payment. It transfers an encrypted payment instruction to the Raspberry Pi gateway, which later uploads it to the Spring Boot backend for simulated ledger settlement. This is not connected to NPCI or any bank.

---

## Run Locally

```powershell
cd web-sender
npm install
npm run dev
```

## Build & Copy to Spring Boot

```powershell
cd web-sender
npm run build
npm run copy-to-spring
```

This copies `web-sender/dist` into `src/main/resources/static/app/`, so Spring Boot serves the app at:
- `http://localhost:8080/app/`
- `http://localhost:8080/bob` (redirects to `/app/#/receive?vpa=bob@demo`)

> **Note on HTTPS vs HTTP:**
> - **GitHub Pages (HTTPS)** is used for the **Send** and **Transfer** screens because Web Bluetooth (`navigator.bluetooth`) requires a secure HTTPS context.
> - **Spring Boot (HTTP)** is used for the **Receive** and **History** settlement polling views, because browsers block mixed-content HTTP requests from an HTTPS page.

---

## Refresh the Server Public Key

The RSA-2048 public key is baked into `src/config.js` at build time (never fetched at runtime):

```powershell
cd web-sender
.\scripts\export-public-key.ps1
```

---

## Cross-Language Crypto Compatibility Test (`make-packet.mjs`)

`tools/make-packet.mjs` imports the exact `src/lib/packet.js` and `src/config.js` used by the UI and generates a `MeshPacket` JSON using Node's WebCrypto:

```powershell
# Run unit tests (chunker + packet)
npm test

# Generate a real packet and POST it to the running Spring Boot backend
node tools/make-packet.mjs alice@demo bob@demo 100.00 1234 |
  Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/bridge/ingest -ContentType "application/json" -Body { $input }
```

Expected response: `outcome: "SETTLED"`.

---

## Deploy to GitHub Pages

Pushing changes under `web-sender/` to `main` triggers `.github/workflows/deploy-pages.yml`, which builds with `VITE_BASE=/UPI_Without_Internet/` and deploys `web-sender/dist` to GitHub Pages.

For manual deploy, build with:
```bash
VITE_BASE=/UPI_Without_Internet/ npm run build
```

---

## Fallback: Testing Without Web Bluetooth (nRF Connect)

Web Bluetooth (`navigator.bluetooth`) is supported in Android Chrome and desktop Chrome/Edge, **not** standard iOS Safari.

- If `navigator.bluetooth` is unavailable, the **Transfer to gateway** screen automatically displays **Copy chunks** (formatted as `<seq>/<total>|<payload>`, 140 chars each) and **Copy packet JSON**.
- Paste the chunks sequentially in UTF-8 / Text mode into characteristic `7e400002-b5a3-f393-e0a9-e50e24dcca9e` on `UPI-Gateway-01` in **nRF Connect**.

> **⚠️ Hardware verification note:** The Web Bluetooth transport in `src/lib/ble.js` cannot be tested in automated unit tests and is **untested against a physical phone + Raspberry Pi** until verified by hand.
