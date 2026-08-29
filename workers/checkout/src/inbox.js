import { estimateCustom, customPackage, customQuoteSubject } from "../../../src/data/custom-work.ts";
import { isTrustedFileLink } from "../../../src/data/trusted-file-links.ts";

const JOBS = new Set(["tweak", "reference", "original"]);

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function qtyBetween(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const qty = Math.floor(Number(value));
  if (!Number.isFinite(qty) || qty < min || qty > max) return null;
  return qty;
}

function skuCode(value) {
  const sku = String(value || "").trim().toUpperCase();
  // Catalog codes only. BO-001, BO-019-1, SW-001, GP-GRIP. Reject anything else.
  return /^(BO-\d{3}(?:-\d+)?|SW-\d{3}|GP-[A-Z]+)$/.test(sku) ? sku : "";
}

export function buildInboxPayload(body) {
  if (String(body?._honey || "").trim()) return { skip: true };
  const kind = String(body?.kind || "").trim();
  const name = clip(body?.name, 80);
  const email = clip(body?.email, 200);
  if (!name || !isEmail(email)) throw new Error("Please check the form and send again.");

  if (kind === "contact") {
    const message = clip(body?.message, 4000);
    if (!message) throw new Error("Please check the form and send again.");
    return {
      payload: {
        _subject: "by3DXYZ contact",
        _template: "table",
        _captcha: "false",
        name,
        email,
        message,
      },
    };
  }

  if (kind === "print") {
    const fileLink = clip(body?.file_link, 500);
    const quantity = qtyBetween(body?.quantity, 1, 10, 1);
    if (!fileLink || !isTrustedFileLink(fileLink) || !quantity) {
      throw new Error("Please check the form and send again.");
    }
    return {
      payload: {
        _subject: "by3DXYZ print a file request",
        _template: "table",
        _captcha: "false",
        name,
        email,
        file_link: fileLink,
        size_notes: clip(body?.size_notes, 500),
        color: clip(body?.color, 80),
        quantity: String(quantity),
        notes: clip(body?.notes, 2000),
      },
    };
  }

  if (kind === "custom") {
    const jobId = clip(body?.job_id, 20);
    if (!JOBS.has(jobId)) throw new Error("Please check the form and send again.");
    const quantity = qtyBetween(body?.quantity, 1, 8, 1);
    const extraSizes = qtyBetween(body?.extra_sizes, 0, 4, 0);
    if (!quantity || extraSizes === null) throw new Error("Please check the form and send again.");
    const photo = clip(body?.photo, 500);
    if (photo && !isTrustedFileLink(photo)) throw new Error("Please check the form and send again.");
    const quoted = estimateCustom(jobId, quantity, extraSizes);
    const chosen = customPackage(jobId);
    const out = {
      _subject: customQuoteSubject(jobId),
      _template: "table",
      _captcha: "false",
      name,
      email,
      job: chosen.name,
      job_id: jobId,
      quote_subject: customQuoteSubject(jobId),
      quantity: String(quantity),
      extra_sizes: String(extraSizes),
      notes: clip(body?.notes, 4000),
      photo,
      estimate: quoted.label,
    };
    if (jobId === "tweak") {
      const sku = skuCode(body?.sku);
      if (!sku) throw new Error("Please check the form and send again.");
      out.sku = sku;
    }
    return { payload: out };
  }

  throw new Error("Please check the form and send again.");
}
