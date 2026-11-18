export type SchemeEligibilityRules = {
  age?: { min?: number; max?: number };
  state?: string[];
  education?: string[];
  income?: { max?: number };
  employment?: string[];
  targetUsers?: string[];
  gender?: string;
  farmer?: boolean;
  businessOwner?: boolean;
  requiredDocuments?: string[];
};

export type Scheme = {
  id: string;
  name: string;
  short: string;
  category: string;
  state: 'Andhra Pradesh' | 'Central';
  benefit: string;
  eligibility: string[];
  eligibilityRules?: SchemeEligibilityRules;
  documents: string[];
  department: string;
  officialUrl: string;
  applicationUrl?: string;
  applicationSteps?: string[];
  sourceUrl: string;
  verified: string;
  tags: string[];
  eligibilityNeedsVerification?: boolean;
};
