import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConnectionIndicator } from '../components/ConnectionIndicator.jsx';
import { TabBar } from '../components/TabBar.jsx';
import { API_BASE } from '../config.js';
import { formatInr, formatTime } from '../state/transferReducer.js';

export function ReceiveScreen() {
  const [searchParams] = useSearchParams();
  const vpa = searchParams.get('vpa') || 'bob@demo';

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  const [balance, setBalance] = useState(null);
  const [incoming, setIncoming] = useState([]);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (isHttps) return undefined;

    let cancelled = false;
    async function load() {
      try {
        const [accResp, txResp] = await Promise.all([
          fetch(`${API_BASE}/api/accounts`),
          fetch(`${API_BASE}/api/transactions`),
        ]);
        if (!accResp.ok || !txResp.ok) {
          throw new Error('Could not reach backend.');
        }
        const accounts = await accResp.json();
        const txs = await txResp.json();
        if (cancelled) return;

        const match = accounts.find((a) => a.vpa === vpa);
        setBalance(match ? match.balance : 0);

        const settledIncoming = txs.filter(
          (t) => t.receiverVpa === vpa && t.status === 'SETTLED'
        );
        setIncoming(settledIncoming);
        setFetchError('');
      } catch {
        if (!cancelled) {
          setFetchError('Waiting for backend connection.');
        }
      }
    }

    load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isHttps, vpa]);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">Offline Pay</h1>
        <ConnectionIndicator />
      </header>

      <main className="main-content">
        {isHttps ? (
          <section className="card">
            <h2 className="topbar-title">Receiver view unavailable on HTTPS</h2>
            <p style={{ margin: 0 }}>
              This page is served over HTTPS (for Web Bluetooth), so the browser blocks HTTP calls
              to the local backend. Open the Receive view from the Spring Boot backend URL instead.
            </p>
            <p className="muted-note">Settlement shown here is simulated.</p>
          </section>
        ) : (
          <>
            <section className="card" style={{ gap: '4px' }}>
              <span className="row-secondary">Account {vpa}</span>
              <p className="balance-amount">
                {balance === null ? '—' : formatInr(balance)}
              </p>
            </section>

            <section className="form-stack" style={{ flex: 1, gap: '12px' }}>
              <h2 className="topbar-title">Incoming payments</h2>

              {fetchError && <p className="muted-note">{fetchError}</p>}

              {incoming.length === 0 ? (
                <p className="empty-state">
                  No incoming payments yet. This updates automatically.
                </p>
              ) : (
                <ul className="list-divider">
                  {incoming.map((tx) => (
                    <li key={tx.id} className="list-row-static">
                      <div className="row-col-left">
                        <span style={{ fontSize: '14px', color: 'var(--color-on-surface)' }}>
                          Received from {tx.senderVpa}
                        </span>
                        <span className="row-secondary tabular">
                          Settled {formatTime(tx.settledAt ? Date.parse(tx.settledAt) : null)}
                        </span>
                      </div>
                      <span className="row-amount">{formatInr(tx.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="muted-note">Settlement shown here is simulated.</p>
          </>
        )}
      </main>

      <TabBar />
    </>
  );
}
