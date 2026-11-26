import React from 'react';
import { useTransfer } from '../state/TransferContext.jsx';

export function ConnectionIndicator() {
  const { state, isOnline } = useTransfer();

  let gatewayText = 'Not connected';
  if (state.phase === 'CONNECTING') gatewayText = 'Connecting';
  else if (state.phase === 'SENDING') gatewayText = state.gatewayName || 'Connected';
  else if (state.phase === 'STORED' || state.phase === 'PENDING_SETTLEMENT') {
    gatewayText = state.gatewayName || 'Stored';
  }

  return (
    <div className="conn-indicator">
      <div className="conn-item">
        <span className="conn-dot" aria-hidden="true" />
        <span>Internet: {isOnline ? 'On' : 'Off'}</span>
      </div>
      <div className="conn-item">
        <span className="conn-dot" aria-hidden="true" />
        <span>Gateway: {gatewayText}</span>
      </div>
    </div>
  );
}
