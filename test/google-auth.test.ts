import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GoogleAuth } from "../src/google-auth";

const EMAIL = "finance-bot@test-project.iam.gserviceaccount.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let privateKeyPem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	publicKey = pair.publicKey;
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	const b64 = Buffer.from(pkcs8).toString("base64");
	privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function tokenResponse(token: string, expiresIn: number): Response {
	return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function makeAuth(): GoogleAuth {
	return new GoogleAuth({ serviceAccountEmail: EMAIL, privateKeyPem });
}

describe("GoogleAuth", () => {
	it("exchanges a correctly-formed signed JWT for an access token", async () => {
		let requestUrl: string | undefined;
		let requestBody: string | undefined;
		const fetchMock = vi.fn(async (url: any, init: any) => {
			requestUrl = String(url);
			requestBody = String(init.body);
			return tokenResponse("tok-1", 3600);
		});
		vi.stubGlobal("fetch", fetchMock);

		const token = await makeAuth().getToken();

		expect(token).toBe("tok-1");
		expect(requestUrl).toBe(TOKEN_URL);
		const params = new URLSearchParams(requestBody!);
		expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

		const assertion = params.get("assertion")!;
		const [h, p, s] = assertion.split(".");
		const header = JSON.parse(Buffer.from(h, "base64url").toString());
		const payload = JSON.parse(Buffer.from(p, "base64url").toString());
		expect(header).toEqual({ alg: "RS256", typ: "JWT" });
		expect(payload.iss).toBe(EMAIL);
		expect(payload.aud).toBe(TOKEN_URL);
		expect(payload.scope).toBe("https://www.googleapis.com/auth/spreadsheets");
		expect(payload.exp - payload.iat).toBe(3600);

		const valid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			publicKey,
			Buffer.from(s, "base64url"),
			new TextEncoder().encode(`${h}.${p}`),
		);
		expect(valid).toBe(true);
	});

	it("caches the token across calls", async () => {
		const fetchMock = vi.fn(async () => tokenResponse("tok-1", 3600));
		vi.stubGlobal("fetch", fetchMock);

		const auth = makeAuth();
		expect(await auth.getToken()).toBe("tok-1");
		expect(await auth.getToken()).toBe("tok-1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes once the cached token nears expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-02T00:00:00Z"));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(tokenResponse("tok-1", 3600))
			.mockResolvedValueOnce(tokenResponse("tok-2", 3600));
		vi.stubGlobal("fetch", fetchMock);

		const auth = makeAuth();
		expect(await auth.getToken()).toBe("tok-1");
		// 3595s later: within the 60s early-refresh window
		vi.setSystemTime(new Date("2026-07-02T00:59:55Z"));
		expect(await auth.getToken()).toBe("tok-2");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries the exchange once on failure", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("boom", { status: 500 }))
			.mockResolvedValueOnce(tokenResponse("tok-2", 3600));
		vi.stubGlobal("fetch", fetchMock);

		expect(await makeAuth().getToken()).toBe("tok-2");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("surfaces the error when the retry also fails", async () => {
		const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(makeAuth().getToken()).rejects.toThrow("Google token exchange failed (403)");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
