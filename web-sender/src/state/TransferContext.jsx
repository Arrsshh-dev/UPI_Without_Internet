import React, { createContext, useContext, useEffect, useReducer, useState } from 'react';
import { SERVER_PUBLIC_KEY_B64 } from '../config.js';
import { isWebBluetoothSupported, sendPacketOverBle } from '../lib/ble.js';
import { chunkString } from '../lib/chunker.js';
import { loadOutbox, upsertOutboxItem } from '../lib/outbox.js';
import { createEncryptedPacket } from '../lib/packet.js';
import { initialTransferState, transferReducer } from './transferReducer.js';

const TransferContext = createContext(null);

export function TransferProvider({ children }) {
  const [state, dispatch] = useReducer(transferReducer, initialTransferState);
  const [outbox, setOutbox] = useState(() => loadOutbox());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : false
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function createInstruction({ senderVpa, receiverVpa, amount, pin }) {
    const built = await createEncryptedPacket({
      senderVpa,
      receiverVpa,
      amount,
      pin,
      publicKeyB64: SERVER_PUBLIC_KEY_B64,
    });
    const frames = chunkString(built.packetJson);
    const createdAt = built.packet.createdAt;

    dispatch({
      type: 'CREATED',
      senderVpa,
      receiverVpa,
      amount: Number(amount).toFixed(2),
      packet: built.packet,
      packetJson: built.packetJson,
      packetJsonSha256: built.packetJsonSha256,
      ciphertextSha256: built.ciphertextSha256,
      byteLength: built.byteLength,
      totalChunks: frames.length,
      at: createdAt,
    });

    const updated = upsertOutboxItem({
      packetId: built.packet.packetId,
      packetHash: built.ciphertextSha256,
      packetJson: built.packetJson,
      senderVpa,
      receiverVpa,
      amount: Number(amount).toFixed(2),
      createdAt,
      gatewayReceivedAt: null,
      settledAt: null,
      status: 'PENDING_SETTLEMENT',
      reason: null,
    });
    setOutbox(updated);

    return built;
  }

  async function startBleTransfer(overrideBuilt) {
    const pkt = overrideBuilt?.packet || state.packet;
    const pktJson = overrideBuilt?.packetJson || state.packetJson;
    const pktSha = overrideBuilt?.packetJsonSha256 || state.packetJsonSha256;

    if (!pkt || !pktJson) return;

    if (!isWebBluetoothSupported()) {
      dispatch({
        type: 'ERROR',
        reason: 'Web Bluetooth is not available in this browser. Copy packet data below to send manually.',
      });
      return;
    }

    try {
      const res = await sendPacketOverBle({
        packetJson: pktJson,
        packetId: pkt.packetId,
        expectedSha256Prefix: pktSha.slice(0, 12),
        onConnecting: () => dispatch({ type: 'CONNECTING' }),
        onConnected: (name) => dispatch({ type: 'CONNECTED', gatewayName: name, at: Date.now() }),
        onProgress: (sent, total) => dispatch({ type: 'SENDING', sent, total, at: Date.now() }),
      });

      const storedAt = Date.now();
      dispatch({ type: 'STORED', hashMatched: res.hashMatched, at: storedAt });

      const updated = upsertOutboxItem({
        packetId: pkt.packetId,
        gatewayReceivedAt: storedAt,
        status: 'PENDING_SETTLEMENT',
      });
      setOutbox(updated);
    } catch (err) {
      dispatch({
        type: 'ERROR',
        reason: err?.message || 'Connection lost. Move closer to the gateway and retry.',
      });
    }
  }

  function mergeSettlementStatus(packetHash, backendTx) {
    if (!backendTx) return;
    const updated = upsertOutboxItem({
      packetId: backendTx.packetId || undefined,
      packetHash,
      status: backendTx.status,
      reason: backendTx.reason || null,
      gatewayReceivedAt: backendTx.gatewayReceivedAt
        ? Date.parse(backendTx.gatewayReceivedAt)
        : undefined,
      settledAt: backendTx.settledAt ? Date.parse(backendTx.settledAt) : undefined,
    });
    setOutbox(updated);
  }

  return (
    <TransferContext.Provider
      value={{
        state,
        outbox,
        isOnline,
        createInstruction,
        startBleTransfer,
        mergeSettlementStatus,
        resetTransfer: () => dispatch({ type: 'RESET' }),
      }}
    >
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer must be used inside TransferProvider');
  return ctx;
}
