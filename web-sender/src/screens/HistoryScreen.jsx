import React, { useEffect, useState } from 'react';
import { ConnectionIndicator } from '../components/ConnectionIndicator.jsx';
import { StatusChip } from '../components/StatusChip.jsx';
import { TabBar } from '../components/TabBar.jsx';
import { API_BASE } from '../config.js';
import { useTransfer } from '../state/TransferContext.jsx';
import { formatInr, formatTime, shortPacketId } from '../state/transferReducer.js';

function formatReason(reason) {
  if (!reason) return '';
  const map = {
    insufficient_funds: 'Insufficient funds',
    bad_pin: 'Incorrect PIN',
    amount_exceeds_limit: 'Exceeds ₹500 offline limit',
    unknown_sender: 'Unknown sender account',
    unknown_receiver: 'Unknown receiver account',
    decryption_failed: 'Decryption failed',
  };
  return map[reason] || reason;
}

export function HistoryScreen() {
  const { outbox, mergeSettlementStatus } = useTransfer();
  const [selected, setSelected] = useState(null);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  useEffect(() => {
    if (isHttps) return undefined;

    const pending = outbox.filter(
      (item) => item.status === 'PENDING_SETTLEMENT' && item.packetHash
    );
    if (pending.length === 0) return undefined;

    let cancelled = false;
    async function poll() {
      for (const item of pending) {
        if (cancelled) break;
        try {
          const resp = await fetch(`${API_BASE}/api/transactions/by-hash/${item.packetHash}`);
          if (resp.ok) {
            const tx = await resp.json();
            mergeSettlementStatus(item.packetHash, tx);
          }
        } catch {
          // Offline or backend unreachable — keep polling silently
        }
      }
    }

    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isHttps, outbox.length]);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">Offline Pay</h1>
        <ConnectionIndicator />
      </header>

      <main className="main-content main-content--compact">
        <div className="page-heading">
          <h2>History</h2>
          {isHttps && outbox.length > 0 && (
            <p>Settlement polling is disabled on HTTPS. Open from the local backend to refresh.</p>
          )}
        </div>

        {outbox.length === 0 ? (
          <p className="empty-state">No payment instructions yet.</p>
        ) : (
          <ul className="list-divider">
            {outbox.map((item) => (
              <li key={item.packetId}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className="list-row-btn"
                >
                  <div className="row-col-left">
                    <span className="row-primary">{item.receiverVpa}</span>
                    <span className="row-secondary tabular">{formatTime(item.createdAt)}</span>
                  </div>
                  <div className="row-col-right">
                    <span className="row-amount">{formatInr(item.amount)}</span>
                    <StatusChip status={item.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {selected && (
        <div
          className="sheet-backdrop"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Instruction details"
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <div className="row-col-left">
                <span className="topbar-title">{selected.receiverVpa}</span>
                <span className="balance-amount" style={{ fontSize: '22px', lineHeight: '28px' }}>
                  {formatInr(selected.amount)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close detail sheet"
                className="sheet-close"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="form-stack" style={{ gap: '12px' }}>
              <div className="kv-row">
                <span className="kv-label">Status</span>
                <StatusChip status={selected.status} />
              </div>
              <div className="kv-row">
                <span className="kv-label">Packet ID</span>
                <span className="mono">{shortPacketId(selected.packetId)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Gateway receive time</span>
                <span className="kv-val tabular">{formatTime(selected.gatewayReceivedAt)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Settle time</span>
                <span className="kv-val tabular">{formatTime(selected.settledAt)}</span>
              </div>
              {selected.reason && (
                <div className="kv-row divider-top">
                  <span className="kv-label">Rejection reason</span>
                  <span className="row-primary">{formatReason(selected.reason)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <TabBar />
    </>
  );
}
