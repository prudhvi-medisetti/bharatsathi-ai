import type { Scheme } from '../types';
import type { UserProfile } from './dashboard';
import { evaluateSchemeEligibility } from './eligibility';

export const schemeCategories = [
  'Education',
  'Employment',
  'Healthcare',
  'Housing',
  'Agriculture',
  'Women & Family',
  'Business / Entrepreneurship',
  'Social Security',
  'Disability Support',
  'Senior Citizens',
  'Other',
] as const;

export function canonicalSchemeCategory(category: string): (typeof schemeCategories)[number] {
  const value = category.trim().toLocaleLowerCase();
  if (value === 'education') return 'Education';
  if (/employment|skill|job/.test(value)) return 'Employment';
  if (/health|medical/.test(value)) return 'Healthcare';
  if (/housing|home/.test(value)) return 'Housing';
  if (/agriculture|farmer/.test(value)) return 'Agriculture';
  if (/women|family|maternity/.test(value)) return 'Women & Family';
  if (/business|entrepreneur|startup/.test(value)) return 'Business / Entrepreneurship';
  if (/finance|social welfare|social security/.test(value)) return 'Social Security';
  if (/disability/.test(value)) return 'Disability Support';
  if (/senior|elder/.test(value)) return 'Senior Citizens';
  return 'Other';
}

export type SchemeRecommendation = {
  scheme: Scheme;
  status: 'Strong Match' | 'Possible Match' | 'Needs Verification' | 'Not Matched';
};

function preferredCategories(profile: UserProfile | null | undefined): string[] {
  const identity = [
    profile?.userType,
    profile?.occupation,
    profile?.employmentStatus,
  ].filter((value): value is string => typeof value === 'string').join(' ').toLocaleLowerCase();

  if (profile?.disabilityStatus || /disability/.test(identity)) return ['Disability Support'];
  if (profile?.isFarmer === true || /\bfarmer\b/.test(identity)) return ['Agriculture'];
  if (/\bstudent\b/.test(identity)) return ['Education'];
  if (/job.?seek|unemploy/.test(identity)) return ['Employment'];
  if (profile?.ownsBusiness === true || /business owner|entrepreneur/.test(identity)) {
    return ['Business / Entrepreneurship'];
  }
  if (profile?.gender?.toLocaleLowerCase() === 'female' || /women|family/.test(identity)) {
    return ['Women & Family'];
  }
  return ['Social Security', 'Healthcare', 'Housing'];
}

function profileTerms(profile: UserProfile | null | undefined): string[] {
  return Object.values(profile ?? {})
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function getSchemeRecommendations(
  schemes: Scheme[],
  profile: UserProfile | null | undefined,
): SchemeRecommendation[] {
  const priorities = preferredCategories(profile);
  const terms = profileTerms(profile);

  return schemes.map((scheme) => {
    const category = canonicalSchemeCategory(scheme.category);
    const eligibility = evaluateSchemeEligibility(scheme, profile, []);
    const hasUnmet = eligibility.factors.some((factor) => factor.status === 'unmet');
    const categoryRank = priorities.indexOf(category);
    const termMatches = scheme.tags.some((tag) => terms.some((term) => (
      term.length > 2 && (term.includes(tag.toLocaleLowerCase()) || tag.toLocaleLowerCase().includes(term))
    )));
    const status: SchemeRecommendation['status'] = eligibility.label;

    return {
      scheme,
      status,
      rank: (categoryRank === -1 ? priorities.length : categoryRank) * 100
        + (termMatches ? -10 : 0)
        + (status === 'Strong Match' ? -2 : status === 'Needs Verification' ? 1 : 0),
      relevant: categoryRank !== -1 || termMatches,
      hasUnmet,
    };
  })
    .filter((item) => item.relevant && !item.hasUnmet)
    .sort((left, right) => left.rank - right.rank || left.scheme.name.localeCompare(right.scheme.name))
    .slice(0, 12)
    .map(({ scheme, status }) => ({ scheme, status }));
}
