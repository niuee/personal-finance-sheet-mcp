/**
 * Each MCP session gets its own Durable Object, and clients rarely end a
 * session explicitly, so without cleanup they pile up in storage forever.
 * A session that hasn't been used for this long deletes itself. A client
 * that comes back later gets "Session not found" and starts a new session.
 */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How often each session checks whether it has gone idle. */
export const SESSION_EXPIRY_CHECK_INTERVAL_S = 24 * 60 * 60;

export function isSessionExpired(lastActiveAt: number, now: number, openConnections: number): boolean {
	if (openConnections > 0) return false;
	return now - lastActiveAt >= SESSION_IDLE_TTL_MS;
}
