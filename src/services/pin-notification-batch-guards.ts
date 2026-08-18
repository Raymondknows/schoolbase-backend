export interface BulkPinNotificationValidationInput {
  pinCount: number;
  guardianCount: number;
}

export interface BulkPinNotificationValidationResult {
  ok: boolean;
  reason?: string;
  maxPins?: number;
  maxTotalNotifications?: number;
  maxPinsPerBatch?: number;
}

export interface BulkPinNotificationBatch {
  pinIds: string[];
}

const MAX_PINS_PER_BATCH = 10;
const MAX_TOTAL_NOTIFICATIONS = 20;

function getSafePinBatchSize(guardianCount: number): number {
  const effectiveGuardianCount = Math.max(1, guardianCount);
  return Math.min(MAX_PINS_PER_BATCH, Math.max(1, Math.floor(MAX_TOTAL_NOTIFICATIONS / effectiveGuardianCount)));
}

export function validateBulkPinNotificationRequest({
  pinCount,
  guardianCount,
}: BulkPinNotificationValidationInput): BulkPinNotificationValidationResult {
  if (!Number.isInteger(pinCount) || pinCount <= 0) {
    return { ok: false, reason: 'Please select at least one PIN.' };
  }

  const safeBatchSize = getSafePinBatchSize(guardianCount);
  const totalNotifications = pinCount * Math.max(1, guardianCount);
  if (totalNotifications > MAX_TOTAL_NOTIFICATIONS) {
    return {
      ok: true,
      maxPins: MAX_PINS_PER_BATCH,
      maxTotalNotifications: MAX_TOTAL_NOTIFICATIONS,
      maxPinsPerBatch: safeBatchSize,
    };
  }

  return { ok: true, maxPins: MAX_PINS_PER_BATCH, maxTotalNotifications: MAX_TOTAL_NOTIFICATIONS, maxPinsPerBatch: safeBatchSize };
}

export function buildBulkPinNotificationBatches({
  pinIds,
  guardianCount,
}: {
  pinIds: string[];
  guardianCount: number;
}): BulkPinNotificationBatch[] {
  const safeBatchSize = getSafePinBatchSize(guardianCount);
  const batches: BulkPinNotificationBatch[] = [];

  for (let index = 0; index < pinIds.length; index += safeBatchSize) {
    batches.push({ pinIds: pinIds.slice(index, index + safeBatchSize) });
  }

  return batches;
}
