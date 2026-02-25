const TRACKING_PARAM_EXACT = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "spm",
  "scm",
  "scm_id",
  "xptdk",
  "_xptdk",
  "mkt_tok",
  "ref",
  "ref_src",
  "source",
  "sourceid",
  "campaign",
  "campaignid",
]);

const TRACKING_PARAM_PREFIXES = [
  "utm_",
  "hsa_",
  "ga_",
  "pk_",
  "aff_",
];

function isTrackingParam(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized.length) return false;
  if (TRACKING_PARAM_EXACT.has(normalized)) return true;

  return TRACKING_PARAM_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function canonicalizeProductUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.length) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return trimmed;
  }

  parsed.hash = "";

  const keys = Array.from(parsed.searchParams.keys());
  for (const key of keys) {
    if (isTrackingParam(key)) {
      parsed.searchParams.delete(key);
    }
  }

  if (parsed.protocol === "https:" && parsed.port === "443") {
    parsed.port = "";
  }
  if (parsed.protocol === "http:" && parsed.port === "80") {
    parsed.port = "";
  }

  return parsed.toString();
}
