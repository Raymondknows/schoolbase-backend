import test from 'node:test';
import assert from 'node:assert/strict';
import { SchoolWhatsAppRateLimiter } from '../whatsapp-rate-limiter.js';

test('school rate limiter isolates counters per school', async () => {
  const limiter = new SchoolWhatsAppRateLimiter({
    minIntervalMs: 0,
    perMinuteLimit: 2,
    perHourLimit: 10,
    perDayLimit: 20,
  });

  assert.equal(await limiter.tryAcquire('school-a'), true);
  assert.equal(await limiter.tryAcquire('school-a'), true);
  assert.equal(await limiter.tryAcquire('school-a'), false);

  assert.equal(await limiter.tryAcquire('school-b'), true);
  assert.equal(await limiter.tryAcquire('school-b'), true);
  assert.equal(await limiter.tryAcquire('school-b'), false);
});

test('rate limiter enforces a minimum interval between sends for the same school', async () => {
  const limiter = new SchoolWhatsAppRateLimiter({
    minIntervalMs: 30,
    perMinuteLimit: 10,
    perHourLimit: 60,
    perDayLimit: 200,
  });

  const first = await limiter.tryAcquire('school-c');
  const second = await limiter.tryAcquire('school-c');

  assert.equal(first, true);
  assert.equal(second, false);
});
