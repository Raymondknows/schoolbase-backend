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

const DEFAULT_SCHOOL_BULK_BATCH_SIZE = 250;
const MAX_PINS_PER_BATCH = DEFAULT_SCHOOL_BULK_BATCH_SIZE;
const MAX_TOTAL_NOTIFICATIONS = DEFAULT_SCHOOL_BULK_BATCH_SIZE;

function getSafePinBatchSize(): number {
  return Math.max(1, MAX_PINS_PER_BATCH);
}

export function validateBulkPinNotificationRequest({
  pinCount,
  guardianCount,
}: BulkPinNotificationValidationInput): BulkPinNotificationValidationResult {
  if (!Number.isInteger(pinCount) || pinCount <= 0) {
    return { ok: false, reason: 'Please select at least one PIN.' };
  }

  const safeBatchSize = getSafePinBatchSize();
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
  const batchSize = Math.max(1, Math.min(getSafePinBatchSize(), Math.max(1, pinIds.length)));
  const batches: BulkPinNotificationBatch[] = [];

  for (let index = 0; index < pinIds.length; index += batchSize) {
    batches.push({ pinIds: pinIds.slice(index, index + batchSize) });
  }

  return batches;
}
