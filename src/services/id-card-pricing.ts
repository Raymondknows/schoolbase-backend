export type IdCardVolumeBand = {
  from: number;
  through: number | null;
  unitPriceMinor: number;
};

export type IdCardPricingRule = {
  currency: string;
  taxRateBps: number;
  volumeBands: IdCardVolumeBand[];
  premiumTemplateUpliftMinor: Record<string, number>;
};

export type IdCardOrientation = "PORTRAIT" | "LANDSCAPE";

export const ID_CARD_TEMPLATES = {
  crestClassic: { tier: "STANDARD", label: "Crest Classic", description: "Formal crest-led identity with a strong school masthead.", defaultOrientation: "PORTRAIT", orientations: ["PORTRAIT", "LANDSCAPE"] },
  modernInstitution: { tier: "STANDARD", label: "Modern Institution", description: "Contemporary editorial grid with clear identity hierarchy.", defaultOrientation: "LANDSCAPE", orientations: ["PORTRAIT", "LANDSCAPE"] },
  inkSaver: { tier: "STANDARD", label: "Ink Saver", description: "Monochrome layout designed for economical school printing.", defaultOrientation: "LANDSCAPE", orientations: ["PORTRAIT", "LANDSCAPE"] },
  houseTeam: { tier: "PREMIUM", label: "House & Team", description: "Bold team-color treatment while preserving readable labels.", defaultOrientation: "LANDSCAPE", orientations: ["PORTRAIT", "LANDSCAPE"] },
  earlyLearners: { tier: "PREMIUM", label: "Early Learners", description: "Large portrait and name for clear recognition.", defaultOrientation: "PORTRAIT", orientations: ["PORTRAIT", "LANDSCAPE"] },
  seniorCollege: { tier: "PREMIUM", label: "Senior / College", description: "Minimal, mature layout with a refined identity panel.", defaultOrientation: "LANDSCAPE", orientations: ["PORTRAIT", "LANDSCAPE"] },
} as const;

export const DEFAULT_ID_CARD_PRICING_RULE: IdCardPricingRule = {
  currency: "NGN",
  taxRateBps: 0,
  volumeBands: [
    { from: 1, through: 49, unitPriceMinor: 10000 },
    { from: 50, through: 149, unitPriceMinor: 9000 },
    { from: 150, through: null, unitPriceMinor: 8000 },
  ],
  premiumTemplateUpliftMinor: {
    houseTeam: 4000,
    earlyLearners: 4000,
    seniorCollege: 4000,
  },
};

export function validateIdCardPricingRule(value: unknown): value is IdCardPricingRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Partial<IdCardPricingRule>;
  if (typeof rule.currency !== "string" || !/^[A-Z]{3}$/.test(rule.currency)) return false;
  if (!Number.isInteger(rule.taxRateBps) || (rule.taxRateBps ?? -1) < 0 || (rule.taxRateBps ?? 0) > 10000) return false;
  if (!Array.isArray(rule.volumeBands) || rule.volumeBands.length === 0) return false;
  if (!rule.premiumTemplateUpliftMinor || typeof rule.premiumTemplateUpliftMinor !== "object" || Array.isArray(rule.premiumTemplateUpliftMinor)) return false;

  let expectedFrom = 1;
  let previousPrice = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rule.volumeBands.length; index += 1) {
    const band = rule.volumeBands[index];
    if (!band || !Number.isInteger(band.from) || band.from !== expectedFrom) return false;
    if (band.through !== null && (!Number.isInteger(band.through) || band.through < band.from)) return false;
    if (!Number.isInteger(band.unitPriceMinor) || band.unitPriceMinor < 0 || band.unitPriceMinor > previousPrice) return false;
    if (index < rule.volumeBands.length - 1 && band.through === null) return false;
    if (index === rule.volumeBands.length - 1 && band.through !== null) return false;
    expectedFrom = band.through === null ? -1 : band.through + 1;
    previousPrice = band.unitPriceMinor;
  }

  return Object.entries(rule.premiumTemplateUpliftMinor).every(([templateId, uplift]) =>
    Object.prototype.hasOwnProperty.call(ID_CARD_TEMPLATES, templateId) &&
    ID_CARD_TEMPLATES[templateId as keyof typeof ID_CARD_TEMPLATES].tier === "PREMIUM" &&
    Number.isInteger(uplift) && uplift >= 0,
  );
}

export function calculateIdCardQuote(input: {
  quantity: number;
  templateId: string;
  rule: IdCardPricingRule;
}) {
  const { quantity, templateId, rule } = input;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw new Error("Select between 1 and 1,000 students per order.");
  }
  if (!Object.prototype.hasOwnProperty.call(ID_CARD_TEMPLATES, templateId)) {
    throw new Error("The selected card template is unavailable.");
  }
  if (!validateIdCardPricingRule(rule)) {
    throw new Error("The active card pricing rule is invalid.");
  }

  let baseAmountMinor = 0;
  let remaining = quantity;
  let nextStudentNumber = 1;
  const bandBreakdown: Array<{ from: number; through: number; quantity: number; unitPriceMinor: number; lineTotalMinor: number }> = [];

  for (const band of rule.volumeBands) {
    if (remaining <= 0) break;
    const bandEnd = band.through ?? quantity;
    const applicable = Math.max(0, Math.min(remaining, bandEnd - nextStudentNumber + 1));
    if (applicable === 0) continue;
    const lineTotalMinor = applicable * band.unitPriceMinor;
    baseAmountMinor += lineTotalMinor;
    bandBreakdown.push({
      from: band.from,
      through: bandEnd,
      quantity: applicable,
      unitPriceMinor: band.unitPriceMinor,
      lineTotalMinor,
    });
    remaining -= applicable;
    nextStudentNumber += applicable;
  }

  const template = ID_CARD_TEMPLATES[templateId as keyof typeof ID_CARD_TEMPLATES];
  const upliftPerCardMinor = template.tier === "PREMIUM" ? rule.premiumTemplateUpliftMinor[templateId] ?? 0 : 0;
  const premiumAmountMinor = quantity * upliftPerCardMinor;
  const subtotalMinor = baseAmountMinor + premiumAmountMinor;
  const taxMinor = Math.round((subtotalMinor * rule.taxRateBps) / 10000);

  return {
    currency: rule.currency,
    quantity,
    templateId,
    templateTier: template.tier,
    baseAmountMinor,
    premiumAmountMinor,
    upliftPerCardMinor,
    subtotalMinor,
    discountMinor: 0,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    bandBreakdown,
  };
}
