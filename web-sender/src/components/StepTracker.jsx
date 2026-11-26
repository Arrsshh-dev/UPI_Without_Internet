import React from 'react';
import { formatTime } from '../state/transferReducer.js';

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function StepTracker({ state }) {
  const { phase, sentChunks, totalChunks, timestamps } = state;

  const step1Done = phase !== 'IDLE';
  const step2Done = Boolean(timestamps.connectedAt);
  const step2Active = phase === 'CONNECTING';
  const step3Done = phase === 'STORED' || phase === 'PENDING_SETTLEMENT';
  const step3Active = phase === 'SENDING';
  const step4Done = phase === 'STORED' || phase === 'PENDING_SETTLEMENT';

  const pct = totalChunks > 0 ? Math.min(100, Math.round((sentChunks / totalChunks) * 100)) : 0;

  const step3Label = step3Done
    ? `Sent ${totalChunks} of ${totalChunks} chunks`
    : step3Active
      ? `Sending ${sentChunks} of ${totalChunks} chunks`
      : `Send ${totalChunks || 0} chunks`;

  return (
    <section aria-label="Transfer steps" className="step-list">
      {/* Step 1 */}
      <div className="step-row">
        <div className="step-rail">
          <span className={`step-dot ${step1Done ? 'step-dot--done' : ''}`}>
            {step1Done && <CheckIcon />}
          </span>
          <div className="step-line" />
        </div>
        <div className="step-body">
          <div className="step-header">
            <span className={step1Done ? 'step-label' : 'step-label--muted'}>
              Instruction created
            </span>
            <span className="step-time">{formatTime(timestamps.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="step-row">
        <div className="step-rail">
          <span
            className={`step-dot ${
              step2Done ? 'step-dot--done' : step2Active ? 'step-dot--active' : ''
            }`}
          >
            {step2Done ? <CheckIcon /> : step2Active ? <span className="step-dot-inner" /> : null}
          </span>
          <div className="step-line" />
        </div>
        <div className="step-body">
          <div className="step-header">
            <span className={step2Done || step2Active ? 'step-label' : 'step-label--muted'}>
              Connected to gateway
            </span>
            <span className="step-time">{formatTime(timestamps.connectedAt)}</span>
          </div>
        </div>
      </div>

      {/* Step 3 */}
      <div className="step-row">
        <div className="step-rail">
          <span
            className={`step-dot ${
              step3Done ? 'step-dot--done' : step3Active ? 'step-dot--active' : ''
            }`}
          >
            {step3Done ? <CheckIcon /> : step3Active ? <span className="step-dot-inner" /> : null}
          </span>
          <div className="step-line" />
        </div>
        <div className="step-body">
          <div className="step-header">
            <span className={step3Done || step3Active ? 'step-label' : 'step-label--muted'}>
              {step3Label}
            </span>
            <span className="step-time">{formatTime(timestamps.sendingAt)}</span>
          </div>
          {(step3Active || step3Done) && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${step3Done ? 100 : pct}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Step 4 */}
      <div className="step-row">
        <div className="step-rail">
          <span className={`step-dot ${step4Done ? 'step-dot--done' : ''}`}>
            {step4Done && <CheckIcon />}
          </span>
        </div>
        <div className="step-body step-body--last">
          <div className="step-header">
            <span className={step4Done ? 'step-label' : 'step-label--muted'}>
              Stored on gateway
            </span>
            <span className="step-time">{formatTime(timestamps.storedAt)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
