import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmountField } from '../components/AmountField.jsx';
import { ConnectionIndicator } from '../components/ConnectionIndicator.jsx';
import { TabBar } from '../components/TabBar.jsx';
import { OFFLINE_LIMIT_INR } from '../config.js';
import { useTransfer } from '../state/TransferContext.jsx';

export function SendScreen() {
  const navigate = useNavigate();
  const { createInstruction, startBleTransfer } = useTransfer();

  const [receiverVpa, setReceiverVpa] = useState('bob@demo');
  const [amount, setAmount] = useState('500.00');
  const [pin, setPin] = useState('1234');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const numeric = Number.parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setFormError('Enter a 4-digit PIN.');
      return;
    }

    setSubmitting(true);
    try {
      const built = await createInstruction({
        senderVpa: 'alice@demo',
        receiverVpa,
        amount: numeric,
        pin,
      });
      navigate('/transfer');
      // Kick off Web Bluetooth from the user's submit gesture
      startBleTransfer(built);
    } catch (err) {
      setFormError(err?.message || 'Could not create encrypted instruction.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">Offline Pay</h1>
        <ConnectionIndicator />
      </header>

      <main className="main-content">
        <div className="page-heading">
          <h2>Send payment</h2>
          <p>Create an encrypted instruction to send over Bluetooth.</p>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">From</span>
            <input type="text" value="alice@demo" readOnly className="input" />
          </label>

          <label className="field">
            <span className="field-label">To</span>
            <select
              value={receiverVpa}
              onChange={(e) => setReceiverVpa(e.target.value)}
              className="select"
            >
              <option value="bob@demo">bob@demo</option>
              <option value="carol@demo">carol@demo</option>
              <option value="dave@demo">dave@demo</option>
            </select>
          </label>

          <AmountField value={amount} onChange={setAmount} limit={OFFLINE_LIMIT_INR} />

          <label className="field">
            <span className="field-label">4-digit PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
              placeholder="••••"
              className="input input--pin"
            />
          </label>

          {formError && <p className="error-inline">{formError}</p>}

          <div className="field">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Creating instruction...' : 'Create encrypted instruction'}
            </button>
            <p className="muted-note">
              This creates a payment instruction. It is not a completed payment.
            </p>
          </div>
        </form>
      </main>

      <TabBar />
    </>
  );
}
