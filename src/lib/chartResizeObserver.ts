// ECharts' React adapter needs only bind/clear. Use the browser API so the
// size-sensor package (whose original notice is unavailable) is not bundled.
const observers = new WeakMap<Element, { observer: ResizeObserver; callbacks: Set<() => void> }>();

export function bind(element: Element, callback: () => void): () => void {
  let entry = observers.get(element);
  if (!entry) {
    const callbacks = new Set<() => void>();
    const observer = new ResizeObserver(() => {
      for (const listener of callbacks) listener();
    });
    entry = { observer, callbacks };
    observers.set(element, entry);
    observer.observe(element);
  }
  entry.callbacks.add(callback);
  return () => {
    entry.callbacks.delete(callback);
    if (entry.callbacks.size === 0 && observers.get(element) === entry) clear(element);
  };
}

export function clear(element: Element): void {
  const entry = observers.get(element);
  if (!entry) return;
  entry.observer.disconnect();
  entry.callbacks.clear();
  observers.delete(element);
}
