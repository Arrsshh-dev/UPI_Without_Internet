"""
Frame reassembly logic for BLE chunked transfers.

Frame format (UTF-8 string): "<seq>/<total>|<payload>"
  - seq: 0-based chunk index
  - total: total number of chunks
  - payload: slice of the MeshPacket JSON string

This module is pure logic — no BLE, no I/O — and fully unit-testable.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Optional

from . import config


@dataclass
class TransferBuffer:
    """In-progress chunked transfer."""
    total: int
    chunks: dict[int, str] = field(default_factory=dict)
    last_activity: float = field(default_factory=time.time)

    @property
    def received_count(self) -> int:
        return len(self.chunks)

    @property
    def is_complete(self) -> bool:
        return self.received_count == self.total


@dataclass
class ReassemblyResult:
    """Outcome of processing a single frame."""
    status: str           # PARTIAL, COMPLETE, ERR
    message: str          # Human-readable status string (the BLE notify value)
    packet_json: Optional[str] = None   # Set only on COMPLETE
    packet_dict: Optional[dict] = None  # Parsed MeshPacket dict


class Reassembler:
    """
    Stateful reassembler for one connection at a time.
    Thread-safety is not needed: BLE writes are sequential per-connection.
    """

    def __init__(self, timeout_s: int = config.TRANSFER_TIMEOUT_S):
        self._buf: Optional[TransferBuffer] = None
        self._timeout_s = timeout_s

    def _expire_if_stale(self) -> None:
        if self._buf and (time.time() - self._buf.last_activity > self._timeout_s):
            self._buf = None

    def process_frame(self, frame: str) -> ReassemblyResult:
        """
        Process one incoming BLE write frame.
        Returns a ReassemblyResult whose .message is what gets sent as BLE notify.
        """
        self._expire_if_stale()

        # ── Parse frame header ──
        pipe_idx = frame.find("|")
        if pipe_idx < 0:
            return ReassemblyResult("ERR", "ERR:bad_frame_format")

        header = frame[:pipe_idx]
        payload = frame[pipe_idx + 1:]

        slash_idx = header.find("/")
        if slash_idx < 0:
            return ReassemblyResult("ERR", "ERR:bad_frame_format")

        try:
            seq = int(header[:slash_idx])
            total = int(header[slash_idx + 1:])
        except ValueError:
            return ReassemblyResult("ERR", "ERR:bad_frame_format")

        if total < 1 or seq < 0 or seq >= total:
            return ReassemblyResult("ERR", "ERR:bad_frame_format")

        # ── seq 0 always starts a new transfer ──
        if seq == 0:
            self._buf = TransferBuffer(total=total)

        if self._buf is None:
            return ReassemblyResult("ERR", "ERR:no_active_transfer")

        # ── Mismatched total ──
        if total != self._buf.total:
            return ReassemblyResult("ERR", "ERR:out_of_order")

        # ── Out-of-order detection (gaps) ──
        # We allow re-sent chunks idempotently, but new chunks must not skip
        if seq not in self._buf.chunks and seq > self._buf.received_count:
            # There's a gap — keep the buffer but warn
            return ReassemblyResult("ERR", "ERR:out_of_order")

        # ── Accept chunk (idempotent for identical re-sends) ──
        if seq in self._buf.chunks:
            if self._buf.chunks[seq] != payload:
                return ReassemblyResult("ERR", "ERR:chunk_mismatch")
            # Identical re-send — accept silently
        else:
            self._buf.chunks[seq] = payload

        self._buf.last_activity = time.time()

        # ── Not yet complete ──
        if not self._buf.is_complete:
            return ReassemblyResult(
                "PARTIAL",
                f"PARTIAL:{self._buf.received_count}/{self._buf.total}",
            )

        # ── Complete: join and validate ──
        full_json = "".join(self._buf.chunks[i] for i in range(self._buf.total))
        self._buf = None  # reset for next transfer

        return self._validate_complete(full_json)

    @staticmethod
    def _validate_complete(full_json: str) -> ReassemblyResult:
        """Validate the reassembled JSON as a MeshPacket."""
        try:
            obj = json.loads(full_json)
        except json.JSONDecodeError:
            return ReassemblyResult("ERR", "ERR:invalid_json")

        # Required fields
        required = ("packetId", "ttl", "createdAt", "ciphertext")
        for field_name in required:
            if field_name not in obj:
                return ReassemblyResult("ERR", f"ERR:missing_field:{field_name}")

        if not obj.get("packetId") or not obj.get("ciphertext"):
            return ReassemblyResult("ERR", "ERR:empty_required_field")

        # Validate ciphertext is valid Base64 and long enough
        try:
            ct_bytes = base64.b64decode(obj["ciphertext"])
        except Exception:
            return ReassemblyResult("ERR", "ERR:invalid_base64_ciphertext")

        if len(ct_bytes) < config.MIN_CIPHERTEXT_BYTES:
            return ReassemblyResult("ERR", "ERR:ciphertext_too_short")

        # Compute SHA-256 of the full JSON string for integrity verification
        sha = hashlib.sha256(full_json.encode("utf-8")).hexdigest()

        return ReassemblyResult(
            status="COMPLETE",
            message=f"STORED:{obj['packetId']}:{sha[:12]}",
            packet_json=full_json,
            packet_dict=obj,
        )

    def reset(self) -> None:
        """Discard any in-progress transfer."""
        self._buf = None

    @property
    def active(self) -> bool:
        """Whether there's an in-progress transfer."""
        self._expire_if_stale()
        return self._buf is not None


def chunk_packet(packet_json: str, chunk_size: int = config.CHUNK_PAYLOAD_SIZE) -> list[str]:
    """
    Split a MeshPacket JSON string into BLE write frames.
    Returns a list of frame strings: "0/N|...", "1/N|...", etc.
    """
    total = (len(packet_json) + chunk_size - 1) // chunk_size
    frames = []
    for i in range(total):
        start = i * chunk_size
        end = start + chunk_size
        payload = packet_json[start:end]
        frames.append(f"{i}/{total}|{payload}")
    return frames
