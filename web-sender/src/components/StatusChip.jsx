import React from 'react';

export function StatusChip({ status }) {
  const normalized = (status || 'PENDING_SETTLEMENT').toUpperCase();

  if (normalized === 'SETTLED') {
    return <span className="status-chip status-chip--settled">SETTLED</span>;
  }
  if (normalized === 'REJECTED' || normalized === 'INVALID') {
    return <span className="status-chip status-chip--rejected">REJECTED</span>;
  }
  return <span className="status-chip status-chip--pending">PENDING SETTLEMENT</span>;
}
