export type Clock = {
  now(): Date;
};

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export function fakeClock(initialIso: string): Clock & { set(iso: string): void; advanceMs(ms: number): void } {
  let current = Date.parse(initialIso);
  if (!Number.isFinite(current)) throw new Error('INVALID_FAKE_CLOCK');
  return {
    now: () => new Date(current),
    set(iso: string) {
      const next = Date.parse(iso);
      if (!Number.isFinite(next)) throw new Error('INVALID_FAKE_CLOCK');
      current = next;
    },
    advanceMs(ms: number) {
      current += ms;
    },
  };
}

export function utcIso(date: Date): string {
  return date.toISOString();
}
