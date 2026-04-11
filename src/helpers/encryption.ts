import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.REDIS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "CRITICAL SECURITY ERROR: 'REDIS_ENCRYPTION_SECRET' is not defined. Secure token storage is required.",
    );
  }
  // Use a configurable salt, fallback to the legacy salt for backward compatibility
  const salt = process.env.DM_BROO_SALT || "dm-broo-salt";
  cachedKey = scryptSync(secret, salt, 32);
  return cachedKey;
}

/**
 * Encrypts a plain text string.
 * Output format: iv_hex:tag_hex:encrypted_text_hex (colon-separated)
 */
export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Decrypts an encrypted string produced by 'encrypt'.
 */
export function decrypt(encryptedData: string): string {
  const [ivHex, tagHex, encryptedText] = encryptedData.split(":");

  if (!ivHex || !tagHex || !encryptedText) {
    throw new Error("Invalid encrypted data format: Missing components");
  }

  // VALIDATION: Length and Integrity checks
  if (ivHex.length !== 24 || tagHex.length !== 32) {
    throw new Error(
      "Invalid encrypted data format: Corrupted IV or Auth-Tag length",
    );
  }

  if (encryptedText.length === 0 || encryptedText.length % 2 !== 0) {
    throw new Error("Invalid encrypted data format: Invalid ciphertext length");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
