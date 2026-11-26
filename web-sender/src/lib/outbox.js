/**
 * Outbox persistence in localStorage wrapped in try/catch with in-memory fallback.
 */
const STORAGE_KEY = 'offline_pay_outbox_v1';
let memoryFallback = [];

export function loadOutbox() {
  try {
    if (typeof localStorage === 'undefined') {
      return [...memoryFallback];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [...memoryFallback];
  }
}

export function saveOutbox(items) {
  memoryFallback = [...items];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // Private browsing or quota exceeded — in-memory fallback stays active
  }
}

export function upsertOutboxItem(item) {
  const list = loadOutbox();
  const idx = list.findIndex((x) => x.packetId === item.packetId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.unshift(item);
  }
  saveOutbox(list);
  return list;
}
