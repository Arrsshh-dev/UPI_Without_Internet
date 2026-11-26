"""
CLI for the UPI BLE Relay gateway.

Commands:
  simulate-write FILE   Feed a MeshPacket JSON file through reassembly → store
  sync-now              Upload all STORED packets to the backend immediately
  list                  Show all packets in the queue
  reset                 Delete all packets (demo reset only)
"""
from __future__ import annotations

import argparse
import json
import sys

from .reassembly import Reassembler, chunk_packet
from .store import PacketStore
from .sync_worker import sync_once
from . import config


def cmd_simulate_write(args):
    """Feed a MeshPacket JSON file through chunking → reassembly → store."""
    with open(args.file, "r", encoding="utf-8") as f:
        packet_json = f.read().strip()

    # Validate it's JSON
    try:
        json.loads(packet_json)
    except json.JSONDecodeError as e:
        print(f"ERROR: File is not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    # Chunk it
    frames = chunk_packet(packet_json, config.CHUNK_PAYLOAD_SIZE)
    print(f"Chunked into {len(frames)} frames ({config.CHUNK_PAYLOAD_SIZE} chars each)")

    # Reassemble (simulates BLE writes)
    reassembler = Reassembler()
    result = None
    for i, frame in enumerate(frames):
        result = reassembler.process_frame(frame)
        if result.status == "ERR":
            print(f"ERROR at frame {i}: {result.message}", file=sys.stderr)
            sys.exit(1)
        elif result.status == "PARTIAL":
            print(f"  Frame {i}: {result.message}")

    if result is None or result.status != "COMPLETE":
        print("ERROR: Reassembly did not complete", file=sys.stderr)
        sys.exit(1)

    print(f"Reassembly complete: {result.message}")

    # Store in SQLite
    with PacketStore(args.db) as store:
        is_new, msg = store.store_packet(
            result.packet_json, result.packet_dict,
            total_chunks=len(frames),
            source_device="cli-simulate",
        )
        if is_new:
            print(f"✓ {msg}")
        else:
            print(f"⚠ {msg}")


def cmd_sync_now(args):
    """Upload all STORED packets to the backend."""
    with PacketStore(args.db) as store:
        stored = store.count("STORED")
        if stored == 0:
            print("No STORED packets to sync.")
            return

        print(f"Syncing {stored} packet(s) to {args.backend_url} ...")
        uploaded = sync_once(store, backend_url=args.backend_url)
        print(f"Uploaded: {uploaded}, Remaining: {store.count('STORED')}")


def cmd_list(args):
    """List all packets in the queue."""
    with PacketStore(args.db) as store:
        packets = store.get_all_packets()
        if not packets:
            print("Queue is empty.")
            return

        print(f"{'PACKET ID':<40} {'STATE':<12} {'OUTCOME':<20} {'RETRIES':<8} {'SHA256'}")
        print("-" * 120)
        for p in packets:
            sha_short = (p.sha256 or "")[:12]
            outcome = p.backend_outcome or "-"
            print(f"{p.packet_id:<40} {p.state:<12} {outcome:<20} {p.retry_count:<8} {sha_short}")


def cmd_reset(args):
    """Delete all packets from the queue."""
    with PacketStore(args.db) as store:
        count = store.count()
        store.reset()
        print(f"Deleted {count} packet(s).")


def main():
    parser = argparse.ArgumentParser(
        prog="upi-relay",
        description="UPI BLE Relay Gateway CLI",
    )
    parser.add_argument(
        "--db", default=config.DB_PATH,
        help=f"SQLite database path (default: {config.DB_PATH})",
    )
    parser.add_argument(
        "--backend-url", default=config.BACKEND_URL,
        help=f"Backend URL (default: {config.BACKEND_URL})",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_sim = sub.add_parser("simulate-write", help="Simulate a BLE write from a JSON file")
    p_sim.add_argument("file", help="Path to MeshPacket JSON file")
    p_sim.set_defaults(func=cmd_simulate_write)

    p_sync = sub.add_parser("sync-now", help="Upload STORED packets to backend")
    p_sync.set_defaults(func=cmd_sync_now)

    p_list = sub.add_parser("list", help="List all packets in queue")
    p_list.set_defaults(func=cmd_list)

    p_reset = sub.add_parser("reset", help="Delete all packets")
    p_reset.set_defaults(func=cmd_reset)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
