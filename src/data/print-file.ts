import { customWork } from "./custom-work";
import colorVariantSet from "./color-variants.json";
import { printFileLinkHelp } from "./trusted-file-links";

export const printColors = colorVariantSet.groups[0].values.map((value) => value.name);

export const printFile = {
  year: 2026,
  quoteWindow: customWork.quoteWindow,
  leadTime: "after the invoice is paid",
  maxPieceIn: customWork.maxPieceIn,
  maxPieceMm: customWork.maxPieceMm,
  formats: "STL, 3MF, or OBJ",
  kicker: "Print a file",
  title: "Print a file you already have",
  lede:
    "Send a share link to your STL, 3MF, or OBJ. You get a firm price by email, then a PayPal invoice if you want the job. Nothing is charged on this page. You get the printed part in the mail.",
  quoteLead: customWork.quoteLead,
  chargeCopy: "Nothing is charged on this page.",
  invoiceCopy: "You get a firm price by email, then a PayPal invoice if you want the job.",
  sliceCopy:
    "The estimate comes by email after we slice the file. Price depends on size, color, and how the part sits on the plate.",
  payCopy: "Pay by PayPal invoice if you want us to print it. There is no PayPal button on this page.",
  linkCopy: printFileLinkHelp,
  get maxPieceCopy() {
    return customWork.maxPieceCopy;
  },
  get thanksCopy() {
    return `The shop will email a firm price in ${this.quoteWindow}. Then a PayPal invoice if you want the job. ${this.chargeCopy} ${this.quoteLead}`;
  },
  steps: [
    {
      name: "File link",
      copy: "Paste a share link to your STL, 3MF, or OBJ. Add notes so we do not guess the scale.",
    },
    {
      name: "Color, size, quantity",
      copy: "Pick a shop color, tell us the size, and how many to print.",
    },
    {
      name: "What happens next",
      copy: "Firm price by email, then a PayPal invoice. Nothing is charged on this page. You get the printed part in the mail.",
    },
  ],
};
