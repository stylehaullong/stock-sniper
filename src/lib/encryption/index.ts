import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Derives a unique encryption key for each user using scrypt.
 * Combines the master key with the user's ID to ensure
 * one user's key can never decrypt another user's data.
 */
function deriveUserKey(userId: string): Buffer {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error("MASTER_ENCRYPTION_KEY is not set");
  }

  // Use userId as salt for key derivation
  // This ensures each user gets a unique derived key
  const salt = Buffer.from(userId.replace(/-/g, ""), "hex").subarray(0, SALT_LENGTH);
  return scryptSync(masterKey, salt, KEY_LENGTH);
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a per-user derived key.
 * Returns: { encrypted: string (hex), iv: string (hex), authTag: string (hex) }
 */
export function encrypt(
  plaintext: string,
  userId: string
): { encrypted: string; iv: string; authTag: string } {
  const key = deriveUserKey(userId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypts an encrypted string using AES-256-GCM with a per-user derived key.
 */
export function decrypt(
  encryptedHex: string,
  ivHex: string,
  authTagHex: string,
  userId: string
): string {
  const key = deriveUserKey(userId);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypts retailer credentials for storage.
 * Stores username, password, and optionally CVV as encrypted blobs.
 */
export function encryptCredentials(
  username: string,
  password: string,
  userId: string,
  cvv?: string
): { encrypted_username: string; encrypted_password: string; encryption_iv: string; encrypted_cvv?: string } {
  const usernameResult = encrypt(username, userId);
  const passwordResult = encrypt(password, userId);

  const ivData: Record<string, string> = {
    username_iv: usernameResult.iv,
    username_auth: usernameResult.authTag,
    password_iv: passwordResult.iv,
    password_auth: passwordResult.authTag,
  };

  let encrypted_cvv: string | undefined;
  if (cvv) {
    const cvvResult = encrypt(cvv, userId);
    ivData.cvv_iv = cvvResult.iv;
    ivData.cvv_auth = cvvResult.authTag;
    encrypted_cvv = cvvResult.encrypted;
  }

  return {
    encrypted_username: usernameResult.encrypted,
    encrypted_password: passwordResult.encrypted,
    encryption_iv: JSON.stringify(ivData),
    ...(encrypted_cvv ? { encrypted_cvv } : {}),
  };
}

/**
 * Decrypts stored retailer credentials.
 */
export function decryptCredentials(
  encrypted_username: string,
  encrypted_password: string,
  encryption_iv: string,
  userId: string,
  encrypted_cvv?: string | null
): { username: string; password: string; cvv?: string } {
  const ivData = JSON.parse(encryption_iv);

  const username = decrypt(
    encrypted_username,
    ivData.username_iv,
    ivData.username_auth,
    userId
  );

  const password = decrypt(
    encrypted_password,
    ivData.password_iv,
    ivData.password_auth,
    userId
  );

  let cvv: string | undefined;
  if (encrypted_cvv && ivData.cvv_iv && ivData.cvv_auth) {
    cvv = decrypt(encrypted_cvv, ivData.cvv_iv, ivData.cvv_auth, userId);
  }

  return { username, password, ...(cvv ? { cvv } : {}) };
}