/**
 * Historial deshacer/rehacer del Studio web.
 * Agrupa cambios rápidos (arrastre, color) en un solo paso.
 */

import { useCallback, useMemo, useRef, useState } from "react";

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastPush = 0;
  private coalescing = false;

  constructor(
    private readonly max = 80,
    private readonly coalesceMs = 450,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  remember(current: T): boolean {
    const now = Date.now();
    if (this.coalescing && now - this.lastPush < this.coalesceMs) {
      this.lastPush = now;
      return false;
    }
    this.past.push(cloneJson(current));
    if (this.past.length > this.max) this.past.shift();
    this.future = [];
    this.lastPush = now;
    this.coalescing = true;
    return true;
  }

  breakCoalesce(): void {
    this.coalescing = false;
  }

  undo(current: T): T | null {
    if (!this.past.length) return null;
    this.coalescing = false;
    const prev = this.past.pop()!;
    this.future.push(cloneJson(current));
    return prev;
  }

  redo(current: T): T | null {
    if (!this.future.length) return null;
    this.coalescing = false;
    const next = this.future.pop()!;
    this.past.push(cloneJson(current));
    return next;
  }

  reset(): void {
    this.past = [];
    this.future = [];
    this.coalescing = false;
    this.lastPush = 0;
  }
}

export function useUndoStack<T>(opts?: { max?: number; coalesceMs?: number }) {
  const stackRef = useRef<UndoStack<T> | null>(null);
  if (!stackRef.current) {
    stackRef.current = new UndoStack<T>(opts?.max ?? 80, opts?.coalesceMs ?? 450);
  }
  const stack = stackRef.current;
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  const sync = useCallback(() => {
    setFlags({ canUndo: stack.canUndo, canRedo: stack.canRedo });
  }, [stack]);

  const remember = useCallback(
    (current: T) => {
      if (stack.remember(current)) sync();
    },
    [stack, sync],
  );

  const breakCoalesce = useCallback(() => {
    stack.breakCoalesce();
  }, [stack]);

  const undo = useCallback(
    (current: T): T | null => {
      const prev = stack.undo(current);
      sync();
      return prev;
    },
    [stack, sync],
  );

  const redo = useCallback(
    (current: T): T | null => {
      const next = stack.redo(current);
      sync();
      return next;
    },
    [stack, sync],
  );

  const reset = useCallback(() => {
    stack.reset();
    sync();
  }, [stack, sync]);

  return useMemo(
    () => ({
      remember,
      undo,
      redo,
      reset,
      breakCoalesce,
      canUndo: flags.canUndo,
      canRedo: flags.canRedo,
    }),
    [remember, undo, redo, reset, breakCoalesce, flags.canUndo, flags.canRedo],
  );
}
