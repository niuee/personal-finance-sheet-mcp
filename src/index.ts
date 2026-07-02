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
