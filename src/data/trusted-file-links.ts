/** Customer file-share URLs. HTTPS only, known hosts, including subdomains. */

export const trustedFileHosts = [
  "drive.google.com",
  "docs.google.com",
  "googleusercontent.com",
  "usercontent.google.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "wetransfer.com",
  "we.tl",
  "onedrive.live.com",
  "1drv.ms",
  "sharepoint.com",
  "icloud.com",
  "box.com",
  "app.box.com",
  "mega.nz",
  "mega.io",
  "printables.com",
  "thingiverse.com",
  "cults3d.com",
  "thangs.com",
  "myminifactory.com",
] as const;

/** Blocked even if a host were later added to the allowlist. we.tl and 1drv.ms stay allowed. */
export const blockedFileLinkShorteners = [
  "bit.ly",
  "bitly.com",
  "j.mp",
  "t.co",
  "tinyurl.com",
  "tiny.cc",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "lnkd.in",
  "v.gd",
  "tiny.one",
  "s.id",
  "clck.ru",
  "short.io",
  "adf.ly",
  "bit.do",
  "lnk.to",
  "x.co",
] as const;

export const trustedFileLinkError =
  "Use a Google Drive, Dropbox, WeTransfer, OneDrive, or similar link.";

/** Named hosts we accept. Form help names the common ones, then "or similar." */
export const trustedFileHostList =
  "Google Drive, Dropbox, WeTransfer, OneDrive, iCloud, Box, Mega, Printables, Thingiverse, Cults3D, Thangs, or MyMiniFactory.";

export const trustedFileLinkHelp =
  "Paste a Google Drive, Dropbox, WeTransfer, OneDrive, or similar share link.";

export const printFileLinkHelp = `${trustedFileLinkHelp} Do not email the file.`;

export const optionalFileLinkHelp = `Optional. ${trustedFileLinkHelp}`;

function hostMatches(hostname: string, allowed: string): boolean {
  const host = hostname.toLowerCase();
  const needle = allowed.toLowerCase();
  return host === needle || host.endsWith("." + needle);
}

function isIpHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  if (hostname.includes(":")) return true;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function normalizeFileLink(raw: string): string {
  return raw.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

export function isTrustedFileLink(raw: string): boolean {
  const value = normalizeFileLink(raw);
  if (!value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!host || isIpHostname(host)) return false;
  if (blockedFileLinkShorteners.some((item) => hostMatches(host, item))) return false;
  return trustedFileHosts.some((item) => hostMatches(host, item));
}
