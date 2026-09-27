import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentToasts,
  dismissToast,
  MAX_TOASTS,
  resetToasts,
  subscribeToToasts,
  TOAST_LIFETIME,
  toast,
} from './toasts.js';

const messages = () => currentToasts().map((each) => each.message);

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetToasts();
  });

  afterEach(() => {
    resetToasts();
    vi.useRealTimers();
  });

  it('shows each in the order raised, with its tone', () => {
    toast.ok('Saved.');
    toast.error('Could not save.');
    expect(currentToasts()).toEqual([
      { id: 1, tone: 'ok', message: 'Saved.' },
      { id: 2, tone: 'error', message: 'Could not save.' },
    ]);
  });

  it('dismisses a success sooner than a failure', () => {
    toast.ok('Saved.');
    toast.error('Could not save.');
    vi.advanceTimersByTime(TOAST_LIFETIME.ok);
    expect(messages()).toEqual(['Could not save.']);
    vi.advanceTimersByTime(TOAST_LIFETIME.error - TOAST_LIFETIME.ok);
    expect(messages()).toEqual([]);
  });

  it('dismisses one by hand, leaving the rest', () => {
    const first = toast.ok('One.');
    toast.ok('Two.');
    dismissToast(first);
    expect(messages()).toEqual(['Two.']);
  });

  it('pushes out the oldest past the limit, and its timer with it', () => {
    for (let n = 1; n <= MAX_TOASTS + 1; n++) toast.ok(`${n}.`);
    expect(messages()).toEqual(['2.', '3.', '4.']);
    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
  });

  it('tells subscribers of every change, and ignores a dismissal of one already gone', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);
    const id = toast.ok('Saved.');
    dismissToast(id);
    dismissToast(id);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toast.ok('Again.');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
