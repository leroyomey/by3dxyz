export type CustomPackageId = "tweak" | "reference" | "original";

export type CustomPackage = {
  id: CustomPackageId;
  name: string;
  blurb: string;
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
  quoteLead: "You get the printed tool in the mail.",
  quotePricing:
    "Custom work is priced by the job: a small AutoCAD change to a shop SKU, modeling from a drawing or sketch, or a new profile from an idea.",
  quoteFitCopy:
    "More detail and harder shapes take more time, so they cost more. Some requests are not a fit.",
  quoteCopies: "Extra copies of the same tool are charged at print cost.",
  shopLaterCopy:
    "The order is the printed tool that ships. The same or a similar tool may appear in the shop later.",
  get maxPieceCopy() {
    return `The largest piece we can print right now is about ${this.maxPieceIn} × ${this.maxPieceIn} × ${this.maxPieceIn} in (${this.maxPieceMm} mm wide, deep, and tall).`;
  },
  get quoteRevisions() {
    return `The quote includes ${this.includedRevisions} revision rounds. After that, $${this.extraRevision} each.`;
  },
  packages: [
    {
      id: "tweak",
      name: "Change a shop tool",
      blurb: "A small AutoCAD change to a shop SKU, then we print it.",
      hours: 1,
      print: 15,
      from: 55,
      extraCopy: 16,
      extraSize: 32,
    },
    {
      id: "reference",
      name: "From a drawing or sketch",
      blurb: "You have a drawing or sketch. We model it in AutoCAD and print it.",
      hours: 1.5,
      print: 18,
      from: 85,
      extraCopy: 18,
      extraSize: 35,
    },
    {
      id: "original",
      name: "Original profile",
      blurb: "No drawing, only an idea. We design the profile in AutoCAD, then print it.",
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
      blurb: "A small change, a clear drawing, or one profile.",
      option: "small change, clear drawing, one profile",
      hoursMul: 0.75,
    },
    {
      id: "typical",
      name: "Typical",
      blurb: "A normal custom rib or tool from a decent sketch.",
      option: "a normal custom tool from a sketch",
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
