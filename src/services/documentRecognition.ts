type RecognizedDocument =
  | 'Aadhaar Card'
  | 'Identity Proof'
  | 'Income Certificate'
  | 'Caste Certificate'
  | 'Education Certificate'
  | 'Residence Certificate'
  | 'Bank Details'
  | 'Farmer/Land Documents';

export type DocumentImageCheck = {
  status: 'match' | 'mismatch' | 'uncertain' | 'skipped';
  recognized?: RecognizedDocument;
  confidence?: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'UNASSESSED';
  riskSignals: string[];
  structureSignals: {
    titleFound: boolean;
    issuerFound: boolean;
    dateFound: boolean;
    referenceFound: boolean;
  };
};

const documentSignals: Record<RecognizedDocument, RegExp> = {
  'Aadhaar Card': /\b(?:aadhaar|aadhar|uidai|unique identification authority)\b/i,
  'Identity Proof': /\b(?:identity card|identity proof|passport|voter id|driving licence|driving license)\b/i,
  'Income Certificate': /\b(?:income certificate|annual income|income status|tehsildar|tahsildar)\b/i,
  'Caste Certificate': /\b(?:caste certificate|community certificate|scheduled caste|scheduled tribe)\b/i,
  'Education Certificate': /\b(?:bonafide|mark ?sheet|university|college|school certificate|student certificate|transcript)\b/i,
  'Residence Certificate': /\b(?:residence certificate|domicile certificate|resident of)\b/i,
  'Bank Details': /\b(?:bank passbook|bank statement|ifsc|savings account)\b/i,
  'Farmer/Land Documents': /\b(?:land record|land ownership|survey number|agricultural land|patta)\b/i,
};

const categoryAliases: Record<string, RecognizedDocument> = {
  'Aadhaar': 'Aadhaar Card',
  'Aadhaar Card': 'Aadhaar Card',
  'Aadhaar/KYC': 'Aadhaar Card',
  'Identity Proof': 'Identity Proof',
  'Income Certificate': 'Income Certificate',
  'Caste Certificate': 'Caste Certificate',
  'Education Certificate': 'Education Certificate',
  'Bonafide Certificate': 'Education Certificate',
  'Residence Certificate': 'Residence Certificate',
  'Bank Details': 'Bank Details',
  'Bank account details': 'Bank Details',
  'Bank details': 'Bank Details',
  'Farmer/Land Documents': 'Farmer/Land Documents',
  'Land records': 'Farmer/Land Documents',
  'Land/cultivation record': 'Farmer/Land Documents',
};

const emptyStructureSignals = {
  titleFound: false,
  issuerFound: false,
  dateFound: false,
  referenceFound: false,
};

const OCR_TIMEOUT_MS = 5_000;
const OCR_TIMEOUT_SIGNAL = 'OCR_TIMEOUT_AFTER_5_SECONDS';

async function recognizeWithinTimeout(file: File) {
  let timedOut = false;
  let terminateWorker: (() => Promise<unknown>) | undefined;
  let rejectTimeout: (reason: Error) => void = () => undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const recognitionPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    if (timedOut) throw new Error(OCR_TIMEOUT_SIGNAL);
    const worker = await createWorker('eng');
    let termination: Promise<unknown> | undefined;
    const terminate = () => {
      termination ??= worker.terminate();
      return termination;
    };
    terminateWorker = terminate;
    if (timedOut) {
      await terminate();
      throw new Error(OCR_TIMEOUT_SIGNAL);
    }
    try {
      return await worker.recognize(file);
    } finally {
      await terminate();
    }
  })();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    if (terminateWorker) {
      void terminateWorker().catch((error: unknown) => {
        console.error('Could not terminate the document OCR worker after its timeout:', error);
      });
    }
    rejectTimeout(new Error(OCR_TIMEOUT_SIGNAL));
  }, OCR_TIMEOUT_MS);

  try {
    return await Promise.race([recognitionPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut && terminateWorker) await terminateWorker();
  }
}

function getStructureSignals(text: string) {
  return {
    titleFound: Object.values(documentSignals).some((signal) => signal.test(text)),
    issuerFound: /\b(?:government|department|authority|issued by|district|mandal|tehsil|tahsildar|collector)\b/i.test(text),
    dateFound: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/.test(text),
    referenceFound: /\b(?:certificate|registration|reference|application|serial)\s*(?:no\.?|number|#)?\s*[:/-]?\s*[A-Z0-9/-]{4,}\b/i.test(text),
  };
}

export async function checkDocumentImage(
  file: File,
  selectedCategory: string,
): Promise<DocumentImageCheck> {
  const expected = categoryAliases[selectedCategory];
  if (!expected || !file.type.startsWith('image/')) {
    return {
      status: 'skipped',
      riskLevel: 'UNASSESSED',
      riskSignals: ['ON_DEVICE_OCR_UNAVAILABLE_FOR_FILE'],
      structureSignals: emptyStructureSignals,
    };
  }

  let data: Awaited<ReturnType<typeof recognizeWithinTimeout>>['data'];
  try {
    ({ data } = await recognizeWithinTimeout(file));
  } catch (error) {
    if (error instanceof Error && error.message === OCR_TIMEOUT_SIGNAL) {
    return {
      status: 'uncertain',
      riskLevel: 'MEDIUM',
      riskSignals: [OCR_TIMEOUT_SIGNAL],
      structureSignals: emptyStructureSignals,
    };
    }
    throw error;
  }

  const confidence = Math.round(data.confidence);
  const text = data.text.trim();
  const structureSignals = getStructureSignals(text);
  if (confidence < 35 || text.length < 8) {
    return {
    status: 'uncertain',
    confidence,
    riskLevel: 'MEDIUM',
    riskSignals: ['OCR_LOW_CONFIDENCE'],
    structureSignals,
    };
  }

  if (documentSignals[expected].test(text)) {
    return {
    status: 'match',
    confidence,
    riskLevel: 'LOW',
    riskSignals: ['EXPECTED_TYPE_TERMS_FOUND', 'OCR_MATCH_IS_NOT_AUTHENTICITY_VERIFICATION'],
    structureSignals,
    };
  }
  const recognized = (Object.entries(documentSignals) as [RecognizedDocument, RegExp][])
    .find(([category, signal]) => category !== expected && signal.test(text))?.[0];
  if (!recognized) {
    return {
      status: 'uncertain',
      confidence,
      riskLevel: 'MEDIUM',
      riskSignals: ['EXPECTED_TYPE_TERMS_NOT_FOUND'],
      structureSignals,
    };
  }
  return {
    status: 'mismatch',
    recognized,
    confidence,
    riskLevel: 'MEDIUM',
    riskSignals: ['EXPECTED_TYPE_TERMS_NOT_FOUND', 'OTHER_DOCUMENT_TYPE_TERMS_FOUND'],
    structureSignals,
  };
}
