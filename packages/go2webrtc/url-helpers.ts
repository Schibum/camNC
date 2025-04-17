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
  return `webtorrent:?share=${shareName}&pwd=${password}`;
}

export function genRandomWebtorrent() {
  const share = Math.random().toString(36).substring(2, 15);
  const pwd = Math.random().toString(36).substring(2, 15);
  return buildWebtorrentUrl(share, pwd);
}
