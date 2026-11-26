import React from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { HistoryScreen } from './screens/HistoryScreen.jsx';
import { ReceiveScreen } from './screens/ReceiveScreen.jsx';
import { SendScreen } from './screens/SendScreen.jsx';
import { TransferScreen } from './screens/TransferScreen.jsx';
import { TransferProvider } from './state/TransferContext.jsx';

export function App() {
  return (
    <TransferProvider>
      <HashRouter>
        <div className="app-shell">
          <div className="phone-frame">
            <Routes>
              <Route path="/" element={<SendScreen />} />
              <Route path="/transfer" element={<TransferScreen />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/receive" element={<ReceiveScreen />} />
            </Routes>
          </div>
        </div>
      </HashRouter>
    </TransferProvider>
  );
}

export default App;
