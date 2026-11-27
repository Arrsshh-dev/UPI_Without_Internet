import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatusChip } from '../components/StatusChip.jsx';
import { StepTracker } from '../components/StepTracker.jsx';
import { isWebBluetoothSupported } from '../lib/ble.js';
import { chunkString } from '../lib/chunker.js';
import { useTransfer } from '../state/TransferContext.jsx';
import { formatInr, formatTime, shortHash, shortPacketId } from '../state/transferReducer.js';

export function TransferScreen() {
  const navigate = useNavigate();
  const { state, startBleTransfer } = useTransfer();
  const [copiedLabel, setCopiedLabel] = useState('');

  const bleSupported = isWebBluetoothSupported();
  const frames = state.packetJson ? chunkString(state.packetJson) : [];

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(''), 2000);
    } catch {
      setCopiedLabel('Copy failed');
    }
  }

  function handleCopyPacket() {
    if (!state.packetJson) return;
    copyText(state.packetJson, 'packet');
  }

  function handleCopyChunks() {
    if (frames.length === 0) return;
    copyText(frames.join('\n'), 'chunks');
  }

  if (state.phase === 'IDLE' || !state.packet) {
    return (
      <>
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              onClick={() => navigate('/')}
              aria-label="Back to Send payment"
              className="icon-btn"
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
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="topbar-title">Transfer to gateway</h1>
          </div>
        </header>
        <main className="main-content">
          <p className="empty-state">No active payment instruction.</p>
          <Link to="/" className="btn-primary">
            Create encrypted instruction
          </Link>
        </main>
      </>
    );
  }

  const isStored = state.phase === 'STORED' || state.phase === 'PENDING_SETTLEMENT';
  const isError = state.phase === 'ERROR';

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to Send payment"
            className="icon-btn"
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
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="topbar-title">Transfer to gateway</h1>
        </div>
        <span className="row-secondary tabular">{formatInr(state.amount)}</span>
      </header>

      <main className="main-content">
        <StepTracker state={state} />

        {/* Packet Metadata Card */}
        <article className="card">
          <header className="card-header">
            <h2 className="card-title">Packet details</h2>
            <span className="mono">{state.byteLength} bytes</span>
          </header>
          <div className="kv-row">
            <span className="kv-label">Packet ID</span>
            <span className="mono">{shortPacketId(state.packet.packetId)}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Verification hash</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span className="mono">{shortHash(state.packetJsonSha256)}</span>
              {state.hashMatched && (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-label="Hash matched"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </span>
          </div>
        </article>

        {/* Browser without Web Bluetooth */}
        {!bleSupported && !isStored && (
          <section className="card">
            <p style={{ margin: 0 }}>
              Web Bluetooth is not supported in this browser. Copy and send each chunk below one by
              one in nRF Connect (UTF-8 Text mode).
            </p>
            {frames.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '8px',
                }}
              >
                {frames.map((frame, idx) => {
                  const tag = `chunk-${idx}`;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => copyText(frame, tag)}
                      className="btn-compact"
                      style={{
                        minHeight: '44px',
                        color: copiedLabel === tag ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                        backgroundColor:
                          copiedLabel === tag ? 'var(--color-primary)' : 'var(--color-surface)',
                      }}
                    >
                      {copiedLabel === tag ? `Copied ${idx + 1}/${frames.length}` : `Copy ${idx + 1}/${frames.length}`}
                    </button>
                  );
                })}
              </div>
            )}
            <button type="button" onClick={handleCopyChunks} className="btn-secondary">
              {copiedLabel === 'chunks' ? 'Copied all chunks' : 'Copy all chunks'}
            </button>
            <button type="button" onClick={handleCopyPacket} className="btn-secondary">
              {copiedLabel === 'packet' ? 'Copied packet JSON' : 'Copy packet JSON'}
            </button>
          </section>
        )}

        {/* Created but not started (e.g. if user navigated directly) */}
        {bleSupported && state.phase === 'CREATED' && (
          <section className="card">
            <button type="button" onClick={() => startBleTransfer()} className="btn-primary">
              Connect and send to gateway
            </button>
          </section>
        )}

        {/* Final State Banner (Stored) */}
        {isStored && (
          <section className="card">
            <div className="kv-row">
              <StatusChip status="PENDING_SETTLEMENT" />
              <span className="row-secondary tabular">
                {formatTime(state.timestamps.storedAt)}
              </span>
            </div>
            <p style={{ margin: 0 }}>
              Stored on gateway. Waiting for the gateway to get internet.
            </p>
            <Link to="/history" className="btn-primary">
              View in history
            </Link>
          </section>
        )}

        {/* Error State Banner (only when Web Bluetooth is supported) */}
        {bleSupported && isError && (
          <section className="card">
            <p style={{ margin: 0 }}>
              {state.errorReason || 'Connection lost. Move closer to the gateway and retry.'}
            </p>
            <div className="form-stack" style={{ gap: '8px' }}>
              <button type="button" onClick={() => startBleTransfer()} className="btn-primary">
                Retry
              </button>
              <button type="button" onClick={handleCopyChunks} className="btn-secondary">
                {copiedLabel === 'chunks' ? 'Copied BLE chunks' : 'Copy chunks'}
              </button>
              <button type="button" onClick={handleCopyPacket} className="btn-secondary">
                {copiedLabel === 'packet' ? 'Copied packet JSON' : 'Copy packet data'}
              </button>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
