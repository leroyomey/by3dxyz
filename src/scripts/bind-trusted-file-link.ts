import {
  isLicenseProof,
  isTrustedFileLink,
  licenseProofError,
  licenseProofMax,
  licenseProofTooLong,
  looksLikeFileLink,
  trustedFileLinkError,
} from "../data/trusted-file-links";

const bound = new WeakSet<HTMLInputElement>();

function errorFor(input: HTMLInputElement): HTMLElement | null {
  const id = input.getAttribute("aria-errormessage");
  if (id) {
    const named = document.getElementById(id);
    if (named) return named;
  }
  const next = input.nextElementSibling;
  const marker = input.hasAttribute("data-license-proof")
    ? "data-license-proof-error"
    : "data-trusted-file-link-error";
  if (next instanceof HTMLElement && next.hasAttribute(marker)) {
    return next;
  }
  const form = input.form || input.closest("form");
  return form?.querySelector(`[${marker}]`) || null;
}

function showError(input: HTMLInputElement, message: string) {
  input.setCustomValidity(message);
  input.setAttribute("aria-invalid", "true");
  const box = errorFor(input);
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

function clearError(input: HTMLInputElement) {
  input.setCustomValidity("");
  input.removeAttribute("aria-invalid");
  const box = errorFor(input);
  if (box) {
    box.textContent = "";
    box.hidden = true;
  }
}

export function applyTrustedFileLinkValidity(input: HTMLInputElement): boolean {
  const value = input.value.trim();
  if (!value) {
    clearError(input);
    return true;
  }
  if (isTrustedFileLink(value)) {
    clearError(input);
    return true;
  }
  showError(input, trustedFileLinkError);
  return false;
}

export function applyLicenseProofValidity(input: HTMLInputElement): boolean {
  const value = input.value.trim();
  if (!value) {
    clearError(input);
    return true;
  }
  if (looksLikeFileLink(value) && !isLicenseProof(value)) {
    showError(input, licenseProofError);
    return false;
  }
  if (value.length > licenseProofMax) {
    showError(input, licenseProofTooLong);
    return false;
  }
  if (isLicenseProof(value)) {
    clearError(input);
    return true;
  }
  showError(input, licenseProofError);
  return false;
}

function bindValidity(
  input: HTMLInputElement,
  apply: (el: HTMLInputElement) => boolean,
) {
  if (bound.has(input)) return;
  bound.add(input);

  const sync = () => apply(input);
  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
  input.addEventListener("blur", sync);

  const form = input.form;
  if (!form) return;

  form.addEventListener(
    "submit",
    (event) => {
      const ok = apply(input);
      if (ok) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.reportValidity();
    },
    true,
  );
}

export function bindTrustedFileLink(input: HTMLInputElement) {
  bindValidity(input, applyTrustedFileLinkValidity);
}

export function bindLicenseProof(input: HTMLInputElement) {
  bindValidity(input, applyLicenseProofValidity);
}

export function bindTrustedFileLinks(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>("[data-trusted-file-link]").forEach(bindTrustedFileLink);
  root.querySelectorAll<HTMLInputElement>("[data-license-proof]").forEach(bindLicenseProof);
}

if (typeof window !== "undefined") {
  window.by3dxyzIsTrustedFileLink = isTrustedFileLink;
  window.by3dxyzIsLicenseProof = isLicenseProof;
  bindTrustedFileLinks();
}
