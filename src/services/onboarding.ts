type SchoolSetupFields = {
  name?: string | null;
  country?: string | null;
  currency?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  principalName?: string | null;
  principalComment?: string | null;
  principalSignatureUrl?: string | null;
  stampUrl?: string | null;
  manualPaymentAccountName?: string | null;
  manualPaymentAccountNumber?: string | null;
  manualPaymentBankName?: string | null;
  paystackPublicEncrypted?: string | null;
  paystackSecretEncrypted?: string | null;
};

type Counts = {
  enabledPhases: number;
  academicYears: number;
  classes: number;
  subjects: number;
  teacherClasses: number;
  feeSchedules: number;
  students: number;
  announcements: number;
  assessments: number;
};

export function buildSchoolSetupStatus({
  school,
  counts,
}: {
  school: SchoolSetupFields | null;
  counts: Counts;
}) {
  const setupItems = {
    hasEnabledPhases: counts.enabledPhases > 0,
    hasAcademicYears: counts.academicYears > 0,
    hasClasses: counts.classes > 0,
    hasSubjects: counts.subjects > 0,
    hasStaff: counts.teacherClasses > 0,
    hasFees: counts.feeSchedules > 0,
    hasStudents: counts.students > 0,
    hasSchoolProfile: Boolean(
      school?.name &&
      school?.address &&
      school?.city &&
      school?.country &&
      school?.currency &&
      school?.phone &&
      school?.email,
    ),
    hasSchoolLogo: Boolean(school?.logoUrl),
    hasPrincipalInfo: Boolean(school?.principalName || school?.principalComment),
    hasPrincipalSignature: Boolean(school?.principalSignatureUrl),
    hasSchoolStamp: Boolean(school?.stampUrl),
    hasPaymentSetup: Boolean(
      (school?.manualPaymentAccountName && school?.manualPaymentAccountNumber && school?.manualPaymentBankName) ||
      (school?.paystackPublicEncrypted && school?.paystackSecretEncrypted),
    ),
    hasAnnouncement: counts.announcements > 0,
    hasAssessment: counts.assessments > 0,
  };

  const itemLabels: Record<string, string> = {
    hasEnabledPhases: 'Enabled school phases',
    hasAcademicYears: 'Academic years',
    hasClasses: 'Classes',
    hasSubjects: 'Subjects',
    hasStaff: 'Staff / teacher setup',
    hasFees: 'Fee schedules',
    hasStudents: 'Students registered',
    hasSchoolProfile: 'School profile details',
    hasSchoolLogo: 'School logo / branding',
    hasPrincipalInfo: 'Principal info',
    hasPrincipalSignature: 'Principal signature',
    hasSchoolStamp: 'School stamp',
    hasPaymentSetup: 'Payment setup',
    hasAnnouncement: 'Send your first announcement',
    hasAssessment: 'Publish your first assessment',
  };

  const requiredItems = {
    hasSchoolProfile: setupItems.hasSchoolProfile,
    hasStaff: setupItems.hasStaff,
    hasStudents: setupItems.hasStudents,
    hasFees: setupItems.hasFees,
    hasPaymentSetup: setupItems.hasPaymentSetup,
    hasAnnouncement: setupItems.hasAnnouncement,
    hasAssessment: setupItems.hasAssessment,
    hasSchoolLogo: setupItems.hasSchoolLogo,
    hasPrincipalInfo: setupItems.hasPrincipalInfo,
    hasPrincipalSignature: setupItems.hasPrincipalSignature,
    hasSchoolStamp: setupItems.hasSchoolStamp,
  };

  const incompleteItems = Object.entries(setupItems)
    .filter(([key, value]) => {
      if (key === 'hasClasses' || key === 'hasSubjects' || key === 'hasEnabledPhases' || key === 'hasAcademicYears') {
        return false;
      }
      return !Boolean(value);
    })
    .map(([key]) => itemLabels[key] || key);

  const requiredIncompleteItems = Object.entries(requiredItems)
    .filter(([, value]) => !Boolean(value))
    .map(([key]) => itemLabels[key] || key);

  const isComplete = requiredIncompleteItems.length === 0;

  return {
    isComplete,
    setupItems,
    incompleteItems: requiredIncompleteItems.length > 0 ? requiredIncompleteItems : [],
    completionPercentage: Math.round(
      (Object.values(requiredItems).filter((value) => Boolean(value)).length / Object.values(requiredItems).length) * 100,
    ),
  };
}
