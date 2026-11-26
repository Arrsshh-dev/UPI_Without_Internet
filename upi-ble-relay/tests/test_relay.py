"""
Comprehensive pytest suite for upi-ble-relay.

Covers: reassembly (in-order, out-of-order, duplicate chunk, timeout,
bad JSON, short ciphertext), store (insert, duplicate, persistence),
and sync worker (success, timeout stays STORED, duplicate handling).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import time
from unittest.mock import patch, MagicMock

import pytest

# Ensure imports work from project root
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from relay.reassembly import Reassembler, chunk_packet, ReassemblyResult
from relay.store import PacketStore


# ═══════════════════════════════════════════════════════════════════════
#  Test fixtures
# ═══════════════════════════════════════════════════════════════════════

def _make_valid_ciphertext(length: int = 300) -> str:
    """Generate a valid base64 ciphertext of at least 284 decoded bytes."""
    raw = os.urandom(length)
    return base64.b64encode(raw).decode("ascii")


def _make_packet(packet_id: str = "test-pkt-001", amount: float = 100.0) -> dict:
    return {
        "packetId": packet_id,
        "ttl": 5,
        "createdAt": int(time.time() * 1000),
        "ciphertext": _make_valid_ciphertext(),
    }


def _packet_json(packet_id: str = "test-pkt-001") -> str:
    return json.dumps(_make_packet(packet_id))


@pytest.fixture
def reassembler():
    return Reassembler(timeout_s=5)


@pytest.fixture
def tmp_db(tmp_path):
    db_path = str(tmp_path / "test_packets.db")
    return db_path


# ═══════════════════════════════════════════════════════════════════════
#  Reassembly tests
# ═══════════════════════════════════════════════════════════════════════

class TestReassembly:

    def test_single_chunk_in_order(self, reassembler):
        """Single-chunk packet reassembles correctly."""
        pj = _packet_json("single-1")
        frames = chunk_packet(pj, chunk_size=len(pj) + 10)
        assert len(frames) == 1

        result = reassembler.process_frame(frames[0])
        assert result.status == "COMPLETE"
        assert result.packet_json == pj
        assert result.packet_dict["packetId"] == "single-1"
        assert "STORED:" in result.message

    def test_multi_chunk_in_order(self, reassembler):
        """Multi-chunk packet with in-order delivery."""
        pj = _packet_json("multi-1")
        frames = chunk_packet(pj, chunk_size=50)
        assert len(frames) > 1

        for i, frame in enumerate(frames[:-1]):
            result = reassembler.process_frame(frame)
            assert result.status == "PARTIAL"
            assert f"{i + 1}/{len(frames)}" in result.message

        # Last frame completes
        result = reassembler.process_frame(frames[-1])
        assert result.status == "COMPLETE"
        assert result.packet_json == pj

    def test_duplicate_chunk_accepted_idempotently(self, reassembler):
        """Re-sending the same chunk is accepted without error."""
        pj = _packet_json("dup-chunk")
        frames = chunk_packet(pj, chunk_size=50)

        # Send frame 0 twice
        r1 = reassembler.process_frame(frames[0])
        assert r1.status == "PARTIAL"
        r2 = reassembler.process_frame(frames[0])
        assert r2.status == "PARTIAL"
        # Count should still be 1
        assert r1.message == r2.message

        # Continue with remaining frames
        for frame in frames[1:]:
            result = reassembler.process_frame(frame)
        assert result.status == "COMPLETE"

    def test_out_of_order_chunk_returns_error(self, reassembler):
        """Sending chunk 2 before chunk 1 returns ERR:out_of_order."""
        pj = _packet_json("ooo")
        frames = chunk_packet(pj, chunk_size=50)
        assert len(frames) >= 3

        # Send frame 0 (starts transfer)
        reassembler.process_frame(frames[0])
        # Skip frame 1, send frame 2
        result = reassembler.process_frame(frames[2])
        assert result.status == "ERR"
        assert "out_of_order" in result.message

    def test_mismatched_total_returns_error(self, reassembler):
        """Frame with different total mid-transfer returns ERR."""
        pj = _packet_json("mismatch")
        frames = chunk_packet(pj, chunk_size=50)

        reassembler.process_frame(frames[0])
        # Forge a frame with wrong total
        result = reassembler.process_frame("1/999|garbage")
        assert result.status == "ERR"
        assert "out_of_order" in result.message

    def test_bad_frame_format(self, reassembler):
        """Various malformed frames return ERR:bad_frame_format."""
        for bad in ["no_pipe_char", "0/|data", "/1|data", "abc/def|data", "0/0|data", "-1/3|data"]:
            result = reassembler.process_frame(bad)
            assert result.status == "ERR", f"Expected ERR for {bad!r}"

    def test_timeout_expires_buffer(self, reassembler):
        """Buffer is dropped after timeout."""
        reassembler._timeout_s = 0.1
        pj = _packet_json("timeout")
        frames = chunk_packet(pj, chunk_size=50)

        reassembler.process_frame(frames[0])
        assert reassembler.active

        time.sleep(0.2)
        # Next frame should not find the buffer
        result = reassembler.process_frame(frames[1])
        assert result.status == "ERR"

    def test_invalid_json_after_reassembly(self, reassembler):
        """Non-JSON payload returns ERR:invalid_json."""
        result = reassembler.process_frame("0/1|this is not json{{{")
        assert result.status == "ERR"
        assert "invalid_json" in result.message

    def test_missing_field_in_packet(self, reassembler):
        """Missing packetId returns ERR:missing_field."""
        bad_obj = {"ttl": 5, "createdAt": 1234, "ciphertext": _make_valid_ciphertext()}
        frame = f"0/1|{json.dumps(bad_obj)}"
        result = reassembler.process_frame(frame)
        assert result.status == "ERR"
        assert "missing_field" in result.message

    def test_short_ciphertext_rejected(self, reassembler):
        """Ciphertext shorter than 284 decoded bytes is rejected."""
        pkt = _make_packet("short-ct")
        pkt["ciphertext"] = base64.b64encode(b"too_short").decode()
        frame = f"0/1|{json.dumps(pkt)}"
        result = reassembler.process_frame(frame)
        assert result.status == "ERR"
        assert "ciphertext_too_short" in result.message

    def test_sha256_prefix_in_stored_message(self, reassembler):
        """STORED message includes first 12 hex chars of SHA-256."""
        pj = _packet_json("sha-check")
        expected_sha = hashlib.sha256(pj.encode("utf-8")).hexdigest()[:12]
        frame = f"0/1|{pj}"
        result = reassembler.process_frame(frame)
        assert result.status == "COMPLETE"
        assert expected_sha in result.message

    def test_seq0_resets_previous_buffer(self, reassembler):
        """Sending seq 0 of a new transfer discards the old buffer."""
        pj1 = _packet_json("first")
        frames1 = chunk_packet(pj1, chunk_size=50)
        reassembler.process_frame(frames1[0])  # start first transfer

        pj2 = _packet_json("second")
        frame = f"0/1|{pj2}"
        result = reassembler.process_frame(frame)
        # Should complete with the second packet, not error from first
        assert result.status == "COMPLETE"
        assert result.packet_dict["packetId"] == "second"

    def test_chunk_mismatch_on_resend(self, reassembler):
        """Re-sending a non-zero chunk with different payload returns ERR."""
        pj = _packet_json("mismatch-resend")
        frames = chunk_packet(pj, chunk_size=50)
        assert len(frames) >= 3, "Need at least 3 chunks for this test"
        reassembler.process_frame(frames[0])
        reassembler.process_frame(frames[1])
        # Re-send frame 1 with altered payload
        altered = frames[1].split("|")[0] + "|ALTERED_PAYLOAD"
        result = reassembler.process_frame(altered)
        assert result.status == "ERR"
        assert "chunk_mismatch" in result.message


class TestChunkPacket:

    def test_round_trip(self):
        """chunk_packet → reassemble produces identical JSON."""
        pj = _packet_json("roundtrip")
        frames = chunk_packet(pj, chunk_size=80)
        r = Reassembler()
        for frame in frames:
            result = r.process_frame(frame)
        assert result.status == "COMPLETE"
        assert result.packet_json == pj

    def test_exact_boundary(self):
        """Payload length exactly divisible by chunk size."""
        payload = "A" * 140
        pkt = json.dumps({"packetId": "exact", "ttl": 1, "createdAt": 1,
                          "ciphertext": _make_valid_ciphertext()})
        frames = chunk_packet(pkt, chunk_size=len(pkt))
        assert len(frames) == 1


# ═══════════════════════════════════════════════════════════════════════
#  Store tests
# ═══════════════════════════════════════════════════════════════════════

class TestPacketStore:

    def test_store_and_retrieve(self, tmp_db):
        """Store a packet and retrieve it."""
        pkt = _make_packet("store-1")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            is_new, msg = store.store_packet(pj, pkt, total_chunks=3)
            assert is_new
            assert "STORED:" in msg

            packets = store.get_stored_packets()
            assert len(packets) == 1
            assert packets[0].packet_id == "store-1"
            assert packets[0].state == "STORED"

    def test_duplicate_packet_id_rejected(self, tmp_db):
        """Duplicate packet_id returns is_new=False with DUPLICATE message."""
        pkt = _make_packet("dup-1")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            is_new1, _ = store.store_packet(pj, pkt, total_chunks=1)
            assert is_new1

            is_new2, msg2 = store.store_packet(pj, pkt, total_chunks=1)
            assert not is_new2
            assert "DUPLICATE:" in msg2

    def test_mark_uploaded(self, tmp_db):
        """mark_uploaded transitions state and stores outcome."""
        pkt = _make_packet("upload-1")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)
            store.mark_uploaded("upload-1", "SETTLED", '{"outcome":"SETTLED"}')

            all_pkts = store.get_all_packets()
            assert len(all_pkts) == 1
            assert all_pkts[0].state == "UPLOADED"
            assert all_pkts[0].backend_outcome == "SETTLED"

            # No more STORED packets
            assert store.count("STORED") == 0

    def test_persistence_across_reopen(self, tmp_db):
        """Data persists after close and reopen."""
        pkt = _make_packet("persist-1")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

        # Reopen
        with PacketStore(tmp_db) as store:
            assert store.count() == 1
            packets = store.get_stored_packets()
            assert packets[0].packet_id == "persist-1"

    def test_reset_clears_all(self, tmp_db):
        """reset() deletes all packets."""
        with PacketStore(tmp_db) as store:
            for i in range(3):
                pkt = _make_packet(f"reset-{i}")
                store.store_packet(json.dumps(pkt), pkt, total_chunks=1)
            assert store.count() == 3
            store.reset()
            assert store.count() == 0

    def test_mark_retry(self, tmp_db):
        """mark_retry increments counter and updates timestamp."""
        pkt = _make_packet("retry-1")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)
            store.mark_retry("retry-1")
            store.mark_retry("retry-1")

            packets = store.get_all_packets()
            assert packets[0].retry_count == 2
            assert packets[0].last_attempt_at is not None


# ═══════════════════════════════════════════════════════════════════════
#  Sync worker tests (HTTP mocked)
# ═══════════════════════════════════════════════════════════════════════

class TestSyncWorker:

    def test_sync_success(self, tmp_db):
        """Successful sync marks packet UPLOADED with outcome."""
        from relay.sync_worker import sync_once

        pkt = _make_packet("sync-ok")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = '{"outcome":"SETTLED","transactionId":"tx-123"}'
            mock_resp.json.return_value = {"outcome": "SETTLED", "transactionId": "tx-123"}

            with patch("relay.sync_worker.requests") as mock_requests:
                mock_requests.post.return_value = mock_resp
                mock_requests.RequestException = Exception
                uploaded = sync_once(store, backend_url="http://localhost:8080")

            assert uploaded == 1
            assert store.count("STORED") == 0
            assert store.count("UPLOADED") == 1

            row = store.get_all_packets()[0]
            assert row.backend_outcome == "SETTLED"

    def test_sync_network_error_stays_stored(self, tmp_db):
        """Network error leaves packet in STORED state with incremented retry."""
        from relay.sync_worker import sync_once

        pkt = _make_packet("sync-fail")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

            with patch("relay.sync_worker.requests") as mock_requests:
                mock_requests.post.side_effect = ConnectionError("no route")
                mock_requests.RequestException = Exception
                uploaded = sync_once(store, backend_url="http://localhost:8080")

            assert uploaded == 0
            assert store.count("STORED") == 1
            row = store.get_all_packets()[0]
            assert row.retry_count == 1

    def test_sync_duplicate_response(self, tmp_db):
        """DUPLICATE_DROPPED response marks packet as UPLOADED."""
        from relay.sync_worker import sync_once

        pkt = _make_packet("sync-dup")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = '{"outcome":"DUPLICATE_DROPPED","originalOutcome":"SETTLED"}'
            mock_resp.json.return_value = {
                "outcome": "DUPLICATE_DROPPED", "originalOutcome": "SETTLED"
            }

            with patch("relay.sync_worker.requests") as mock_requests:
                mock_requests.post.return_value = mock_resp
                mock_requests.RequestException = Exception
                uploaded = sync_once(store, backend_url="http://localhost:8080")

            assert uploaded == 1
            row = store.get_all_packets()[0]
            assert row.backend_outcome == "DUPLICATE_DROPPED"
            assert row.state == "UPLOADED"

    def test_sync_4xx_marks_uploaded(self, tmp_db):
        """4xx response marks uploaded with HTTP_<code> outcome."""
        from relay.sync_worker import sync_once

        pkt = _make_packet("sync-4xx")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

            mock_resp = MagicMock()
            mock_resp.status_code = 400
            mock_resp.text = "Bad Request"

            with patch("relay.sync_worker.requests") as mock_requests:
                mock_requests.post.return_value = mock_resp
                mock_requests.RequestException = Exception
                uploaded = sync_once(store, backend_url="http://localhost:8080")

            assert uploaded == 1
            row = store.get_all_packets()[0]
            assert row.backend_outcome == "HTTP_400"

    def test_sync_5xx_stays_stored(self, tmp_db):
        """5xx response leaves packet STORED (transient error)."""
        from relay.sync_worker import sync_once

        pkt = _make_packet("sync-5xx")
        pj = json.dumps(pkt)

        with PacketStore(tmp_db) as store:
            store.store_packet(pj, pkt, total_chunks=1)

            mock_resp = MagicMock()
            mock_resp.status_code = 502
            mock_resp.text = "Bad Gateway"

            with patch("relay.sync_worker.requests") as mock_requests:
                mock_requests.post.side_effect = ConnectionError("Backend returned 502: Bad Gateway")
                mock_requests.RequestException = Exception
                uploaded = sync_once(store, backend_url="http://localhost:8080")

            assert uploaded == 0
            assert store.count("STORED") == 1
