/**
 * THE SEAM'S OWN RULES.
 *
 * Three of them are behaviours the brief states outright and one is the reason
 * the flag has two booleans instead of one. None of these is checkable by
 * looking at the panel: they are about the state two unrelated subtrees agree
 * on, and the failure mode of every one of them is a panel that opens with a
 * keyboard over it or a rail that stays hidden after the keyboard has gone.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  dismissSearch,
  raiseSearch,
  resetSearchRaiseForTests,
  setSearchFocused,
} from './searchRaise.ts';

/* The flag is module state, so it survives `cleanup()` the way the destination
   does -- see `src/test/setup.ts`. Reset between cases or the first test that
   opens the panel leaves it open for every test after it. */
afterEach(() => {
  resetSearchRaiseForTests();
});

/*
 * Read the flag the way a component does, without mounting one: the hook is a
 * `useSyncExternalStore` over these same functions, so the module's own
 * behaviour is what is under test here and the React binding is exercised in
 * `SearchSeam.test.tsx`.
 */
import { useSearchRaise } from './searchRaise.ts';
import { act, renderHook } from '@testing-library/react';

function read(): { raised: boolean; focused: boolean } {
  const { result } = renderHook(() => useSearchRaise());
  return { raised: result.current.raised, focused: result.current.focused };
}

describe('the panel opens with the keyboard down', () => {
  it('raises without focusing anything', () => {
    /* "THE PANEL OPENS WITH THE KEYBOARD DOWN in both orientations. The field
       is focusable, not focused." One boolean could not express this state, and
       an implementation with one would have to open the keyboard to open the
       panel -- which is the behaviour being replaced. */
    raiseSearch();
    expect(read()).toEqual({ raised: true, focused: false });
  });

  it('starts down', () => {
    expect(read()).toEqual({ raised: false, focused: false });
  });
});

describe('focus and dismissal', () => {
  it('raises the panel when the field takes focus, because a focused field inside a closed panel has no drawing', () => {
    setSearchFocused(true);
    expect(read()).toEqual({ raised: true, focused: true });
  });

  it('does NOT dismiss on blur -- a driver tapping a row is briefly unfocused on the way to choosing it', () => {
    raiseSearch();
    setSearchFocused(true);
    setSearchFocused(false);
    expect(read()).toEqual({ raised: true, focused: false });
  });

  it('drops focus and the panel together, so the chrome never yields to a keyboard that has gone', () => {
    /* "Everything returns the instant the field is dismissed." Both fields move
       in ONE publish rather than two, so there is no frame in which the rails
       are still hidden for a panel that is already down. */
    setSearchFocused(true);
    dismissSearch();
    expect(read()).toEqual({ raised: false, focused: false });
  });
});

describe('subscribers', () => {
  it('re-renders a reader when the flag changes and not when it is re-set to the same value', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useSearchRaise();
    });
    const first = renders;
    act(() => {
      raiseSearch();
    });
    expect(result.current.raised).toBe(true);
    const afterRaise = renders;
    expect(afterRaise).toBeGreaterThan(first);

    /* IDEMPOTENT. Every keystroke in the bar calls `raiseSearch`, and a publish
       that re-rendered the whole landscape chrome per character would be a
       re-layout of five rail buttons per letter typed. */
    act(() => {
      raiseSearch();
      raiseSearch();
    });
    expect(renders).toBe(afterRaise);
  });
});
