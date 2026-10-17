import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Connection, ConnectionContext } from "agents";
import { McpAgent } from "agents/mcp";
import { GitHubHandler } from "./github-handler";
import { GoogleAuth } from "./google-auth";
import { isSessionExpired, SESSION_EXPIRY_CHECK_INTERVAL_S } from "./session-expiry";
import { SheetsClient } from "./sheets-client";
import { registerFinanceTools, registerTailoredTools } from "./tools";
import type { Props } from "./utils";

const LAST_ACTIVE_KEY = "lastActiveAt";

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
		registerTailoredTools(this.server, client);
	}

	async onStart(props?: Props) {
		await super.onStart(props);
		// Waking up for the daily expiry check also runs onStart, so only stamp
		// a session that has never been stamped; real use is stamped in onConnect.
		if ((await this.ctx.storage.get(LAST_ACTIVE_KEY)) === undefined) {
			await this.ctx.storage.put(LAST_ACTIVE_KEY, Date.now());
		}
		await this.scheduleEvery(SESSION_EXPIRY_CHECK_INTERVAL_S, "expireIfIdle");
	}

	// Every MCP request on this session arrives through onConnect.
	async onConnect(conn: Connection, ctx: ConnectionContext) {
		await this.ctx.storage.put(LAST_ACTIVE_KEY, Date.now());
		return super.onConnect(conn, ctx);
	}

	async expireIfIdle() {
		const lastActiveAt = await this.ctx.storage.get<number>(LAST_ACTIVE_KEY);
		if (lastActiveAt === undefined) return;
		if (!isSessionExpired(lastActiveAt, Date.now(), [...this.getConnections()].length)) return;
		await this.destroy();
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
