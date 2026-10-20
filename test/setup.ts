import { vi } from "vitest";

/**
 * Every test file runs at 2026-10-20 12:00 Taipei. Tools resolve a bare
 * month param to the occurrence of that month nearest to today, so tests
 * written against 2026's tabs must not drift with the real clock. Only Date
 * is faked; timers stay real.
 */
export const PINNED_NOW = new Date("2026-10-20T04:00:00Z");
vi.useFakeTimers({ toFake: ["Date"], now: PINNED_NOW });
