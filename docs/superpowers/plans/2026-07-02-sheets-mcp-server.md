# Personal Finance Sheets MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server on Cloudflare Workers that lets Claude web read, append to, and update one specific Google Sheet, protected by GitHub OAuth locked to one user.

**Architecture:** Scaffolded from Cloudflare's official `remote-mcp-github-oauth` template (`workers-oauth-provider` + `McpAgent` Durable Object). We add a pure Google service-account auth module (WebCrypto RS256 JWT → cached access token), a Sheets REST client, five MCP tools, and a single-username allowlist enforced in the GitHub OAuth callback.

**Tech Stack:** TypeScript, Cloudflare Workers, `agents` (McpAgent), `@cloudflare/workers-oauth-provider`, Hono, zod v4, vitest. Google Sheets v4 REST API via plain `fetch` — **no** `googleapis` SDK (it does not run on Workers).

**Spec:** `docs/superpowers/specs/2026-07-02-sheets-mcp-server-design.md`

## Global Constraints

- All new source files live in `src/`, tests in `test/`. The project root is the repo root (`personal-finance/main`), alongside the existing `docs/` directory.
- Worker name is `sheets-mcp`; production URL is `https://sheets-mcp.<your-subdomain>.workers.dev`.
- Dependency versions come from the template's `package.json` (`@cloudflare/workers-oauth-provider` ^0.8.1, `agents` ^0.17.1, `hono` ^4, `octokit` ^5, `zod` ^4). Do not add dependencies beyond `vitest` and `@types/node` (dev-only).
- Tool registration uses the zod-shape style the template uses: `this.server.tool(name, description, { param: z.string() }, handler)`.
- All writes to Sheets use `valueInputOption=USER_ENTERED`.
- `read_range` responses are truncated when serialized values exceed `MAX_READ_CHARS = 50_000` characters, with `truncated: true` in the result.
- Never commit `.dev.vars` or the service-account JSON key. The template `.gitignore` already ignores `.dev.vars`; keep it that way.
- Secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`. Plain vars in `wrangler.jsonc`: `SPREADSHEET_ID`, `ALLOWED_GITHUB_LOGIN` (value: `niuee`).
- `this.env.GOOGLE_SA_PRIVATE_KEY` may contain literal `\n` two-character sequences (pasted from the JSON key); it is normalized with `.replace(/\\n/g, "\n")` exactly once, at the point the `GoogleAuth` config is built in `src/index.ts`.
- Node.js ≥ 20 locally (needed for global `fetch`/`crypto.subtle`/`Response` in vitest).
- Commit after every task. Use author `niuee <vntchang@gmail.com>` (already configured repo-locally).

---

### Task 0: Manual prerequisites (user actions — no code)

These are console/browser steps only the user (Vincent) can do. Collect the outputs; later tasks consume them. Dev-only pieces are needed before Task 6; production pieces before Task 7.

- [ ] **Step 1: Create the DEV GitHub OAuth app** (needed by Task 6)

At https://github.com/settings/developers → "New OAuth App":
- Application name: `sheets-mcp (dev)`
- Homepage URL: `http://localhost:8788`
- Authorization callback URL: `http://localhost:8788/callback`
- After creating: note the **Client ID**, click "Generate a new client secret", note the **Client secret**.

- [ ] **Step 2: Create the PROD GitHub OAuth app** (needed by Task 7)

Same page, second app:
- Application name: `sheets-mcp`
- Homepage URL: `https://sheets-mcp.<your-subdomain>.workers.dev`
- Authorization callback URL: `https://sheets-mcp.<your-subdomain>.workers.dev/callback`
- Note Client ID + generated Client secret.
- Find `<your-subdomain>` at https://dash.cloudflare.com → Workers & Pages (the `*.workers.dev` subdomain). If unsure, create the app after the first deploy in Task 7 and fill in the real URL then.

- [ ] **Step 3: Create the Google service account** (needed by Task 6)

At https://console.cloud.google.com:
1. Create a project (any name, e.g. `sheets-mcp`).
2. "APIs & Services" → "Library" → search **Google Sheets API** → Enable.
3. "IAM & Admin" → "Service Accounts" → "Create service account". Any name; **no roles needed** (access comes from sheet sharing, not IAM).
4. Open the service account → "Keys" → "Add key" → "Create new key" → **JSON**. Download the file; keep it OUT of the repo.
5. Note the `client_email` and `private_key` values from the JSON.

- [ ] **Step 4: Share the sheets with the service account**

1. Make a **copy** of the finance spreadsheet (File → Make a copy) — this is the test target for Task 6.
2. Share **both** the copy and the real spreadsheet with the service account's `client_email`, role **Editor**.
3. Note both spreadsheet IDs — the long string in the URL between `/d/` and `/edit`.

---

### Task 1: Scaffold from the Cloudflare template

**Files:**
- Create (from template): `package.json`, `wrangler.jsonc`, `tsconfig.json`, `.gitignore`, `.dev.vars.example`, `README.md`, `worker-configuration.d.ts`, `src/index.ts`, `src/github-handler.ts`, `src/utils.ts`, `src/workers-oauth-utils.ts`
- Modify: `wrangler.jsonc`, `.dev.vars.example`, `package.json`

**Interfaces:**
- Produces: a compiling Worker project at the repo root; `Env` type (via `worker-configuration.d.ts` regenerated by `npm run cf-typegen`) that includes `SPREADSHEET_ID: string`, `ALLOWED_GITHUB_LOGIN: string`, `GOOGLE_SA_EMAIL: string`, `GOOGLE_SA_PRIVATE_KEY: string` plus the template's GitHub/cookie secrets. Template exports later tasks touch: `Props` type from `src/utils.ts` (`{ login: string; name: string; email: string; accessToken: string }`).

- [ ] **Step 1: Scaffold the template into a temp dir and move it into the repo root**

```bash
cd /Users/vincent.yy.chang/dev/personal-finance/main
npm create cloudflare@latest -- sheets-mcp-scaffold --template=cloudflare/ai/demos/remote-mcp-github-oauth --git=false --deploy=false
# If prompted interactively: decline git init and decline deploy.
rsync -a --exclude=.git --exclude=node_modules sheets-mcp-scaffold/ ./
rm -rf sheets-mcp-scaffold
```

Expected: repo root now contains `package.json`, `wrangler.jsonc`, `src/` with the four template files, plus the pre-existing `docs/`.

- [ ] **Step 2: Update `wrangler.jsonc`**

Replace the whole file with (KV `id` stays a placeholder until Task 7; `SPREADSHEET_ID` is the **real** finance spreadsheet ID from Task 0 Step 4 — the ID alone grants no access, so committing it is fine):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sheets-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-10",
  "compatibility_flags": ["nodejs_compat"],
  "migrations": [
    {
      "new_sqlite_classes": ["SheetsMCP"],
      "tag": "v1"
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "SheetsMCP",
        "name": "MCP_OBJECT"
      }
    ]
  },
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "<Add-KV-ID-in-Task-7>"
    }
  ],
  "vars": {
    "SPREADSHEET_ID": "<real-finance-spreadsheet-id>",
    "ALLOWED_GITHUB_LOGIN": "niuee"
  },
  "observability": {
    "enabled": true
  },
  "dev": {
    "port": 8788
  }
}
```

Changes vs template: worker `name`, DO class `MyMCP` → `SheetsMCP` (in both `migrations` and `durable_objects` — safe because nothing is deployed yet), **removed** the `"ai"` binding, added `"vars"`.

Note: `src/index.ts` still defines `MyMCP` and references `this.env.AI` at this point — that's expected; it gets rewritten in Task 5, and until then `wrangler dev` isn't run. Type-check in Step 5 uses the template's checked-in `worker-configuration.d.ts` (which still has `AI`), so it still passes.

- [ ] **Step 3: Replace `.dev.vars.example`**

```
GITHUB_CLIENT_ID=<dev github oauth app client id>
GITHUB_CLIENT_SECRET=<dev github oauth app client secret>
COOKIE_ENCRYPTION_KEY=<any random string, e.g. from: openssl rand -hex 32>
GOOGLE_SA_EMAIL=<service account client_email>
GOOGLE_SA_PRIVATE_KEY=<service account private_key JSON value, with the literal \n sequences kept as-is>
SPREADSHEET_ID=<COPY spreadsheet id — local dev targets the copy, not the real sheet>
```

Then create a local (gitignored) working copy so `wrangler types` sees the variable names:

```bash
cp .dev.vars.example .dev.vars
```

- [ ] **Step 4: Update `package.json` name and install**

Edit `package.json`: `"name": "sheets-mcp"`. Then:

```bash
npm install
```

Expected: installs cleanly (lockfile created).

- [ ] **Step 5: Type-check the untouched template code**

```bash
npm run type-check
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold from cloudflare remote-mcp-github-oauth template"
```

(`.dev.vars` must NOT appear in `git status` — it is gitignored.)

---

### Task 2: Google service-account auth module (`GoogleAuth`)

**Files:**
- Create: `src/google-auth.ts`, `test/google-auth.test.ts`, `vitest.config.ts`
- Modify: `package.json` (add vitest), `tsconfig.json` (add node types for tests)

**Interfaces:**
- Consumes: nothing from other tasks (pure module — no Cloudflare imports, so it runs under plain vitest/node).
- Produces: `class GoogleAuth { constructor(config: { serviceAccountEmail: string; privateKeyPem: string }); getToken(): Promise<string> }`. `getToken()` returns a cached Google access token, refreshing via signed JWT when missing or within 60s of expiry, retrying the exchange once on failure.

- [ ] **Step 1: Add vitest**

```bash
npm install -D vitest @types/node
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

Edit `tsconfig.json` `compilerOptions.types` so tests type-check (Buffer, node globals):

```jsonc
"types": ["@cloudflare/workers-types/2023-07-01", "node"],
```

- [ ] **Step 2: Write the failing tests**

Create `test/google-auth.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — cannot resolve `../src/google-auth`.

- [ ] **Step 4: Implement `src/google-auth.ts`**

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test && npm run type-check
```

Expected: 5 tests PASS; type-check exits 0.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tsconfig.json package.json package-lock.json src/google-auth.ts test/google-auth.test.ts
git commit -m "feat: google service-account auth with cached token and retry"
```

---

### Task 3: Sheets client — read operations

**Files:**
- Create: `src/sheets-client.ts`, `test/sheets-client.test.ts`

**Interfaces:**
- Consumes: `GoogleAuth` from `src/google-auth.ts` (only `getToken(): Promise<string>`).
- Produces:
  - `class SheetsApiError extends Error { status: number }`
  - `class SheetsClient { constructor(auth: GoogleAuth, spreadsheetId: string) }` with (this task) `listTabs(): Promise<Array<{ title: string; rowCount: number; columnCount: number }>>` and `readRange(range: string): Promise<{ range: string; values: unknown[][]; truncated: boolean }>`
  - `MAX_READ_CHARS = 50_000` (exported for tests)

- [ ] **Step 1: Write the failing tests**

Create `test/sheets-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleAuth } from "../src/google-auth";
import { MAX_READ_CHARS, SheetsApiError, SheetsClient } from "../src/sheets-client";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID";
const auth = { getToken: async () => "test-token" } as unknown as GoogleAuth;

function makeClient(): SheetsClient {
	return new SheetsClient(auth, "SHEET_ID");
}

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("SheetsClient reads", () => {
	it("listTabs returns tab names and dimensions", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				sheets: [
					{ properties: { title: "Transactions", gridProperties: { rowCount: 500, columnCount: 8 } } },
					{ properties: { title: "Budget", gridProperties: { rowCount: 100, columnCount: 4 } } },
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tabs = await makeClient().listTabs();

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}?fields=sheets.properties`);
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
		expect(tabs).toEqual([
			{ title: "Transactions", rowCount: 500, columnCount: 8 },
			{ title: "Budget", rowCount: 100, columnCount: 4 },
		]);
	});

	it("readRange URL-encodes the range and returns values", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ range: "Transactions!A1:B2", values: [["date", "amount"], ["2026-07-01", 42]] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().readRange("Transactions!A1:B2");

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/values/Transactions!A1%3AB2`);
		expect(result).toEqual({
			range: "Transactions!A1:B2",
			values: [["date", "amount"], ["2026-07-01", 42]],
			truncated: false,
		});
	});

	it("readRange truncates oversized results and flags it", async () => {
		const bigRow = ["x".repeat(500)];
		const rows = Array.from({ length: 500 }, () => bigRow);
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ range: "Log!A1:A500", values: rows })));

		const result = await makeClient().readRange("Log!A1:A500");

		expect(result.truncated).toBe(true);
		expect(result.values.length).toBeLessThan(500);
		expect(result.values.length).toBeGreaterThan(0);
		expect(JSON.stringify(result.values).length).toBeLessThanOrEqual(MAX_READ_CHARS);
	});

	it("surfaces Google's error message with the status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ error: { message: "Unable to parse range: Nope!A1" } }), {
					status: 400,
				}),
			),
		);

		const promise = makeClient().readRange("Nope!A1");
		await expect(promise).rejects.toThrow("Unable to parse range: Nope!A1");
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — cannot resolve `../src/sheets-client`. (google-auth tests still pass.)

- [ ] **Step 3: Implement `src/sheets-client.ts` (reads only)**

```ts
import type { GoogleAuth } from "./google-auth";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const MAX_READ_CHARS = 50_000;

export class SheetsApiError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "SheetsApiError";
	}
}

export class SheetsClient {
	constructor(
		private auth: GoogleAuth,
		private spreadsheetId: string,
	) {}

	private async request(path: string, init: RequestInit = {}): Promise<any> {
		const token = await this.auth.getToken();
		const resp = await fetch(`${API_BASE}/${this.spreadsheetId}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});
		if (!resp.ok) {
			let message = `Sheets API error (${resp.status})`;
			try {
				const body = (await resp.json()) as { error?: { message?: string } };
				if (body.error?.message) message = body.error.message;
			} catch {
				// non-JSON error body; keep the generic message
			}
			throw new SheetsApiError(message, resp.status);
		}
		return resp.json();
	}

	async listTabs(): Promise<Array<{ title: string; rowCount: number; columnCount: number }>> {
		const data = await this.request("?fields=sheets.properties");
		return (data.sheets ?? []).map((s: any) => ({
			title: s.properties.title,
			rowCount: s.properties.gridProperties?.rowCount ?? 0,
			columnCount: s.properties.gridProperties?.columnCount ?? 0,
		}));
	}

	async readRange(range: string): Promise<{ range: string; values: unknown[][]; truncated: boolean }> {
		const data = await this.request(`/values/${encodeURIComponent(range)}`);
		const values: unknown[][] = data.values ?? [];
		let truncated = false;
		while (values.length > 0 && JSON.stringify(values).length > MAX_READ_CHARS) {
			// Drop the last quarter of rows until we fit
			values.splice(Math.max(1, Math.floor(values.length * 0.75)));
			truncated = true;
			if (values.length === 1 && JSON.stringify(values).length > MAX_READ_CHARS) {
				// A single row alone exceeds the cap; return it anyway rather than nothing
				break;
			}
		}
		return { range: data.range ?? range, values, truncated };
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test && npm run type-check
```

Expected: 9 tests PASS; type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sheets-client.ts test/sheets-client.test.ts
git commit -m "feat: sheets client read operations with truncation and error surfacing"
```

---

### Task 4: Sheets client — write operations

**Files:**
- Modify: `src/sheets-client.ts`, `test/sheets-client.test.ts`

**Interfaces:**
- Consumes: `SheetsClient.request()` private helper from Task 3.
- Produces (methods added to `SheetsClient`):
  - `appendRows(tab: string, rows: unknown[][]): Promise<{ updatedRange: string; updatedRows: number }>`
  - `updateRange(range: string, values: unknown[][]): Promise<{ updatedRange: string; updatedCells: number }>`
  - `addTab(title: string): Promise<{ title: string; sheetId: number }>`

- [ ] **Step 1: Write the failing tests**

Append inside `test/sheets-client.test.ts` (same file, new describe block):

```ts
describe("SheetsClient writes", () => {
	it("appendRows POSTs USER_ENTERED values to the quoted tab", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ updates: { updatedRange: "'My Tab'!A10:B11", updatedRows: 2 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().appendRows("My Tab", [
			["2026-07-02", 12.5],
			["2026-07-02", -3],
		]);

		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE}/values/'My%20Tab'!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
		);
		expect(fetchMock.mock.calls[0][1].method).toBe("POST");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			values: [["2026-07-02", 12.5], ["2026-07-02", -3]],
		});
		expect(result).toEqual({ updatedRange: "'My Tab'!A10:B11", updatedRows: 2 });
	});

	it("appendRows escapes single quotes in tab names", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ updates: { updatedRange: "x", updatedRows: 1 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await makeClient().appendRows("Bob's Tab", [["a"]]);

		expect(String(fetchMock.mock.calls[0][0])).toContain("/values/'Bob''s%20Tab'!A1:append");
	});

	it("updateRange PUTs USER_ENTERED values", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ updatedRange: "Budget!B2", updatedCells: 1 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().updateRange("Budget!B2", [[99]]);

		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE}/values/Budget!B2?valueInputOption=USER_ENTERED`,
		);
		expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ values: [[99]] });
		expect(result).toEqual({ updatedRange: "Budget!B2", updatedCells: 1 });
	});

	it("addTab issues a batchUpdate addSheet request", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ replies: [{ addSheet: { properties: { title: "2027", sheetId: 12345 } } }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().addTab("2027");

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}:batchUpdate`);
		expect(fetchMock.mock.calls[0][1].method).toBe("POST");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			requests: [{ addSheet: { properties: { title: "2027" } } }],
		});
		expect(result).toEqual({ title: "2027", sheetId: 12345 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `appendRows is not a function` (and the other three).

- [ ] **Step 3: Add the write methods to `SheetsClient`**

Append inside the class in `src/sheets-client.ts`:

```ts
	/** Quote a tab name for A1 notation: 'Bob''s Tab' */
	private quoteTab(tab: string): string {
		return `'${tab.replace(/'/g, "''")}'`;
	}

	async appendRows(tab: string, rows: unknown[][]): Promise<{ updatedRange: string; updatedRows: number }> {
		const range = encodeURIComponent(`${this.quoteTab(tab)}!A1`);
		const data = await this.request(
			`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
			{ method: "POST", body: JSON.stringify({ values: rows }) },
		);
		return {
			updatedRange: data.updates?.updatedRange ?? "",
			updatedRows: data.updates?.updatedRows ?? 0,
		};
	}

	async updateRange(range: string, values: unknown[][]): Promise<{ updatedRange: string; updatedCells: number }> {
		const data = await this.request(
			`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
			{ method: "PUT", body: JSON.stringify({ values }) },
		);
		return {
			updatedRange: data.updatedRange ?? range,
			updatedCells: data.updatedCells ?? 0,
		};
	}

	async addTab(title: string): Promise<{ title: string; sheetId: number }> {
		const data = await this.request(":batchUpdate", {
			method: "POST",
			body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
		});
		const props = data.replies?.[0]?.addSheet?.properties;
		return { title: props?.title ?? title, sheetId: props?.sheetId ?? -1 };
	}
```

Note: `encodeURIComponent` leaves `'` and `!` unescaped, so the expected URLs in the tests are literal.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test && npm run type-check
```

Expected: 13 tests PASS; type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sheets-client.ts test/sheets-client.test.ts
git commit -m "feat: sheets client write operations (append, update, add tab)"
```

---

### Task 5: MCP tools + wiring + allowlist

**Files:**
- Create: `src/tools.ts`
- Modify: `src/index.ts` (full rewrite), `src/github-handler.ts` (two small edits)

**Interfaces:**
- Consumes: `GoogleAuth` (Task 2), `SheetsClient` (Tasks 3–4; errors arrive as thrown `Error`s and only their `.message` is used), `Props` from `src/utils.ts`, `GitHubHandler` from `src/github-handler.ts`.
- Produces: `registerFinanceTools(server: McpServer, client: SheetsClient): void`; Durable Object class `SheetsMCP` (name must match `wrangler.jsonc` from Task 1); Worker default export.

- [ ] **Step 1: Create `src/tools.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SheetsClient } from "./sheets-client";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowsSchema = z.array(z.array(cellValue).min(1)).min(1);

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

function ok(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toError(e: unknown): ToolResult {
	const message = e instanceof Error ? e.message : String(e);
	return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function registerFinanceTools(server: McpServer, client: SheetsClient): void {
	server.tool(
		"list_tabs",
		"List the tabs (sheets) in the personal-finance spreadsheet with their row/column counts. Call this first to orient yourself.",
		{},
		async () => {
			try {
				return ok(await client.listTabs());
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"read_range",
		"Read cell values from the spreadsheet using A1 notation (e.g. 'Transactions!A1:F200', or just a tab name for the whole tab). Large results are truncated; the response says so via `truncated: true` — narrow the range to see the rest.",
		{
			range: z
				.string()
				.min(1)
				.describe("A1 notation range, e.g. Transactions!A1:F200 or a bare tab name"),
		},
		async ({ range }) => {
			try {
				return ok(await client.readRange(range));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"append_rows",
		"Append new rows below the existing data in a tab. Values are parsed as if typed by a user (dates and numbers become real dates/numbers). Returns the exact range that was written.",
		{
			tab: z.string().min(1).describe("Tab name, e.g. Transactions"),
			rows: rowsSchema.describe(
				"Rows to append; each row is an array of cell values in column order",
			),
		},
		async ({ tab, rows }) => {
			try {
				return ok(await client.appendRows(tab, rows));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"update_range",
		"OVERWRITE the cells in a range with new values. This destroys the existing contents of those cells — read the range first and double-check before updating. Returns the range and cell count actually written.",
		{
			range: z.string().min(1).describe("A1 notation range to overwrite, e.g. Transactions!B7"),
			values: rowsSchema.describe("Replacement values; outer array = rows, inner = cells"),
		},
		async ({ range, values }) => {
			try {
				return ok(await client.updateRange(range, values));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_tab",
		"Create a new empty tab (sheet) in the spreadsheet.",
		{
			title: z.string().min(1).describe("Title for the new tab"),
		},
		async ({ title }) => {
			try {
				return ok(await client.addTab(title));
			} catch (e) {
				return toError(e);
			}
		},
	);
}
```

- [ ] **Step 2: Rewrite `src/index.ts`**

Replace the whole file with:

```ts
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { GitHubHandler } from "./github-handler";
import { GoogleAuth } from "./google-auth";
import { SheetsClient } from "./sheets-client";
import { registerFinanceTools } from "./tools";
import type { Props } from "./utils";

export class SheetsMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Personal Finance Sheets",
		version: "1.0.0",
	});

	async init() {
		// Defense in depth: the GitHub callback already rejects other users,
		// but never register tools unless the token belongs to the owner.
		if (this.props!.login !== this.env.ALLOWED_GITHUB_LOGIN) {
			return;
		}
		const auth = new GoogleAuth({
			serviceAccountEmail: this.env.GOOGLE_SA_EMAIL,
			// A key pasted from the service-account JSON contains literal \n sequences
			privateKeyPem: this.env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
		});
		const client = new SheetsClient(auth, this.env.SPREADSHEET_ID);
		registerFinanceTools(this.server, client);
	}
}

export default new OAuthProvider({
	apiHandler: SheetsMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
```

(This removes the template's `add`, `userInfoOctokit`, and `generateImage` demo tools, the `ALLOWED_USERNAMES` set, the local `Props` type — we import the identical one from `./utils` — and the `octokit`/`zod` imports. The `AI` binding is already gone from `wrangler.jsonc` since Task 1.)

- [ ] **Step 3: Edit `src/github-handler.ts` — reject non-allowlisted users**

In the `/callback` route, immediately after this existing line:

```ts
	const { login, name, email } = user.data;
```

insert:

```ts
	if (login !== c.env.ALLOWED_GITHUB_LOGIN) {
		return c.text(`Access denied: GitHub user "${login}" is not authorized to use this server.`, 403);
	}
```

This is the primary gate: unauthorized users never get a token issued at all.

- [ ] **Step 4: Edit `src/github-handler.ts` — approval-dialog branding**

In the `GET /authorize` route, replace the `server:` object passed to `renderApprovalDialog`:

```ts
			server: {
				description:
					"Private MCP server for Vincent's personal-finance Google Sheet. Only the owner's GitHub account is authorized.",
				name: "Personal Finance Sheets MCP",
			},
```

(Drop the template's `logo` line.)

- [ ] **Step 5: Regenerate Env types and type-check**

```bash
npm run cf-typegen
npm run type-check && npm test
```

Expected: `worker-configuration.d.ts` regenerated — `Env` now has `SPREADSHEET_ID`, `ALLOWED_GITHUB_LOGIN` (from `vars`) and `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (from `.dev.vars`), and no `AI` binding. Type-check exits 0; all 13 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/index.ts src/github-handler.ts worker-configuration.d.ts
git commit -m "feat: finance sheet MCP tools, owner allowlist, worker wiring"
```

---

### Task 6: Local integration test with MCP Inspector

Manual verification against the **copy** spreadsheet. Requires Task 0 Steps 1, 3, 4.

**Files:**
- Modify: `.dev.vars` (local only, never committed)

- [ ] **Step 1: Fill `.dev.vars` with real dev values**

Using Task 0 outputs: dev GitHub app client ID/secret, `openssl rand -hex 32` for `COOKIE_ENCRYPTION_KEY`, service-account `client_email` and `private_key` (paste the JSON string value as-is, on one line, keeping the `\n` sequences), and the **copy** spreadsheet's ID for `SPREADSHEET_ID`.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Expected: wrangler serves on http://localhost:8788. (Local KV/DO are simulated automatically; the placeholder KV `id` in `wrangler.jsonc` is fine for dev.)

- [ ] **Step 3: Connect MCP Inspector**

In a second terminal:

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI: Transport = **Streamable HTTP**, URL = `http://localhost:8788/mcp`, click Connect, complete the OAuth flow in the popup (approval dialog → GitHub login as `niuee`).

Expected: connected; **Tools** lists exactly `list_tabs`, `read_range`, `append_rows`, `update_range`, `add_tab`.

- [ ] **Step 4: Exercise every tool against the copy sheet**

In the Inspector, run and verify each (check the Google Sheet in the browser after each write):

1. `list_tabs` → returns the copy sheet's real tab names.
2. `read_range` with `range` = one of those tab names → returns real data, `truncated: false`.
3. `append_rows` with `tab` = a real tab, `rows` = `[["2026-07-02", "integration test", 1.23]]` → returns `updatedRange`; row visible at the bottom of the tab.
4. `update_range` targeting the cell containing `integration test` (use the `updatedRange` from step 3) → change the text to `integration test EDITED`; visible in the sheet.
5. `add_tab` with `title` = `mcp-test` → new empty tab appears.
6. `read_range` with `range` = `Nonexistent!A1` → returns an error result containing Google's "Unable to parse range" message (not a crash).

- [ ] **Step 5: Negative auth test**

In the Inspector, disconnect. In `.dev.vars`, temporarily set `ALLOWED_GITHUB_LOGIN=someone-else`, restart `npm run dev`, reconnect: the GitHub callback must respond `403 Access denied` and the Inspector must fail to connect. Revert to `niuee` afterwards and restart.

- [ ] **Step 6: Clean up and commit**

Delete the `mcp-test` tab and the test rows from the copy sheet (in the browser). Nothing to commit unless fixes were needed; if they were, commit them:

```bash
git add -A && git commit -m "fix: issues found during local MCP integration testing"
```

---

### Task 7: Production deploy + Claude web connection

Requires Task 0 Steps 2, 3, 4. Manual, run from the repo root.

**Files:**
- Modify: `wrangler.jsonc` (real KV namespace id)

- [ ] **Step 1: Create the KV namespace**

```bash
npx wrangler kv namespace create OAUTH_KV
```

Expected output includes an `id`. Paste it into `wrangler.jsonc` replacing `<Add-KV-ID-in-Task-7>`.

- [ ] **Step 2: Set production secrets**

```bash
npx wrangler secret put GITHUB_CLIENT_ID      # prod GitHub app client id
npx wrangler secret put GITHUB_CLIENT_SECRET  # prod GitHub app secret
npx wrangler secret put COOKIE_ENCRYPTION_KEY # openssl rand -hex 32 (fresh one, not the dev value)
npx wrangler secret put GOOGLE_SA_EMAIL       # service account client_email
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY # private_key JSON value, one line, \n sequences intact
```

- [ ] **Step 3: Deploy**

```bash
npm run deploy
```

Expected: deploys to `https://sheets-mcp.<your-subdomain>.workers.dev`. If the prod GitHub OAuth app (Task 0 Step 2) was created with a guessed subdomain, fix its Homepage/Callback URLs now to match the real one.

- [ ] **Step 4: Connect Claude web**

At https://claude.ai → Settings → Connectors → **Add custom connector**:
- URL: `https://sheets-mcp.<your-subdomain>.workers.dev/mcp`
- Complete the approval dialog + GitHub login as `niuee`.

Expected: connector shows as connected with the five tools.

- [ ] **Step 5: Acceptance test (per spec)**

In a Claude web chat with the connector enabled, ask Claude to:
1. List the tabs and summarize spending from a real tab (verifies read + math).
2. Append a clearly-marked test transaction row (verify it appears in the real sheet).
3. Update that same row's description (verify the edit).
Then delete the test row manually in the sheet.

- [ ] **Step 6: Commit and finish**

```bash
git add wrangler.jsonc
git commit -m "chore: production KV namespace id"
```

Then use the superpowers:finishing-a-development-branch skill to close out.
