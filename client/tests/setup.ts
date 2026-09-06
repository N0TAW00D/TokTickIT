import '@testing-library/jest-dom';

// Work around a Node 22+ / jsdom interaction: recent Node versions define
// their own global `localStorage`/`sessionStorage` getters (an experimental
// Web Storage implementation gated behind the `--localstorage-file` CLI
// flag). Because those properties already exist on `globalThis`, vitest's
// jsdom environment does not overwrite them with the real, working
// implementation it wires up on the jsdom `window` object — so
// `window.localStorage` resolves to Node's disabled version and every read
// silently returns `undefined` instead of a Storage object. Vitest's jsdom
// environment exposes the underlying JSDOM instance as `globalThis.jsdom`
// for exactly this kind of fix-up; re-point the globals at its real
// Storage implementation so `localStorage` behaves as it does in a browser.
const jsdomInstance = (
  globalThis as unknown as { jsdom?: { window: typeof globalThis } }
).jsdom;

if (jsdomInstance?.window?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => jsdomInstance.window.localStorage,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => jsdomInstance.window.sessionStorage,
  });
}
