export const SOURCE_ALLOWLIST = [
  "help.sap.com",
  "community.sap.com",
  "learning.sap.com",
  "userapps.support.sap.com",
  "blog.sap-press.com",
  "blogs.sap.com",
] as const;

export function isAllowedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return SOURCE_ALLOWLIST.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}
