import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { normalizeWhatsappRecipient, readWhatsAppSessionSnapshotFromDisk, resolveWhatsAppSessionDirectory, resolveWhatsAppStateFile, shouldClearWhatsAppSession, writeWhatsAppSessionSnapshotToDisk } from '../whatsapp-utils.js';

test('builds a per-school session directory', () => {
  const directory = resolveWhatsAppSessionDirectory('school-123');
  assert.match(directory, /school-123$/);
  assert.match(directory, /whatsapp-sessions/);
});

test('normalizes a phone number to a WhatsApp recipient', () => {
  assert.equal(normalizeWhatsappRecipient('+2348123456789'), '2348123456789@s.whatsapp.net');
  assert.equal(normalizeWhatsappRecipient('2348123456789@s.whatsapp.net'), '2348123456789@s.whatsapp.net');
});

test('clears a WhatsApp auth session for auth-related disconnects', () => {
  assert.equal(shouldClearWhatsAppSession(401, 'Connection Failure'), true);
  assert.equal(shouldClearWhatsAppSession(403, 'Forbidden'), true);
  assert.equal(shouldClearWhatsAppSession(419, 'Session expired'), true);
  assert.equal(shouldClearWhatsAppSession(500, 'Connection closed'), true);
  assert.equal(shouldClearWhatsAppSession(undefined, 'Connection Failure'), true);
});

test('persists WhatsApp session state to disk and loads it back', () => {
  const schoolId = 'persisted-school';
  const stateFile = resolveWhatsAppStateFile(schoolId);
  mkdirSync(stateFile.replace(/[^/]+$/, ''), { recursive: true });
  writeWhatsAppSessionSnapshotToDisk(schoolId, {
    schoolId,
    status: 'connected',
    connectedAt: '2026-06-29T00:00:00.000Z',
    statusMessage: 'WhatsApp connected successfully.',
    phoneNumber: '2348123456789',
  });

  const loaded = readWhatsAppSessionSnapshotFromDisk(schoolId);

  assert.equal(loaded?.status, 'connected');
  assert.equal(loaded?.phoneNumber, '2348123456789');

  rmSync(stateFile, { force: true });
});

test('restores a persisted connected snapshot as idle when no live session is available', () => {
  const schoolId = 'restore-school';
  const stateFile = resolveWhatsAppStateFile(schoolId);
  mkdirSync(stateFile.replace(/[^/]+$/, ''), { recursive: true });
  writeWhatsAppSessionSnapshotToDisk(schoolId, {
    schoolId,
    status: 'connected',
    connectedAt: '2026-06-29T00:00:00.000Z',
    statusMessage: 'WhatsApp connected successfully.',
    phoneNumber: '2348123456789',
  });

  const loaded = readWhatsAppSessionSnapshotFromDisk(schoolId);
  assert.equal(loaded?.status, 'connected');
  assert.equal(loaded?.phoneNumber, '2348123456789');

  rmSync(stateFile, { force: true });
});
