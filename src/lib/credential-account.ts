import { hashPassword, verifyPassword } from "better-auth/crypto";

export const CREDENTIAL_ISSUER = "local:credential";
export const CREDENTIAL_PROVIDER = "credential";

export function hashCredentialPassword(password: string): Promise<string> {
  return hashPassword(password);
}

export function verifyCredentialPassword(hash: string, password: string): Promise<boolean> {
  return verifyPassword({ hash, password });
}
