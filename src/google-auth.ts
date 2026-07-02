const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
// Refresh this long before the token actually expires
const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleAuthConfig {
	serviceAccountEmail: string;
	/** PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"), real newlines */
	privateKeyPem: string;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
	const b64 = pem
		.replace("-----BEGIN PRIVATE KEY-----", "")
		.replace("-----END PRIVATE KEY-----", "")
		.replace(/\s+/g, "");
	const raw = atob(b64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes.buffer;
}

function base64UrlEncode(data: string | ArrayBuffer): string {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class GoogleAuth {
	private cached: { token: string; expiresAt: number } | null = null;

	constructor(private config: GoogleAuthConfig) {}

	async getToken(): Promise<string> {
		if (this.cached && Date.now() < this.cached.expiresAt - EXPIRY_MARGIN_MS) {
			return this.cached.token;
		}
		try {
			return await this.fetchToken();
		} catch {
			return await this.fetchToken();
		}
	}

	private async fetchToken(): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
		const payload = base64UrlEncode(
			JSON.stringify({
				iss: this.config.serviceAccountEmail,
				scope: SCOPE,
				aud: TOKEN_URL,
				iat: now,
				exp: now + 3600,
			}),
		);
		const key = await crypto.subtle.importKey(
			"pkcs8",
			pemToArrayBuffer(this.config.privateKeyPem),
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"],
		);
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			key,
			new TextEncoder().encode(`${header}.${payload}`),
		);
		const jwt = `${header}.${payload}.${base64UrlEncode(signature)}`;

		const resp = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion: jwt,
			}).toString(),
		});
		if (!resp.ok) {
			throw new Error(`Google token exchange failed (${resp.status}): ${await resp.text()}`);
		}
		const data = (await resp.json()) as { access_token: string; expires_in: number };
		this.cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
		return data.access_token;
	}
}
