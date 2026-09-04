/**
 * CLIPBOARD.
 *
 * Used for exactly one thing: copying a camera id (FWM-0442) or an export blob
 * that the user asked for. Nothing writes to the clipboard on its own.
 *
 * PRIVACY
 *   The system clipboard is readable by every app on the device and, on
 *   Android, is surfaced in a floating preview. A licence plate, a watchlist
 *   entry or a coordinate must never be written to it. `writeText` refuses
 *   anything that is not explicitly marked as shareable by its caller through
 *   the `ClipboardKind` union, which is a short, reviewable list.
 *
 * WHY THERE IS NO READ PATH
 *   `readText` prompts, and this product has nothing to paste. Not implemented
 *   rather than implemented and unused.
 */

import { createCore } from './core';
import {
  errorMessage,
  globalValue,
  nav,
  no,
  ok,
  queryPermission,
  type Adapter,
  type Capability,
  type PermissionOutcome,
} from './types';

/** The complete list of things allowed onto the system clipboard. */
export type ClipboardKind = 'camera-id' | 'report-hash' | 'export-json' | 'public-link';

export interface ClipboardWrite {
  readonly kind: ClipboardKind;
  readonly characters: number;
  readonly ok: boolean;
  readonly timestamp: number;
}

export interface ClipboardAdapter extends Adapter<ClipboardWrite> {
  permission(): Promise<PermissionOutcome>;
  /** USER GESTURE ONLY - browsers reject a write outside a user activation. */
  writeText(kind: ClipboardKind, text: string): Promise<boolean>;
}

function clipboardApi(): Clipboard | undefined {
  const clipboard = nav()?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return undefined;
  return clipboard;
}

export function clipboardCapability(): Capability {
  if (nav() === undefined) return no('no navigator in this runtime');
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no('the clipboard needs a secure context (https or localhost); this page is not one');
  }
  if (clipboardApi() === undefined) {
    return no('navigator.clipboard.writeText is not available in this browser');
  }
  return ok();
}

export function createClipboardAdapter(): ClipboardAdapter {
  const core = createCore<ClipboardWrite>();

  return {
    name: 'clipboard',

    capability: clipboardCapability,

    /** Passive read. Most browsers do not answer for clipboard-write. */
    async permission(): Promise<PermissionOutcome> {
      if (!clipboardCapability().supported) return 'unavailable';
      return queryPermission('clipboard-write');
    },

    /**
     * There is nothing to arm. `start()`/`stop()` exist to satisfy the adapter
     * contract and to let a caller disable copying wholesale; `writeText`
     * before `start()` still works, because a copy is always a user action.
     * Idempotent.
     */
    start(): void {
      const capability = clipboardCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'the clipboard is not available');
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Idempotent. */
    stop(): void {
      core.setRunning(false);
    },

    async writeText(kind: ClipboardKind, text: string): Promise<boolean> {
      const clipboard = clipboardApi();
      if (clipboard === undefined) {
        const capability = clipboardCapability();
        core.fail('unsupported', capability.reason ?? 'the clipboard is not available');
        core.emit({ kind, characters: text.length, ok: false, timestamp: Date.now() });
        return false;
      }
      try {
        await clipboard.writeText(text);
        core.clearError();
        core.emit({ kind, characters: text.length, ok: true, timestamp: Date.now() });
        return true;
      } catch (cause) {
        core.fail('write-failed', errorMessage(cause, 'the clipboard write was refused'));
        core.emit({ kind, characters: text.length, ok: false, timestamp: Date.now() });
        return false;
      }
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
