const DEFAULT_CREDITS_PER_RMB = 2;

function getCreditsPerRmb() {
  const configured = Number(process.env.RECHARGE_CREDITS_PER_RMB || DEFAULT_CREDITS_PER_RMB);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CREDITS_PER_RMB;
}

function normalizeRechargeAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function calculateRechargeCredits(amount) {
  const normalizedAmount = normalizeRechargeAmount(amount);
  if (normalizedAmount <= 0) return 0;
  return Math.max(1, Math.round(normalizedAmount * getCreditsPerRmb()));
}

module.exports = {
  DEFAULT_CREDITS_PER_RMB,
  calculateRechargeCredits,
  getCreditsPerRmb,
  normalizeRechargeAmount,
};
