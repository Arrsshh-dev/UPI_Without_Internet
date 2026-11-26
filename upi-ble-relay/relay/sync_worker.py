"""
Sync worker: uploads STORED packets to the Spring Boot backend.

Runs as a loop (for use in a thread or standalone) with exponential backoff
on failures. Never deletes or marks uploaded on network errors — the backend
may have processed the request.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

from . import config
from .store import PacketStore

log = logging.getLogger(__name__)


def _upload_one(
    packet_id: str,
    packet_json: str,
    received_at: Optional[int],
    source_device: Optional[str],
    backend_url: str = config.BACKEND_URL,
    bridge_node_id: str = config.BRIDGE_NODE_ID,
) -> tuple[str, str]:
    """
    POST one packet to the backend.
    Returns (outcome, raw_response_body).
    Raises on network/timeout errors.
    """
    if not HAS_REQUESTS:
        raise ImportError("'requests' library is required for sync. pip install requests")

    headers = {
        "Content-Type": "application/json",
        "X-Bridge-Node-Id": bridge_node_id,
        "X-Hop-Count": "1",
    }
    if received_at is not None:
        headers["X-Received-At"] = str(received_at)
    if source_device:
        headers["X-Source-Device"] = source_device

    url = f"{backend_url.rstrip('/')}/api/bridge/ingest"
    resp = requests.post(url, data=packet_json, headers=headers, timeout=10)
    body = resp.text

    if resp.status_code == 200:
        try:
            result = resp.json()
            outcome = result.get("outcome", "UNKNOWN")
        except Exception:
            outcome = "PARSE_ERROR"
        return outcome, body
    elif 400 <= resp.status_code < 500:
        return f"HTTP_{resp.status_code}", body
    else:
        # 5xx — treat as transient
        raise ConnectionError(f"Backend returned {resp.status_code}: {body}")


def sync_once(store: PacketStore, backend_url: str = config.BACKEND_URL) -> int:
    """
    Try to upload all STORED packets once.
    Returns the number successfully uploaded.
    """
    uploaded = 0
    packets = store.get_stored_packets()

    for pkt in packets:
        try:
            outcome, raw = _upload_one(
                packet_id=pkt.packet_id,
                packet_json=pkt.packet_json,
                received_at=pkt.received_at,
                source_device=pkt.source_device,
                backend_url=backend_url,
            )
            store.mark_uploaded(pkt.packet_id, outcome, raw)
            uploaded += 1
            log.info("Uploaded %s → %s", pkt.packet_id, outcome)

        except (ConnectionError, OSError, requests.RequestException) as e:
            store.mark_retry(pkt.packet_id)
            log.warning("Failed to upload %s (retry #%d): %s",
                        pkt.packet_id, pkt.retry_count + 1, e)

    return uploaded


def sync_loop(
    store: PacketStore,
    backend_url: str = config.BACKEND_URL,
    interval_s: int = config.SYNC_INTERVAL_S,
    max_iterations: Optional[int] = None,
) -> None:
    """
    Blocking loop: sync every interval_s seconds.
    max_iterations=None means run forever; set it for testing.
    """
    iteration = 0
    consecutive_failures = 0

    while max_iterations is None or iteration < max_iterations:
        try:
            uploaded = sync_once(store, backend_url)
            if uploaded > 0:
                consecutive_failures = 0
        except Exception as e:
            consecutive_failures += 1
            log.error("Sync loop error: %s", e)

        # Exponential backoff on consecutive failures
        backoff = min(interval_s * (2 ** consecutive_failures), config.SYNC_BACKOFF_CAP_S)
        wait = interval_s if consecutive_failures == 0 else backoff
        time.sleep(wait)
        iteration += 1
