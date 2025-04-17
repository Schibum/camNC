export function parseConnectionString(
  connectionString: string
): { share: string; pwd: string } | null {
  try {
    if (!connectionString.startsWith("webtorrent:?")) {
      return null;
    }
    const params = new URLSearchParams(
      connectionString.substring("webtorrent:?".length)
    );
    const share = params.get("share");
    const pwd = params.get("pwd");
    if (share && pwd) {
      return { share, pwd };
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function buildWebtorrentUrl(shareName: string, password: string) {
  let params = new URLSearchParams({
    share: shareName,
    pwd: password,
  });
  return `webtorrent:?${params.toString()}`;
}

export function genRandomWebtorrent() {
  const share = generatePassword(16);
  const pwd = generatePassword(16);
  return buildWebtorrentUrl(share, pwd);
}

export function generatePassword(length: number = 16) {
  const characterSet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map((byte) => characterSet[byte % characterSet.length])
    .join("");
}
