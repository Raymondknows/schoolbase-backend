import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchoolSetupStatus } from '../src/services/onboarding.js';

test('buildSchoolSetupStatus marks incomplete schools as not ready when core onboarding items are missing', () => {
  const result = buildSchoolSetupStatus({
    school: {
      name: 'Bright Future Academy',
      country: 'Ghana',
      currency: 'GHS',
      address: 'Accra',
      city: 'Accra',
      phone: '+233000000000',
      email: 'info@brightfuture.edu.gh',
      logoUrl: null,
      principalName: null,
      principalComment: null,
      principalSignatureUrl: null,
      stampUrl: null,
      manualPaymentAccountName: null,
      manualPaymentAccountNumber: null,
      manualPaymentBankName: null,
      paystackPublicEncrypted: null,
      paystackSecretEncrypted: null,
    },
    counts: {
      enabledPhases: 1,
      academicYears: 1,
      classes: 3,
      subjects: 8,
      teacherClasses: 2,
      feeSchedules: 1,
      students: 20,
      announcements: 0,
      assessments: 0,
    },
  });

  assert.equal(result.isComplete, false);
  assert.equal(result.completionPercentage < 100, true);
  assert.ok(result.incompleteItems.includes('School logo / branding'));
  assert.ok(result.incompleteItems.includes('Send your first announcement'));
  assert.ok(result.incompleteItems.includes('Publish your first assessment'));
  assert.ok(!result.incompleteItems.includes('Classes'));
  assert.ok(!result.incompleteItems.includes('Subjects'));
});

test('buildSchoolSetupStatus marks a full onboarding state as complete even when class and subject setup is still recommended', () => {
  const result = buildSchoolSetupStatus({
    school: {
      name: 'Bright Future Academy',
      country: 'Ghana',
      currency: 'GHS',
      address: 'Accra',
      city: 'Accra',
      phone: '+233000000000',
      email: 'info@brightfuture.edu.gh',
      logoUrl: 'https://cdn.example.com/logo.png',
      principalName: 'Mrs. Mensah',
      principalComment: 'Welcome',
      principalSignatureUrl: 'https://cdn.example.com/signature.png',
      stampUrl: 'https://cdn.example.com/stamp.png',
      manualPaymentAccountName: 'Bright Future Academy',
      manualPaymentAccountNumber: '1234567890',
      manualPaymentBankName: 'Zenith Bank',
      paystackPublicEncrypted: null,
      paystackSecretEncrypted: null,
    },
    counts: {
      enabledPhases: 2,
      academicYears: 2,
      classes: 10,
      subjects: 20,
      teacherClasses: 12,
      feeSchedules: 4,
      students: 200,
      announcements: 2,
      assessments: 3,
    },
  });

  assert.equal(result.isComplete, true);
  assert.equal(result.completionPercentage, 100);
  assert.deepEqual(result.incompleteItems, []);
});

test('buildSchoolSetupStatus allows onboarding to complete without a fully built class and subject structure', () => {
  const result = buildSchoolSetupStatus({
    school: {
      name: 'Bright Future Academy',
      country: 'Ghana',
      currency: 'GHS',
      address: 'Accra',
      city: 'Accra',
      phone: '+233000000000',
      email: 'info@brightfuture.edu.gh',
      logoUrl: 'https://cdn.example.com/logo.png',
      principalName: 'Mrs. Mensah',
      principalComment: 'Welcome',
      principalSignatureUrl: 'https://cdn.example.com/signature.png',
      stampUrl: 'https://cdn.example.com/stamp.png',
      manualPaymentAccountName: 'Bright Future Academy',
      manualPaymentAccountNumber: '1234567890',
      manualPaymentBankName: 'Zenith Bank',
      paystackPublicEncrypted: null,
      paystackSecretEncrypted: null,
    },
    counts: {
      enabledPhases: 0,
      academicYears: 0,
      classes: 0,
      subjects: 0,
      teacherClasses: 3,
      feeSchedules: 2,
      students: 40,
      announcements: 1,
      assessments: 1,
    },
  });

  assert.equal(result.isComplete, true);
  assert.equal(result.completionPercentage, 100);
  assert.deepEqual(result.incompleteItems, []);
});
