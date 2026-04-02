import "@testing-library/jest-dom/vitest";

import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (typeof window !== "undefined" && !window.matchMedia) {
    globalThis.window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }

  if (typeof window !== "undefined") {
    window.open = vi.fn();
  }
});

afterEach(() => {
  vi.clearAllMocks();
});
