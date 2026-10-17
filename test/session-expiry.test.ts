import { describe, expect, it } from "vitest";
import { isSessionExpired, SESSION_IDLE_TTL_MS } from "../src/session-expiry";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

describe("isSessionExpired", () => {
	it("keeps a session used recently", () => {
		expect(isSessionExpired(NOW - HOUR_MS, NOW, 0)).toBe(false);
	});

	it("keeps a session idle for just under the TTL", () => {
		expect(isSessionExpired(NOW - SESSION_IDLE_TTL_MS + 1, NOW, 0)).toBe(false);
	});

	it("expires a session idle for the full TTL", () => {
		expect(isSessionExpired(NOW - SESSION_IDLE_TTL_MS, NOW, 0)).toBe(true);
	});

	it("expires a session idle for longer than the TTL", () => {
		expect(isSessionExpired(NOW - SESSION_IDLE_TTL_MS - 24 * HOUR_MS, NOW, 0)).toBe(true);
	});

	it("keeps an idle session while a client is still connected to it", () => {
		expect(isSessionExpired(NOW - SESSION_IDLE_TTL_MS - 24 * HOUR_MS, NOW, 1)).toBe(false);
	});
});
