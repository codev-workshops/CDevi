import { vi } from 'vitest';

/** Shared `fetch` + `EventSource` doubles for component tests of live screens (FR-034). */

type Listener = (ev: { data: string }) => void;

export const sources: FakeSource[] = [];

export class FakeSource {
  listeners = new Map<string, Listener[]>();
  constructor() {
    sources.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
  close() {}
}

export const fetchMock = vi.fn();

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

export const problem = (status: number, detail?: string, title = 'Nope') =>
  jsonResponse(
    detail === undefined
      ? { type: 'about:blank', title, status }
      : { type: 'about:blank', title, status, detail },
    status,
  );

export const lastUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]), 'http://localhost');

export const saffron = (c: Element) => c.querySelectorAll('.cd-saffron').length;

/** Call from `beforeEach`: resets the doubles and installs them on `globalThis`. Pair with `vi.unstubAllGlobals()` in `afterEach`. */
export function installLiveMocks() {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
}
