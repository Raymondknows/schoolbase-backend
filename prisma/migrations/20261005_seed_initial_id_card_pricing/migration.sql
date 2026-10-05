INSERT INTO `IdCardPricingRule` (`id`, `version`, `currency`, `ruleJson`, `isActive`, `effectiveAt`, `reason`, `createdBy`, `approvedBy`, `createdAt`)
SELECT
    'idcardpricing_initial_v1',
    1,
    'NGN',
    '{"currency":"NGN","taxRateBps":0,"volumeBands":[{"from":1,"through":49,"unitPriceMinor":10000},{"from":50,"through":149,"unitPriceMinor":9000},{"from":150,"through":null,"unitPriceMinor":8000}],"premiumTemplateUpliftMinor":{"houseTeam":4000,"earlyLearners":4000,"seniorCollege":4000}}',
    true,
    CURRENT_TIMESTAMP(3),
    'Initial configurable Nigeria pilot pricing: NGN 100 standard card before volume pricing.',
    'SYSTEM_MIGRATION',
    'SYSTEM_MIGRATION',
    CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
    SELECT 1 FROM `IdCardPricingRule` WHERE `version` = 1
);
