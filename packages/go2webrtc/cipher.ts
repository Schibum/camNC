export interface CryptoHelper {
  encrypt: (data: string) => Promise<string>;
  decrypt: (data: string) => Promise<string>;
  hash: string;
  nonce: string;
}

function encode(str: string): Uint8Array {
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

function decode(buffer: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buffer));
}

/**
 * Prepares a cipher object used for encrypting and decrypting SDP messages.
 * @param share The share string.
 * @param pwd The password.
 * @param nonce Optional nonce.
 */
export async function cipher(
  share: string,
  pwd: string,
  nonce?: string
): Promise<CryptoHelper> {
  nonce = nonce || Math.random().toString(36).substring(2);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encode(share));
  const ivData = await crypto.subtle.digest(
    "SHA-256",
    encode(share + ":" + nonce)
  );
  const keyData = await crypto.subtle.digest(
    "SHA-256",
    encode(nonce + ":" + pwd)
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashString = hashArray.map((b) => String.fromCharCode(b)).join("");
  const hash = btoa(hashString);
  return {
    hash: hash,
    nonce: nonce,
    encrypt: async (plaintext: string) => {
      const ciphertextBuffer = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(ivData.slice(0, 12)),
          additionalData: encode(nonce),
        },
        key,
        encode(plaintext)
      );
      return btoa(decode(ciphertextBuffer));
    },
    decrypt: async (ciphertext: string) => {
      const ciphertextArray = Uint8Array.from(atob(ciphertext), (c) =>
        c.charCodeAt(0)
      );
      const plaintextBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(ivData.slice(0, 12)),
          additionalData: encode(nonce),
        },
        key,
        ciphertextArray
      );
      return decode(plaintextBuffer);
    },
  };
}
