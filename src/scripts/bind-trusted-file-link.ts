import { isTrustedFileLink, trustedFileLinkError } from "../data/trusted-file-links";

const bound = new WeakSet<HTMLInputElement>();

function errorFor(input: HTMLInputElement): HTMLElement | null {
  const id = input.getAttribute("aria-errormessage");
  if (id) {
    const named = document.getElementById(id);
    if (named) return named;
  }
  const next = input.nextElementSibling;
  if (next instanceof HTMLElement && next.hasAttribute("data-trusted-file-link-error")) {
    return next;
  }
  const form = input.form || input.closest("form");
  return form?.querySelector("[data-trusted-file-link-error]") || null;
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

export function bindTrustedFileLinks(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>("[data-trusted-file-link]").forEach(bindTrustedFileLink);
}

if (typeof window !== "undefined") {
  window.by3dxyzIsTrustedFileLink = isTrustedFileLink;
  bindTrustedFileLinks();
  document.addEventListener("astro:page-load", () => bindTrustedFileLinks());
}
