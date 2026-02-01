/**
 * Token Store — Issues and validates OAuth access tokens.
 *
 * Tokens are opaque strings that encrypt the user's gridstatus API key.
 * The server never stores the raw key — it's only recoverable by decrypting
 * the token with the server's secret.
 *
 * Uses AES-256-GCM for authenticated encryption.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const TOKEN_PREFIX = "gs_";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// Derive a 256-bit key from the server secret
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export interface TokenPayload {
  apiKey: string;
  clientId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface TokenStoreConfig {
  /** Server secret for encrypting tokens. Must be consistent across restarts for token validity. */
  secret: string;
  /** Token TTL in seconds. Default: 3600 (1 hour). */
  ttlSeconds?: number;
}

export class TokenStore {
  private key: Buffer;
  private ttlSeconds: number;

  // Track refresh tokens: refreshToken -> { apiKey, clientId, expiresAt }
  private refreshTokens = new Map<string, { apiKey: string; clientId: string; expiresAt: number }>();

  constructor(config: TokenStoreConfig) {
    this.key = deriveKey(config.secret);
    this.ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /**
   * Issue an access token that encrypts the user's API key.
   * Returns both access_token and refresh_token.
   */
  issueTokens(apiKey: string, clientId: string): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      apiKey,
      clientId,
      issuedAt: now,
      expiresAt: now + this.ttlSeconds,
    };

    const plaintext = JSON.stringify(payload);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Token format: gs_<iv>.<encrypted>.<authTag> (all base64url)
    const accessToken =
      TOKEN_PREFIX +
      iv.toString("base64url") +
      "." +
      encrypted.toString("base64url") +
      "." +
      authTag.toString("base64url");

    // Refresh token is a random opaque string (TTL: 7 days)
    const refreshToken = "gsr_" + randomBytes(32).toString("base64url");
    const refreshExpiresAt = now + 7 * 24 * 3600;
    this.refreshTokens.set(refreshToken, { apiKey, clientId, expiresAt: refreshExpiresAt });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ttlSeconds,
    };
  }

  /**
   * Validate and decrypt an access token. Returns the payload or null if invalid/expired.
   */
  validateToken(token: string): TokenPayload | null {
    if (!token.startsWith(TOKEN_PREFIX)) return null;

    try {
      const parts = token.slice(TOKEN_PREFIX.length).split(".");
      if (parts.length !== 3) return null;

      const iv = Buffer.from(parts[0], "base64url");
      const encrypted = Buffer.from(parts[1], "base64url");
      const authTag = Buffer.from(parts[2], "base64url");

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = decipher.update(encrypted) + decipher.final("utf8");

      const payload: TokenPayload = JSON.parse(decrypted);

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.expiresAt < now) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Exchange a refresh token for new access + refresh tokens.
   * The old refresh token is invalidated (rotation per OAuth 2.1).
   */
  refreshAccessToken(refreshToken: string): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } | null {
    const stored = this.refreshTokens.get(refreshToken);
    if (!stored) return null;

    // Check refresh token expiry
    const now = Math.floor(Date.now() / 1000);
    if (stored.expiresAt < now) {
      this.refreshTokens.delete(refreshToken);
      return null;
    }

    // Rotate: delete old refresh token
    this.refreshTokens.delete(refreshToken);

    // Issue new pair
    return this.issueTokens(stored.apiKey, stored.clientId);
  }

  /** Remove expired refresh tokens to prevent memory leaks. */
  cleanup(): number {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    for (const [token, stored] of this.refreshTokens) {
      if (stored.expiresAt < now) {
        this.refreshTokens.delete(token);
        removed++;
      }
    }
    return removed;
  }

  /** Start periodic cleanup of expired tokens. Returns the interval handle. */
  startCleanupInterval(intervalMs = 3_600_000): NodeJS.Timeout {
    return setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        console.error(`Token cleanup: removed ${removed} expired refresh token(s)`);
      }
    }, intervalMs);
  }
}
