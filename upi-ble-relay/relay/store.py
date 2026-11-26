"""
SQLite durable packet queue.

States: STORED → UPLOADED (terminal).
WAL mode, synchronous=FULL — committed before BLE STORED notify is sent.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Optional

from . import config


_SCHEMA = """
CREATE TABLE IF NOT EXISTS packets (
    packet_id       TEXT UNIQUE NOT NULL,
    packet_json     TEXT NOT NULL,
    sha256          TEXT,
    received_at     INTEGER,
    source_device   TEXT,
    total_chunks    INTEGER,
    state           TEXT NOT NULL DEFAULT 'STORED',
    retry_count     INTEGER DEFAULT 0,
    last_attempt_at INTEGER,
    backend_outcome TEXT,
    backend_response TEXT
);
"""


@dataclass
class PacketRow:
    packet_id: str
    packet_json: str
    sha256: str
    received_at: int
    source_device: Optional[str]
    total_chunks: int
    state: str
    retry_count: int
    last_attempt_at: Optional[int]
    backend_outcome: Optional[str]
    backend_response: Optional[str]


class PacketStore:
    """SQLite-backed durable packet queue."""

    def __init__(self, db_path: str = config.DB_PATH):
        self._db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None

    def open(self) -> None:
        self._conn = sqlite3.connect(self._db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    def store_packet(
        self,
        packet_json: str,
        packet_dict: dict,
        total_chunks: int,
        source_device: Optional[str] = None,
    ) -> tuple[bool, str]:
        """
        Store a fully reassembled packet.
        Returns (is_new, status_message).
        """
        assert self._conn is not None, "Store not opened"

        packet_id = packet_dict["packetId"]
        sha = hashlib.sha256(packet_json.encode("utf-8")).hexdigest()
        received_at = int(time.time() * 1000)

        try:
            self._conn.execute(
                """INSERT INTO packets
                   (packet_id, packet_json, sha256, received_at,
                    source_device, total_chunks, state)
                   VALUES (?, ?, ?, ?, ?, ?, 'STORED')""",
                (packet_id, packet_json, sha, received_at,
                 source_device, total_chunks),
            )
            self._conn.commit()
            return True, f"STORED:{packet_id}:{sha[:12]}"
        except sqlite3.IntegrityError:
            # Duplicate packet_id
            return False, f"DUPLICATE:{packet_id}"

    def get_stored_packets(self) -> list[PacketRow]:
        """Return all packets in STORED state, ordered oldest first."""
        assert self._conn is not None
        rows = self._conn.execute(
            """SELECT packet_id, packet_json, sha256, received_at,
                      source_device, total_chunks, state, retry_count,
                      last_attempt_at, backend_outcome, backend_response
               FROM packets WHERE state = 'STORED'
               ORDER BY received_at ASC"""
        ).fetchall()
        return [PacketRow(*r) for r in rows]

    def mark_uploaded(
        self,
        packet_id: str,
        backend_outcome: str,
        backend_response: str,
    ) -> None:
        """Mark a packet as UPLOADED with the backend's response."""
        assert self._conn is not None
        self._conn.execute(
            """UPDATE packets
               SET state = 'UPLOADED',
                   backend_outcome = ?,
                   backend_response = ?,
                   last_attempt_at = ?
               WHERE packet_id = ?""",
            (backend_outcome, backend_response, int(time.time() * 1000), packet_id),
        )
        self._conn.commit()

    def mark_retry(self, packet_id: str) -> None:
        """Increment retry count and update last attempt timestamp."""
        assert self._conn is not None
        self._conn.execute(
            """UPDATE packets
               SET retry_count = retry_count + 1,
                   last_attempt_at = ?
               WHERE packet_id = ?""",
            (int(time.time() * 1000), packet_id),
        )
        self._conn.commit()

    def get_all_packets(self) -> list[PacketRow]:
        """Return all packets (all states)."""
        assert self._conn is not None
        rows = self._conn.execute(
            """SELECT packet_id, packet_json, sha256, received_at,
                      source_device, total_chunks, state, retry_count,
                      last_attempt_at, backend_outcome, backend_response
               FROM packets ORDER BY received_at ASC"""
        ).fetchall()
        return [PacketRow(*r) for r in rows]

    def reset(self) -> None:
        """Delete all packets. For testing/demo reset only."""
        assert self._conn is not None
        self._conn.execute("DELETE FROM packets")
        self._conn.commit()

    def count(self, state: Optional[str] = None) -> int:
        assert self._conn is not None
        if state:
            return self._conn.execute(
                "SELECT COUNT(*) FROM packets WHERE state = ?", (state,)
            ).fetchone()[0]
        return self._conn.execute("SELECT COUNT(*) FROM packets").fetchone()[0]
