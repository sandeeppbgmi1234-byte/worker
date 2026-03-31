import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Gets the encryption key from environment variable.
 * IMPORTANT: This must match whatever the Next.js app uses.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.REDIS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "CRITICAL SECURITY ERROR: 'REDIS_ENCRYPTION_SECRET' is not defined. Secure token storage is required.",
    );
  }
  // We use scrypt to derive a 32-byte key from whatever secret string is provided
  return scryptSync(secret, "dm-broo-salt", 32);
}

/**
 * Encrypts a plain text string.
 * Output format: [iv_hex][tag_hex][encrypted_text_hex]
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
    throw new Error("Invalid encrypted data format");
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
