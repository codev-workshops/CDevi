import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameId, frameWorkflowId, subscribeInboxStream } from '../../lib/inbox-stream';

type Listener = (ev: { data: string }) => void;
const sources: FakeSource[] = [];
class FakeSource {
  listeners = new Map<string, Listener[]>();
  constructor(public url: string) {
    sources.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data = '') {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
  close() {}
}

beforeEach(() => {
  sources.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('inbox stream frame filtering (specs/001 FR-034, research R3/R37)', () => {
  it('FR-034 frameId reads the requested key and ignores unparsable or non-string frames', () => {
    expect(frameId('{"requirementId":"r1"}', 'requirementId')).toBe('r1');
    expect(frameId('{"workflowId":"w1"}', 'workflowId')).toBe('w1');
    expect(frameId('{"workflowId":"w1"}', 'requirementId')).toBeNull();
    expect(frameId('{"requirementId":42}', 'requirementId')).toBeNull();
    expect(frameId('not json', 'requirementId')).toBeNull();
    expect(frameId(undefined, 'workflowId')).toBeNull();
    expect(frameId(null, 'workflowId')).toBeNull();
    expect(frameId('null', 'workflowId')).toBeNull();
  });

  it('FR-034 frameWorkflowId stays exported and equals frameId(data, "workflowId")', () => {
    expect(frameWorkflowId('{"workflowId":"w1"}')).toBe('w1');
    expect(frameWorkflowId('{"requirementId":"r1"}')).toBeNull();
    expect(frameWorkflowId('oops')).toBeNull();
  });

  it('FR-034 requirementId filters inbox.changed frames to that requirement (debounced once)', () => {
    const onChange = vi.fn();
    const stop = subscribeInboxStream({ requirementId: 'r1', debounceMs: 300, onChange });
    const es = sources[0]!;
    es.emit('inbox.changed', JSON.stringify({ requirementId: 'r2' }));
    es.emit('inbox.changed', JSON.stringify({ workflowId: 'w1' }));
    es.emit('inbox.changed', 'garbage');
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();

    es.emit('inbox.changed', JSON.stringify({ requirementId: 'r1' }));
    es.emit('inbox.changed', JSON.stringify({ requirementId: 'r1' }));
    vi.advanceTimersByTime(299);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('FR-034 requirementId and workflowId together match either id (a requirement and its linked workflow)', () => {
    const onChange = vi.fn();
    const stop = subscribeInboxStream({
      requirementId: 'r1',
      workflowId: 'w1',
      debounceMs: 0,
      onChange,
    });
    const es = sources[0]!;
    es.emit('inbox.changed', JSON.stringify({ requirementId: 'r1' }));
    vi.runAllTimers();
    es.emit('inbox.changed', JSON.stringify({ workflowId: 'w1', table: 'workflows' }));
    vi.runAllTimers();
    es.emit('inbox.changed', JSON.stringify({ workflowId: 'w2' }));
    es.emit('inbox.changed', JSON.stringify({ requirementId: 'r2' }));
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it('FR-034 without filters every inbox.changed frame fires onChange', () => {
    const onChange = vi.fn();
    const stop = subscribeInboxStream({ debounceMs: 0, onChange });
    sources[0]!.emit('inbox.changed', 'anything');
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });
});
