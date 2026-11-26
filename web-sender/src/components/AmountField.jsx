import React from 'react';

export function AmountField({ value, onChange, limit = 500 }) {
  return (
    <label className="field">
      <span className="field-label">Amount</span>
      <div className="amount-wrap">
        <span className="amount-prefix" aria-hidden="true">
          ₹
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input input--amount"
          aria-label="Amount in rupees"
        />
      </div>
      <span className="field-helper">Offline limit ₹{limit} per payment</span>
    </label>
  );
}
