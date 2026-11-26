export function formatTime(epochMs) {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

export function formatInr(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '₹0.00';
  return (
    '₹' +
    num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function shortPacketId(packetId) {
  if (!packetId) return '—';
  return `PKT-${packetId.slice(0, 4).toUpperCase()}-${packetId.slice(9, 13).toUpperCase()}`;
}

export function shortHash(sha256) {
  if (!sha256) return '—';
  return `sha256:${sha256.slice(0, 4)}...${sha256.slice(-4)}`;
}

export const initialTransferState = {
  phase: 'IDLE', // IDLE | CREATED | CONNECTING | SENDING | STORED | PENDING_SETTLEMENT | ERROR
  senderVpa: 'alice@demo',
  receiverVpa: 'bob@demo',
  amount: '500.00',
  packet: null,
  packetJson: '',
  packetJsonSha256: '',
  ciphertextSha256: '',
  byteLength: 0,
  sentChunks: 0,
  totalChunks: 0,
  hashMatched: false,
  gatewayName: '',
  errorReason: '',
  timestamps: {
    createdAt: null,
    connectedAt: null,
    sendingAt: null,
    storedAt: null,
  },
};

export function transferReducer(state, action) {
  switch (action.type) {
    case 'CREATED':
      return {
        ...initialTransferState,
        phase: 'CREATED',
        senderVpa: action.senderVpa,
        receiverVpa: action.receiverVpa,
        amount: action.amount,
        packet: action.packet,
        packetJson: action.packetJson,
        packetJsonSha256: action.packetJsonSha256,
        ciphertextSha256: action.ciphertextSha256,
        byteLength: action.byteLength,
        totalChunks: action.totalChunks,
        timestamps: {
          createdAt: action.at || Date.now(),
          connectedAt: null,
          sendingAt: null,
          storedAt: null,
        },
      };
    case 'CONNECTING':
      return {
        ...state,
        phase: 'CONNECTING',
        errorReason: '',
      };
    case 'CONNECTED':
      return {
        ...state,
        gatewayName: action.gatewayName || 'UPI-Gateway-01',
        timestamps: { ...state.timestamps, connectedAt: action.at || Date.now() },
      };
    case 'SENDING':
      return {
        ...state,
        phase: 'SENDING',
        sentChunks: action.sent,
        totalChunks: action.total,
        timestamps: {
          ...state.timestamps,
          sendingAt: state.timestamps.sendingAt || action.at || Date.now(),
        },
      };
    case 'STORED':
      return {
        ...state,
        phase: 'PENDING_SETTLEMENT',
        hashMatched: Boolean(action.hashMatched),
        timestamps: { ...state.timestamps, storedAt: action.at || Date.now() },
      };
    case 'ERROR':
      return {
        ...state,
        phase: 'ERROR',
        errorReason: action.reason || 'Connection lost. Move closer to the gateway and retry.',
      };
    case 'RESET':
      return initialTransferState;
    default:
      return state;
  }
}
