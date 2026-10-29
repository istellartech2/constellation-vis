import { afterEach, describe, expect, it } from "bun:test";
import { bind, clear } from "../src/lib/chartResizeObserver";

const original = globalThis.ResizeObserver;
afterEach(() => { globalThis.ResizeObserver = original; });

describe("chart resize observer", () => {
  it("notifies listeners and disconnects when removed", () => {
    let trigger: ResizeObserverCallback | undefined;
    let disconnects = 0;
    let observed: Element | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { trigger = callback; }
      observe(element: Element) { observed = element; }
      unobserve() {}
      disconnect() { disconnects++; }
    };
    const element = {} as Element;
    let calls = 0;
    const unbind = bind(element, () => { calls++; });
    expect(observed).toBe(element);
    trigger?.([], {} as ResizeObserver);
    expect(calls).toBe(1);
    unbind();
    expect(disconnects).toBe(1);
    trigger?.([], {} as ResizeObserver);
    expect(calls).toBe(1);
    clear(element);
    expect(disconnects).toBe(1);
  });
});
