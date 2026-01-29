/**
 * OAuth 2.1 Authorization Server for MCP
 *
 * Implements the MCP authorization spec (2025-06-18):
 * - Protected Resource Metadata (RFC 9728)
 * - Authorization Server Metadata (RFC 8414)
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Code + PKCE flow
 * - Token issuance and refresh
 *
 * Since gridstatus.io uses API keys (not OAuth), this server bridges:
 * the user pastes their API key in the /authorize form, and we wrap it
 * into an encrypted OAuth access token.
 */

import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TokenStore } from "./token-store.js";

// --- Types ---

interface RegisteredClient {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  registeredAt: number;
}

interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  apiKey: string; // The user's gridstatus API key
  expiresAt: number;
  resource?: string;
}

export interface OAuthServerConfig {
  /** Base URL of this server (e.g., http://localhost:3000) */
  issuer: string;
  /** Secret for token encryption */
  tokenSecret: string;
  /** Token TTL in seconds */
  tokenTtlSeconds?: number;
}

export class OAuthServer {
  private issuer: string;
  private tokenStore: TokenStore;
  private clients = new Map<string, RegisteredClient>();
  private authCodes = new Map<string, AuthorizationCode>();

  constructor(config: OAuthServerConfig) {
    this.issuer = config.issuer;
    this.tokenStore = new TokenStore({
      secret: config.tokenSecret,
      ttlSeconds: config.tokenTtlSeconds,
    });
  }

  /**
   * Handle an HTTP request. Returns true if handled, false if not an OAuth route.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || "/", this.issuer);
    const path = url.pathname;

    // RFC 9728: Protected Resource Metadata
    if (path === "/.well-known/oauth-protected-resource" && req.method === "GET") {
      return this.handleProtectedResourceMetadata(res);
    }

    // RFC 8414: Authorization Server Metadata
    if (path === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      return this.handleAuthServerMetadata(res);
    }

    // RFC 7591: Dynamic Client Registration
    if (path === "/oauth/register" && req.method === "POST") {
      return this.handleRegister(req, res);
    }

    // Authorization endpoint (GET = show form, POST = submit form)
    if (path === "/oauth/authorize") {
      if (req.method === "GET") return this.handleAuthorizeForm(url, res);
      if (req.method === "POST") return this.handleAuthorizeSubmit(req, res);
    }

    // Token endpoint
    if (path === "/oauth/token" && req.method === "POST") {
      return this.handleToken(req, res);
    }

    return false;
  }

  // --- RFC 9728: Protected Resource Metadata ---

  private handleProtectedResourceMetadata(res: ServerResponse): true {
    const metadata = {
      resource: this.issuer,
      authorization_servers: [this.issuer],
      bearer_methods_supported: ["header"],
      resource_signing_alg_values_supported: [],
    };
    this.jsonResponse(res, 200, metadata);
    return true;
  }

  // --- RFC 8414: Authorization Server Metadata ---

  private handleAuthServerMetadata(res: ServerResponse): true {
    const metadata = {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      registration_endpoint: `${this.issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"], // public clients
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["gridstatus"],
    };
    this.jsonResponse(res, 200, metadata);
    return true;
  }

  // --- RFC 7591: Dynamic Client Registration ---

  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = await this.readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.jsonResponse(res, 400, { error: "invalid_request", error_description: "Invalid JSON" });
      return true;
    }

    const redirectUris = parsed.redirect_uris as string[] | undefined;
    if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      this.jsonResponse(res, 400, {
        error: "invalid_client_metadata",
        error_description: "redirect_uris required",
      });
      return true;
    }

    const clientId = "client_" + randomBytes(16).toString("hex");
    const client: RegisteredClient = {
      clientId,
      clientName: parsed.client_name as string | undefined,
      redirectUris,
      registeredAt: Math.floor(Date.now() / 1000),
    };
    this.clients.set(clientId, client);

    this.jsonResponse(res, 201, {
      client_id: clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    return true;
  }

  // --- Authorization Endpoint ---

  private handleAuthorizeForm(url: URL, res: ServerResponse): true {
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const state = url.searchParams.get("state") || "";
    const codeChallenge = url.searchParams.get("code_challenge") || "";
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
    const resource = url.searchParams.get("resource") || "";

    // Validate client
    const client = this.clients.get(clientId);
    if (!client) {
      this.htmlResponse(res, 400, "<h1>Error</h1><p>Unknown client. The MCP client must register first.</p>");
      return true;
    }

    if (!client.redirectUris.includes(redirectUri)) {
      this.htmlResponse(res, 400, "<h1>Error</h1><p>Invalid redirect_uri.</p>");
      return true;
    }

    if (!codeChallenge) {
      this.htmlResponse(res, 400, "<h1>Error</h1><p>PKCE code_challenge required.</p>");
      return true;
    }

    // Serve the authorization form
    const html = this.renderAuthorizePage(clientId, redirectUri, state, codeChallenge, codeChallengeMethod, resource);
    this.htmlResponse(res, 200, html);
    return true;
  }

  private async handleAuthorizeSubmit(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);

    const apiKey = params.get("api_key") || "";
    const clientId = params.get("client_id") || "";
    const redirectUri = params.get("redirect_uri") || "";
    const state = params.get("state") || "";
    const codeChallenge = params.get("code_challenge") || "";
    const codeChallengeMethod = params.get("code_challenge_method") || "S256";
    const resource = params.get("resource") || "";

    if (!apiKey) {
      this.htmlResponse(res, 400, "<h1>Error</h1><p>API key is required.</p>");
      return true;
    }

    // Validate client
    const client = this.clients.get(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      this.htmlResponse(res, 400, "<h1>Error</h1><p>Invalid client or redirect.</p>");
      return true;
    }

    // Generate authorization code
    const code = "authcode_" + randomBytes(24).toString("base64url");
    this.authCodes.set(code, {
      code,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      apiKey,
      resource,
      expiresAt: Math.floor(Date.now() / 1000) + 300, // 5 min
    });

    // Redirect back to client with code
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);

    res.writeHead(302, { Location: redirect.toString() });
    res.end();
    return true;
  }

  // --- Token Endpoint ---

  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get("grant_type");

    if (grantType === "authorization_code") {
      return this.handleAuthCodeExchange(params, res);
    }

    if (grantType === "refresh_token") {
      return this.handleRefreshToken(params, res);
    }

    this.jsonResponse(res, 400, {
      error: "unsupported_grant_type",
      error_description: `Unsupported grant type: ${grantType}`,
    });
    return true;
  }

  private handleAuthCodeExchange(params: URLSearchParams, res: ServerResponse): true {
    const code = params.get("code") || "";
    const codeVerifier = params.get("code_verifier") || "";
    const clientId = params.get("client_id") || "";
    const redirectUri = params.get("redirect_uri") || "";

    // Look up and consume authorization code
    const authCode = this.authCodes.get(code);
    if (!authCode) {
      this.jsonResponse(res, 400, { error: "invalid_grant", error_description: "Invalid or expired code" });
      return true;
    }
    this.authCodes.delete(code); // One-time use

    // Validate expiration
    if (authCode.expiresAt < Math.floor(Date.now() / 1000)) {
      this.jsonResponse(res, 400, { error: "invalid_grant", error_description: "Code expired" });
      return true;
    }

    // Validate client and redirect
    if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
      this.jsonResponse(res, 400, { error: "invalid_grant", error_description: "Client/redirect mismatch" });
      return true;
    }

    // Validate PKCE
    if (!this.verifyPKCE(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
      this.jsonResponse(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      return true;
    }

    // Issue tokens
    const tokens = this.tokenStore.issueTokens(authCode.apiKey, clientId);

    this.jsonResponse(res, 200, {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: "gridstatus",
    });
    return true;
  }

  private handleRefreshToken(params: URLSearchParams, res: ServerResponse): true {
    const refreshToken = params.get("refresh_token") || "";

    const tokens = this.tokenStore.refreshAccessToken(refreshToken);
    if (!tokens) {
      this.jsonResponse(res, 400, { error: "invalid_grant", error_description: "Invalid refresh token" });
      return true;
    }

    this.jsonResponse(res, 200, {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: "gridstatus",
    });
    return true;
  }

  // --- Token Validation (for resource server middleware) ---

  /**
   * Extract and validate a Bearer token from an Authorization header.
   * Returns the decrypted API key, or null if invalid.
   */
  validateBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const payload = this.tokenStore.validateToken(token);
    return payload?.apiKey ?? null;
  }

  // --- PKCE ---

  private verifyPKCE(verifier: string, challenge: string, method: string): boolean {
    if (method !== "S256") return false;
    if (verifier.length < 43 || verifier.length > 128) return false;
    const computed = createHash("sha256").update(verifier).digest("base64url");
    return computed === challenge;
  }

  // --- Helpers ---

  private async readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        data += chunk.toString();
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  private jsonResponse(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  private htmlResponse(res: ServerResponse, status: number, html: string): void {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  private renderAuthorizePage(
    clientId: string,
    redirectUri: string,
    state: string,
    codeChallenge: string,
    codeChallengeMethod: string,
    resource: string,
  ): string {
    // Inline HTML — no external dependencies
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GridStatus MCP — Authorize</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 1rem;
    }
    .card {
      background: #1e293b; border-radius: 12px; padding: 2rem;
      max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; color: #cbd5e1; margin-bottom: 0.375rem; }
    input[type="text"] {
      width: 100%; padding: 0.625rem 0.75rem; border-radius: 6px;
      border: 1px solid #334155; background: #0f172a; color: #f1f5f9;
      font-size: 0.875rem; font-family: monospace;
    }
    input[type="text"]:focus { outline: none; border-color: #3b82f6; }
    .help { font-size: 0.75rem; color: #64748b; margin-top: 0.375rem; }
    button {
      width: 100%; padding: 0.625rem; margin-top: 1.25rem;
      background: #3b82f6; color: white; border: none; border-radius: 6px;
      font-size: 0.875rem; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #2563eb; }
    .security { font-size: 0.75rem; color: #475569; margin-top: 1rem; text-align: center; }
    .lock { display: inline-block; margin-right: 0.25rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to GridStatus</h1>
    <p class="subtitle">Enter your gridstatus.io API key to connect this MCP server to your account.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${this.escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${this.escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${this.escapeHtml(state)}">
      <input type="hidden" name="code_challenge" value="${this.escapeHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${this.escapeHtml(codeChallengeMethod)}">
      <input type="hidden" name="resource" value="${this.escapeHtml(resource)}">
      <label for="api_key">API Key</label>
      <input type="text" id="api_key" name="api_key" placeholder="gsk_..." required autocomplete="off">
      <p class="help">Find your key at <a href="https://gridstatus.io/api" target="_blank" style="color:#60a5fa">gridstatus.io/api</a></p>
      <button type="submit">Authorize</button>
    </form>
    <p class="security"><span class="lock">🔒</span>Your key is encrypted and never stored in plain text.</p>
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }
}
