/** Customer attestation. Not a license check. The shop can still refuse. */

export const designRights = {
  legend: "Design rights",
  warrantCopy: "I have the right to have this part printed.",
  refuseCopy: "We do not print files you do not have the right to use.",
  sourceLabel: "How you have the right",
  licenseLabel: "License or permission",
  licenseHelp:
    "A license or order link, or a few words, like Cults personal license or email from designer.",
  licenseRequiredCopy: "If the design is not yours, add the license or permission.",
  missingWarrant: "Confirm you have the right to have this part printed.",
  missingSource: "Say how you have the right to print this.",
  sources: [
    { id: "own", label: "I made this design", email: "made the design" },
    { id: "license", label: "I have a license to print it", email: "purchased license" },
    { id: "permission", label: "I have written permission from the owner", email: "owner permission" },
  ],
} as const;

export type DesignSourceId = (typeof designRights.sources)[number]["id"];

export function designSourceLabel(id: string) {
  return designRights.sources.find((item) => item.id === id)?.label ?? "";
}

export function designSourceEmail(id: string) {
  return designRights.sources.find((item) => item.id === id)?.email ?? id;
}

export function attestationLine(sourceId: string, proof: string) {
  const how = designSourceEmail(sourceId) || "right to print";
  const extra = proof.trim() ? ` License or permission: ${proof.trim()}` : "";
  return `Customer attests they have the right to have this part printed (${how}).${extra}`;
}
