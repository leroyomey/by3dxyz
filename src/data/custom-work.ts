export type CustomPackageId = "tweak" | "reference" | "original";

export type CustomPackage = {
  id: CustomPackageId;
  name: string;
  blurb: string;
  hint: string;
  hours: number;
  print: number;
  from: number;
  extraCopy: number;
  extraSize: number;
};

export type CustomComplexityId = "simple" | "typical" | "involved";

export type CustomComplexity = {
  id: CustomComplexityId;
  name: string;
  blurb: string;
  option: string;
  hoursMul: number;
};

export const defaultCustomPackageId: CustomPackageId = "reference";
export const defaultCustomComplexityId: CustomComplexityId = "typical";

/** 2026 studio rate: AutoCAD + printed proof of concept. Midpoint of the $30–$40 band. */
export const customWork = {
  year: 2026,
  hourlyRate: 35,
  extraRevision: 35,
  includedRevisions: 2,
  depositPercent: 50,
  quoteWindow: "2-4 days",
  leadTime: "2-4 weeks after the deposit",
  quoteDaysValid: 14,
  /** Minimum job still covers email/quote + print/finish/pack. */
  jobFloor: 55,
  /** Practical one-piece max on the P1S. Print limit, not a default size (shop ribs are 4/5/6 in). Official volume is 256³ mm; do not quote that as a part size. */
  maxPieceIn: 9,
  maxPieceMm: 230,
  quoteLead: "You get the printed part in the mail.",
  get thanksCopy() {
    return `Quote in ${this.quoteWindow}. ${this.depositPercent}% to start. ${this.quoteLead} The shop emails you.`;
  },
  quotePricing:
    "Custom work is priced by the job: a small AutoCAD change to a shop item, modeling from a drawing or sketch, or a new design from an idea.",
  quoteFitCopy:
    "More detail and harder shapes take more time, so they cost more. Some requests are not a fit.",
  quoteCopies: "Extra copies of the same part are charged at print cost.",
  shopLaterCopy:
    "The order is the printed part that ships. The same or a similar design may appear in the shop later.",
  get maxPieceCopy() {
    return `The largest piece we can print right now is about ${this.maxPieceIn} × ${this.maxPieceIn} × ${this.maxPieceIn} in (${this.maxPieceMm} mm wide, deep, and tall).`;
  },
  get quoteRevisions() {
    return `The quote includes ${this.includedRevisions} revision rounds. Extra rounds are $${this.extraRevision} each.`;
  },
  packages: [
    {
      id: "tweak",
      name: "Change a shop item",
      blurb: "A small AutoCAD change to something already in the shop, then we print it. A rib, a studio tool, or another part.",
      hint: "Send the shop SKU, like BO-001, and what you want changed. You get the printed part in the mail.",
      hours: 1,
      print: 15,
      from: 55,
      extraCopy: 16,
      extraSize: 32,
    },
    {
      id: "reference",
      name: "From a drawing or sketch",
      blurb: "You have a drawing or sketch. We model it in AutoCAD and print the part.",
      hint: "Send a drawing or a photo of your sketch, plus sizes. We model it in AutoCAD and print the part.",
      hours: 1.5,
      print: 18,
      from: 85,
      extraCopy: 18,
      extraSize: 35,
    },
    {
      id: "original",
      name: "Original design",
      blurb: "No drawing, only an idea. We design it in AutoCAD, then print the part.",
      hint: "Describe the idea and any sizes you know. We design it in AutoCAD, then print the part.",
      hours: 3,
      print: 22,
      from: 140,
      extraCopy: 20,
      extraSize: 42,
    },
  ] as CustomPackage[],
  complexities: [
    {
      id: "simple",
      name: "Simple",
      blurb: "A small change, a clear drawing, or one part.",
      option: "small change, clear drawing, one part",
      hoursMul: 0.75,
    },
    {
      id: "typical",
      name: "Typical",
      blurb: "A normal custom part from a decent sketch.",
      option: "a normal custom part from a sketch",
      hoursMul: 1,
    },
    {
      id: "involved",
      name: "Involved",
      blurb: "Compound curves, lots of detail, or a rough sketch. We review these, and some are a no.",
      option: "more detail (review, may be a no)",
      hoursMul: 1.75,
    },
  ] as CustomComplexity[],
};

export function customPackage(id: string) {
  return (
    customWork.packages.find((item) => item.id === id) ??
    customWork.packages.find((item) => item.id === defaultCustomPackageId) ??
    customWork.packages[0]
  );
}

export function customQuoteSubject(id: string) {
  return `Custom quote: ${customPackage(id).name}`;
}

export function customComplexity(id: string) {
  return (
    customWork.complexities.find((item) => item.id === id) ??
    customWork.complexities.find((item) => item.id === defaultCustomComplexityId) ??
    customWork.complexities[1]
  );
}

function roundFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function estimateCustom(
  packageId: string,
  qty: number,
  extraSizes: number,
  complexityId: string = defaultCustomComplexityId,
) {
  const pack = customPackage(packageId);
  const complexity = customComplexity(complexityId);
  const copies = Math.max(1, Math.min(8, Number(qty) || 1));
  const sizes = Math.max(0, Math.min(4, Number(extraSizes) || 0));
  const hours = pack.hours * complexity.hoursMul;
  const raw = roundFive(hours * customWork.hourlyRate + pack.print);
  const fromFloor = roundFive(pack.from * Math.min(1, complexity.hoursMul));
  const first = Math.max(customWork.jobFloor, fromFloor, raw);
  const total = first + pack.extraCopy * (copies - 1) + pack.extraSize * sizes;
  const high = roundFive(total * 1.3);
  return {
    pack,
    complexity,
    copies,
    sizes,
    low: total,
    high: Math.max(total, high),
    label: high > total ? `$${total}-$${high}` : `$${total}`,
  };
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    value,
  );
}
