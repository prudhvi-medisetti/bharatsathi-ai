import type { Scheme } from '../types';
import type { DashboardRecord, UserProfile } from './dashboard';

export type EligibilityFactorStatus = 'met' | 'unmet' | 'unknown' | 'uploaded';

export type EligibilityFactor = {
  label: string;
  status: EligibilityFactorStatus;
};

export type EligibilityMatch = {
  score: number | null;
  label: 'Strong Match' | 'Possible Match' | 'Needs Verification' | 'Not Matched';
  factors: EligibilityFactor[];
  missingRequirements: string[];
  hasStructuredRules: boolean;
  requiresVerification: boolean;
};

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

const documentCategoryAliases: { pattern: RegExp; categories: string[] }[] = [
  { pattern: /aadhaar|aadhar|identity|\bid\b|kyc/, categories: ['Aadhaar Card', 'Identity Proof'] },
  { pattern: /income/, categories: ['Income Certificate'] },
  { pattern: /caste|community/, categories: ['Caste Certificate'] },
  { pattern: /education|bonafide|student|mark.?sheet|school|college/, categories: ['Education Certificate', 'Bonafide Certificate'] },
  { pattern: /residen|address|domicile/, categories: ['Residence Certificate'] },
  { pattern: /bank|account|ifsc/, categories: ['Bank Details'] },
  { pattern: /land|farmer|cultivation|property|site/, categories: ['Farmer/Land Documents'] },
  { pattern: /disabil/, categories: ['Disability Certificate'] },
];

function documentMatchesRequirement(document: DashboardRecord, requirement: string): boolean {
  if (!document.storagePath || !['UPLOADED', 'VERIFIED', 'NEEDS_CONFIRMATION'].includes(document.status ?? '')) {
    return false;
  }
  const documentType = normalized(document.documentType ?? document.name);
  const required = normalized(requirement);
  if (!documentType || !required) return false;
  if (documentType.includes(required) || required.includes(documentType)) return true;

  const aliases = documentCategoryAliases.find(({ pattern }) => pattern.test(required));
  return aliases?.categories.some((category) => documentType === normalized(category)) ?? false;
}

export function getDocumentReadiness(
  requirement: string,
  documents: DashboardRecord[],
): 'uploaded' | 'missing' {
  return documents.some((document) => documentMatchesRequirement(document, requirement))
    ? 'uploaded'
    : 'missing';
}

function profileAge(profile: UserProfile): number | null {
  if (typeof profile.age === 'number' && Number.isFinite(profile.age)) return profile.age;
  if (typeof profile.age === 'string' && /^\d+$/.test(profile.age.trim())) return Number(profile.age);
  if (typeof profile.dateOfBirth === 'string') {
    const birthDate = new Date(profile.dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    return today.getFullYear() - birthDate.getFullYear()
      - (today < new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate()) ? 1 : 0);
  }
  const ageGroup = normalized(profile.ageGroup).match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
  return ageGroup ? Number(ageGroup[1]) : null;
}

export function evaluateSchemeEligibility(
  scheme: Scheme,
  profile: UserProfile | null | undefined,
  _documents: DashboardRecord[],
): EligibilityMatch {
  const rules = scheme.eligibilityRules;
  if (!rules) return {
    score: null,
    label: 'Needs Verification',
    factors: [],
    missingRequirements: [],
    hasStructuredRules: false,
    requiresVerification: true,
  };

  const citizen = profile ?? {};
  const factors: EligibilityFactor[] = [];
  const addRangeFactor = (label: string, value: number | null, min?: number, max?: number) => {
    if (min === undefined && max === undefined) return;
    factors.push({
      label,
      status: value === null ? 'unknown' : (min === undefined || value >= min) && (max === undefined || value <= max) ? 'met' : 'unmet',
    });
  };
  const age = profileAge(citizen);
  addRangeFactor('Age requirement', age, rules.age?.min, rules.age?.max);

  if (rules.state?.length) {
    const state = normalized(citizen.state);
    factors.push({
      label: 'State requirement',
      status: state ? (rules.state.some((item) => normalized(item) === state) ? 'met' : 'unmet') : 'unknown',
    });
  }

  const educationRules = rules.education;
  if (educationRules?.length) {
    const education = normalized(citizen.educationLevel ?? citizen.education);
    factors.push({
      label: 'Education requirement',
      status: education ? (educationRules.some((item) => education.includes(normalized(item))) ? 'met' : 'unmet') : 'unknown',
    });
  }

  if (rules.income?.max !== undefined) {
    const rawIncome = citizen.annualIncome;
    const income = typeof rawIncome === 'number' ? rawIncome
      : typeof rawIncome === 'string' && rawIncome.trim() ? Number(rawIncome) : Number.NaN;
    factors.push({
      label: 'Income requirement',
      status: Number.isFinite(income) ? (income <= rules.income.max ? 'met' : 'unmet') : 'unknown',
    });
  }

  if (rules.employment?.length) {
    const employment = normalized(citizen.employmentStatus ?? citizen.occupation);
    factors.push({
      label: 'Employment requirement',
      status: employment
        ? (rules.employment.some((item) => employment.includes(normalized(item))) ? 'met' : 'unmet')
        : 'unknown',
    });
  }

  if (rules.targetUsers?.length) {
    const userType = normalized(citizen.userType ?? citizen.occupation);
    factors.push({
      label: 'User type requirement',
      status: userType
        ? (rules.targetUsers.some((item) => normalized(item) === userType) ? 'met' : 'unmet')
        : 'unknown',
    });
  }

  if (rules.gender && normalized(rules.gender) !== 'any') {
    const gender = normalized(citizen.gender);
    factors.push({
      label: 'Gender requirement',
      status: gender
        ? (gender === normalized(rules.gender) ? 'met' : 'unmet')
        : 'unknown',
    });
  }

  if (rules.farmer !== undefined) {
    factors.push({
      label: 'Farmer requirement',
      status: typeof citizen.isFarmer === 'boolean'
        ? (citizen.isFarmer === rules.farmer ? 'met' : 'unmet')
        : 'unknown',
    });
  }

  if (rules.businessOwner !== undefined) {
    factors.push({
      label: 'Business ownership requirement',
      status: typeof citizen.ownsBusiness === 'boolean'
        ? (citizen.ownsBusiness === rules.businessOwner ? 'met' : 'unmet')
        : 'unknown',
    });
  }

  const assessed = factors.filter((factor) => factor.status === 'met' || factor.status === 'unmet');
  const metCount = assessed.filter((factor) => factor.status === 'met').length;
  const hasUnknown = factors.some((factor) => factor.status === 'unknown');
  const missingRequirements = factors.filter((factor) => factor.status === 'unmet').map((factor) => factor.label);
  if (scheme.eligibilityNeedsVerification) {
    return { score: null, label: 'Needs Verification', factors, missingRequirements, hasStructuredRules: true, requiresVerification: true };
  }
  const label = missingRequirements.length
    ? 'Not Matched'
    : !factors.length
      ? 'Needs Verification'
      : hasUnknown || !assessed.length
      ? 'Possible Match'
      : 'Strong Match';
  return {
    score: assessed.length ? Math.round(metCount / assessed.length * 100) : null,
    label,
    factors,
    missingRequirements,
    hasStructuredRules: true,
    requiresVerification: hasUnknown || !factors.length,
  };
}
