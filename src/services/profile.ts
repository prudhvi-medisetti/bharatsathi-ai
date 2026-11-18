import type { DashboardRecord, UserProfile } from './dashboard';

export type ProfileCompletionSection = {
  label: string;
  complete: boolean;
};

const hasValue = (value: unknown) => {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null && value !== '';
};

export function getProfileCompletionSections(
  profile: UserProfile | null | undefined,
  documents: DashboardRecord[],
  authName?: string | null,
  authEmail?: string | null,
): ProfileCompletionSection[] {
  const personName = profile?.name || authName;
  const email = profile?.email || authEmail;
  const hasEducation = hasValue(profile?.education)
    || hasValue(profile?.educationLevel)
    || hasValue(profile?.course);
  const hasEmployment = hasValue(profile?.occupation)
    || hasValue(profile?.employmentStatus);
  const hasFinancial = hasValue(profile?.annualIncome)
    || hasValue(profile?.incomeRange);

  return [
    { label: 'Personal Details', complete: Boolean(personName && email) },
    { label: 'Location', complete: hasValue(profile?.state) && hasValue(profile?.district) },
    { label: 'Education', complete: hasEducation },
    { label: 'Employment', complete: hasEmployment },
    { label: 'Family', complete: hasValue(profile?.familySize) || hasValue(profile?.dependents) },
    { label: 'Income', complete: hasFinancial },
    {
      label: 'Documents',
      complete: documents.some((document) => (
        document.status === 'VERIFIED'
        || document.status === 'NEEDS_CONFIRMATION'
        || document.status === 'UPLOADED'
      )),
    },
  ];
}

export function calculateProfileCompletion(sections: ProfileCompletionSection[]): number {
  if (!sections.length) return 0;
  return Math.round(sections.filter((section) => section.complete).length / sections.length * 100);
}
