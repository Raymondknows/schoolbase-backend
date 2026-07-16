import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultsPublishedEmailContent, buildResultsPublishedWhatsAppMessage, buildPinDeliveryEmailContent, buildPinDeliveryWhatsAppMessage } from '../email.js';

test('buildResultsPublishedEmailContent includes the student, assessment, and parent portal link', () => {
  const content = buildResultsPublishedEmailContent({
    guardianName: 'Mrs. Ada',
    pupilName: 'Ada Okafor',
    assessmentName: 'Midterm Mathematics',
    termName: '1st Term',
    schoolName: 'Bright Stars Academy',
    resultsUrl: 'https://schoolbase.live/parent/results',
  });

  assert.match(content.subject, /Results Published/);
  assert.match(content.text, /Ada Okafor/);
  assert.match(content.text, /Midterm Mathematics/);
  assert.match(content.text, /1st Term/);
  assert.match(content.text, /https:\/\/schoolbase.live\/parent\/results/);
  assert.match(content.html, /Results Published/);
  assert.match(content.html, /parent\/results/);
});

test('buildResultsPublishedWhatsAppMessage includes the assessment and portal link', () => {
  const message = buildResultsPublishedWhatsAppMessage({
    guardianName: 'Mrs. Ada',
    pupilName: 'Ada Okafor',
    assessmentName: 'Midterm Mathematics',
    termName: '1st Term',
    schoolName: 'Bright Stars Academy',
    resultsUrl: 'https://schoolbase.live/parent/results',
  });

  assert.match(message, /Mrs. Ada/);
  assert.match(message, /Ada Okafor/);
  assert.match(message, /Midterm Mathematics/);
  assert.match(message, /https:\/\/schoolbase.live\/parent\/results/);
});

test('buildPinDeliveryEmailContent includes the student name and PIN', () => {
  const content = buildPinDeliveryEmailContent({
    guardianName: 'Mrs. Ada',
    pupilName: 'Ada Okafor',
    pin: 'ABCD-1234',
    schoolName: 'Bright Stars Academy',
    schoolCode: 'greenfield',
    admissionNumber: 'GFA-2026-0008',
    sessionName: '2026/2027',
    termName: 'First Term',
    resultsUrl: 'https://schoolbase.live/parent/results',
  });

  assert.match(content.subject, /Result PIN/);
  assert.match(content.text, /Ada Okafor/);
  assert.match(content.text, /ABCD-1234/);
  assert.match(content.text, /greenfield/);
  assert.match(content.text, /GFA-2026-0008/);
  assert.match(content.text, /2026\/2027/);
  assert.match(content.text, /First Term/);
  assert.match(content.html, /ABCD-1234/);
  assert.match(content.html, /parent\/results/);
});

test('buildPinDeliveryWhatsAppMessage includes the PIN and portal link', () => {
  const message = buildPinDeliveryWhatsAppMessage({
    guardianName: 'Mrs. Ada',
    pupilName: 'Ada Okafor',
    pin: 'ABCD-1234',
    schoolName: 'Bright Stars Academy',
    resultsUrl: 'https://schoolbase.live/parent/results',
  });

  assert.match(message, /Mrs. Ada/);
  assert.match(message, /Ada Okafor/);
  assert.match(message, /ABCD-1234/);
  assert.match(message, /https:\/\/schoolbase.live\/parent\/results/);
});
