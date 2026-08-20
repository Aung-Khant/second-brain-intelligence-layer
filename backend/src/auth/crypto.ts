// Encryption for Notion access tokens at rest.
//
// A stored Notion token is a bearer credential for someone's entire workspace,
// so it never touches disk in plaintext. AES-256-GCM is used rather than a
// plain cipher because it authenticates as well as encrypts: a tampered
// ciphertext fails to decrypt instead of silently yielding garbage that then
// gets sent to Notion as a bearer token.
//
// The key comes from TOKEN_ENCRYPTION_KEY and is required - there is
// deliberately no "encrypt with a default key" path, because that would look
// like encryption while providing none.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { AppError } from "../../../shared/types/errors.js";

const algorithm = "aes-256-gcm";
const ivLength = 12;

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, readKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  // iv.tag.ciphertext, each base64url, so the whole thing is one safe string.
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptSecret(encoded: string): string {
  const [iv, tag, ciphertext] = encoded.split(".");
  if (!iv || !tag || !ciphertext) {
    throw new AppError("NOTION_AUTH_FAILED", "Stored credential is malformed.");
  }

  try {
    const decipher = createDecipheriv(algorithm, readKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    // Wrong key, or the file was edited. Either way the token is unusable and
    // the user has to reconnect - which is the safe outcome.
    throw new AppError(
      "NOTION_AUTH_FAILED",
      "Stored Notion credential could not be read. Reconnect Notion."
    );
  }
}

export function hasEncryptionKey(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim());
}

// Accepts hex or base64; both are common ways to write a 32-byte key.
function readKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new AppError(
      "NOTION_AUTH_FAILED",
      "TOKEN_ENCRYPTION_KEY is required to store Notion connections. Generate one with: openssl rand -hex 32"
    );
  }

  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new AppError(
      "NOTION_AUTH_FAILED",
      "TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)."
    );
  }

  return key;
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
