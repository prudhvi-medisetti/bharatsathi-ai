import type { DashboardRecord } from './dashboard';
import type { Scheme } from '../types';

export const applicationGuidanceSteps = [
  'Open the official portal',
  'Sign in or register',
  'Select the scheme',
  'Complete the form',
  'Upload listed documents',
  'Review the application',
  'Submit on the official portal',
  'Save the acknowledgement',
] as const;

function isTelugu(language: string) {
  return language === 'te';
}

function isDocumentMarkedOnFile(schemeId: string, schemeDocument: string, records: DashboardRecord[]) {
  const expected = normalizeDocumentName(schemeDocument);
  if (!expected) return false;
  return records.some((record) => {
    if (record.schemeId !== schemeId) return false;
    const label = normalizeDocumentName(record.documentType ?? record.name ?? '');
    const status = (record.status ?? '').toLocaleLowerCase();
    return label && (label.includes(expected) || expected.includes(label))
      && ['uploaded', 'verified', 'completed'].includes(status);
  });
}

function normalizeDocumentName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function timestampValue(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function findMentionedDocument(question: string, documents: string[]) {
  const words: string[] = question.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
  const ignoredTerms = new Set<string>(['dont', 'have', 'not', 'missing', 'document', 'documents', 'certificate', 'required', 'where', 'applicable', 'details', 'proof']);
  const scores = documents.map((document) => {
    const terms: string[] = document.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
    const usefulTerms = terms.filter((term) => !ignoredTerms.has(term));
    return {
      document,
      score: usefulTerms.filter((term) => words.includes(term)).length,
    };
  }).sort((left, right) => right.score - left.score);
  return scores[0]?.score && scores[0].score > (scores[1]?.score ?? 0)
    ? scores[0].document
    : undefined;
}

function documentChecklist(scheme: Scheme, records: DashboardRecord[], telugu: boolean) {
  if (!scheme.documents.length) {
    return telugu
      ? 'మా పథక రికార్డులో ధృవీకరించిన పత్రాల జాబితా లేదు. ఏ పత్రం అవసరమో అధికారిక పోర్టల్‌లోనే నిర్ధారించండి.'
      : 'The scheme record has no verified document list. Confirm required documents on the official portal.';
  }
  return scheme.documents.map((document) => {
    const onFile = isDocumentMarkedOnFile(scheme.id, document, records);
    return `${onFile ? '[Uploaded here; portal acceptance not verified]' : '[Not marked as uploaded here]'} ${document}`;
  }).join('\n');
}

export function getApplicationStepMessage(
  scheme: Scheme,
  stepIndex: number,
  records: DashboardRecord[],
  language: string,
) {
  const telugu = isTelugu(language);
  const step = Math.min(Math.max(stepIndex, 0), applicationGuidanceSteps.length - 1);
  const header = telugu
    ? `దశ ${step + 1}/${applicationGuidanceSteps.length} — ${applicationGuidanceSteps[step]}`
    : `Step ${step + 1} of ${applicationGuidanceSteps.length} — ${applicationGuidanceSteps[step]}`;
  const content = telugu ? [
    `అధికారిక పథకం: ${scheme.name}. ఈ పోర్టల్‌ను తెరవండి: ${scheme.applicationUrl || scheme.officialUrl}\nఇది అధికారిక ప్రభుత్వ పోర్టల్‌కు తీసుకెళ్తుంది. ముందుకు వెళ్లాక అక్కడ కనిపించే సూచనలను అనుసరించండి.`,
    'అధికారిక పోర్టల్‌లోనే సైన్ ఇన్ లేదా రిజిస్టర్ చేయండి. మీ పాస్‌వర్డ్ లేదా OTPని BharatSathi చాట్‌లో పంచుకోవద్దు. పూర్తయ్యాక “తదుపరి దశ” ఎంచుకోండి.',
    `పోర్టల్‌లో ${scheme.name} కనిపిస్తే దానినే ఎంచుకోండి. పేరు లేదా ఎంపిక కనిపించకపోతే ఊహించకుండా పోర్టల్ సహాయాన్ని చూడండి. పూర్తయ్యాక “తదుపరి దశ” ఎంచుకోండి.`,
    'పోర్టల్ అడిగిన వివరాలను మీ అధికారిక పత్రాలతో సరిపోల్చి నింపండి. వ్యక్తిగత వివరాలను ఇక్కడ చాట్‌లో పంపవద్దు. ఏదైనా ఫీల్డ్ అర్థం కాకపోతే దాని లేబుల్ మాత్రమే అడగండి.',
    `ఈ పథక రికార్డులోని పత్రాల చెక్‌లిస్ట్:\n${documentChecklist(scheme, records, true)}\nఫైళ్లను అధికారిక పోర్టల్‌లోనే అప్‌లోడ్ చేయండి. BharatSathiలో ఉన్న ఫైల్‌ను పోర్టల్ స్వీకరించిందని అర్థం కాదు.`,
    `సమర్పించే ముందు మీ పేరు, వివరాలు, ఎంచుకున్న పథకం, అప్‌లోడ్ చేసిన ఫైళ్లు తనిఖీ చేయండి.\n${documentChecklist(scheme, records, true)}\nఏదైనా తప్పు ఉంటే అధికారిక పోర్టల్‌లోనే సరిచేయండి.`,
    'చివరి సమర్పణ అధికారిక ప్రభుత్వ పోర్టల్‌లోనే జరుగుతుంది. సమర్పించడానికి సిద్ధమైతే ఆ పోర్టల్‌లోని Submit బటన్‌ను మీరే నొక్కండి. BharatSathi మీ తరఫున సమర్పించదు.',
    'అధికారిక పోర్టల్ చూపించే acknowledgement/application number‌ను సురక్షితంగా భద్రపరచండి. దాన్ని ఇక్కడ చాట్‌లో పంపవద్దు. Applications పేజీలో మీరు స్వయంగా tracker/reference‌ను నమోదు చేసుకోవచ్చు; status ఆటోమేటిక్‌గా రాదు.',
  ][step] : [
    `For ${scheme.name}, open the official application portal: ${scheme.applicationUrl || scheme.officialUrl}\nThis link goes to the official portal. Follow the instructions shown there.`,
    'Sign in or register on the official portal only. Never share your password or OTP in BharatSathi chat. When finished, choose “Next step.”',
    `If the portal lists ${scheme.name}, select it. If you cannot find it, do not guess—use the portal’s help. When finished, choose “Next step.”`,
    'Fill in only the information the portal requests, matching your official documents. Do not send personal values in chat. If a field is unclear, ask using its label only.',
    `Document checklist from the scheme record:\n${documentChecklist(scheme, records, false)}\nUpload files on the official portal only. A file stored in BharatSathi is not proof the portal accepted it.`,
    `Before submitting, check your name and details, selected scheme, and uploaded files.\n${documentChecklist(scheme, records, false)}\nCorrect errors on the official portal.`,
    'Final submission happens on the official government portal. If you are ready, press its Submit button yourself. BharatSathi does not submit applications.',
    'Save the acknowledgement/application number shown by the official portal. Do not send it in chat. You can enter it yourself in My Applications; tracking there is user-managed, not automatic.',
  ][step];
  return `${header}\n\n${content}`;
}

export function getApplicationQuestionReply(
  question: string,
  scheme: Scheme,
  records: DashboardRecord[],
  language: string,
  currentStep: number,
): string | undefined {
  const text = question.toLocaleLowerCase();
  const telugu = isTelugu(language);
  const asksAboutDocuments = /\b(document|documents|upload|certificate|papers?)\b|పత్రం|పత్రాలు|సర్టిఫికెట్/.test(text);
  if (/don't have|do not have|missing|i have no|లేదు/.test(text) && asksAboutDocuments) {
    const mentionedDocument = findMentionedDocument(question, scheme.documents);
    if (mentionedDocument) {
      return telugu
        ? `ఈ పథక రికార్డులో ${mentionedDocument} ఉంది. దాన్ని ఎక్కడ పొందాలో లేదా ప్రత్యామ్నాయం ఉందో రికార్డు ధృవీకరించలేదు. అధికారిక పోర్టల్ లేదా మీ రాష్ట్ర/స్థానిక ప్రభుత్వ సేవా కేంద్రంలో నిర్ధారించండి; అధికారికంగా అంగీకరించారని నిర్ధారించకపోతే వేరే పత్రం ఇవ్వవద్దు.`
        : `The scheme record lists ${mentionedDocument}. It does not verify where to obtain it or an accepted alternative. Check the official portal or your state/local government service office; do not substitute another document unless the authority confirms it.`;
    }
    return telugu
      ? 'ఏ పత్రం లేదో దాని పేరును మాత్రమే చెప్పండి; సంఖ్యలు లేదా వ్యక్తిగత వివరాలు పంపవద్దు. ప్రత్యామ్నాయ పత్రాన్ని అధికారికంగా నిర్ధారించకపోతే ఉపయోగించవద్దు.'
      : 'Tell me only the document name you are missing—no numbers or personal details. Do not use an alternative unless the official authority confirms it.';
  }
  if (/why.*(document|certificate)|why.*required|ఎందుకు.*(పత్రం|సర్టిఫికెట్)/.test(text)) {
    return telugu
      ? 'ఈ పథక రికార్డులో ఆ పత్రం అడిగే కారణం వివరించలేదు. ఖచ్చితమైన కారణం మరియు ప్రత్యామ్నాయాలను అధికారిక పోర్టల్ లేదా పథక అధికారిని అడగండి.'
      : 'The scheme record does not explain why that document is requested. Ask the official portal or scheme authority for the exact reason and any accepted alternatives.';
  }
  if (/uploaded|upload(ed)? it|is this (correct|valid)|did it upload|i sent it|అప్‌లోడ్ చేశా|అప్‌లోడ్ చేసాను/.test(text)) {
    const schemeDocuments = records
      .filter((record) => record.schemeId === scheme.id)
      .sort((left, right) => timestampValue(right.updatedAt ?? right.uploadedAt) - timestampValue(left.updatedAt ?? left.uploadedAt));
    const latest = schemeDocuments[0];
    if (!latest) {
      return telugu
        ? 'ఈ BharatSathi ఖాతాలో ఈ పథకానికి సంబంధించిన అప్‌లోడ్ రికార్డు కనిపించడం లేదు. అధికారిక పోర్టల్‌లో అప్‌లోడ్ చేశారో అక్కడే తనిఖీ చేయండి; ఫైల్ లేదా వ్యక్తిగత వివరాలను చాట్‌లో పంపవద్దు.'
        : 'I do not see a document upload record for this scheme in your BharatSathi account. Check the official portal to confirm whether it received the file; do not send the file or personal details in chat.';
    }
    const status = (latest.status ?? '').toUpperCase();
    if (status === 'NEEDS_REUPLOAD') {
      return telugu
        ? 'మీ తాజా BharatSathi అప్‌లోడ్‌కు Needs Re-upload స్థితి ఉంది. ఎంచుకున్న పత్ర రకాన్ని మరియు ఫైల్‌ను సరిపోల్చి మళ్లీ అప్‌లోడ్ చేయండి. ఇది పత్రం అసలుదనాన్ని నిర్ధారించదు.'
        : 'Your latest BharatSathi upload is marked Needs Re-upload. Check that the selected document type matches the file, then upload the correct file. This does not determine authenticity.';
    }
    if (status === 'NEEDS_REVIEW') {
      return telugu
        ? 'మీ తాజా అప్‌లోడ్‌కు Needs Review స్థితి ఉంది. దీన్ని BharatSathi స్వయంచాలకంగా ధృవీకరించలేకపోయింది. అధికారిక పోర్టల్‌లో అంగీకారాన్ని తనిఖీ చేయండి.'
        : 'Your latest upload is marked Needs Review. BharatSathi could not automatically assess it. Check acceptance on the official portal; authenticity has not been independently verified.';
    }
    return telugu
      ? 'అప్‌లోడ్ రికార్డు BharatSathiలో ఉంది, కానీ ఇది ప్రభుత్వ పోర్టల్‌కు అప్‌లోడ్ అయిందని లేదా పత్రం అసలైనదని నిర్ధారించదు. అధికారిక పోర్టల్‌లో స్థితిని తనిఖీ చేయండి.'
      : 'The upload is recorded in BharatSathi, but this does not confirm government-portal receipt or document authenticity. Check its status on the official portal.';
  }
  if (asksAboutDocuments) {
    return telugu
      ? `ఈ పథక రికార్డులోని పత్రాలు:\n${documentChecklist(scheme, records, true)}\nఏ ఫార్మాట్ అంగీకరిస్తారో రికార్డులో ధృవీకరించలేదు. అధికారిక పోర్టల్‌లో తనిఖీ చేయండి; పత్రాలను చాట్‌లో పంపవద్దు.`
      : `Documents listed in the scheme record:\n${documentChecklist(scheme, records, false)}\nChoose the matching document field/section on the official portal; its exact label and accepted file formats are not verified here. Do not send documents in chat.`;
  }
  if (/what.*(field|enter|mean)|which information|ఇక్కడ.*(ఏమి|ఏం)|ఫీల్డ్/.test(text)) {
    return telugu
      ? 'ఆ ఫీల్డ్ లేబుల్ మాత్రమే టైప్ చేయండి; దాని విలువను లేదా వ్యక్తిగత నంబర్లను పంపవద్దు. రికార్డులో ఆ ఫీల్డ్ నిర్వచనం లేకపోతే, ఊహించకుండా అధికారిక పోర్టల్ సూచనలను అనుసరించండి.'
      : 'Share only the field label—not its value or any personal numbers. If the record does not define that field, follow the official portal instructions rather than guessing.';
  }
  if (/status|track|application number|acknowledg|స్థితి|ట్రాక్/.test(text)) {
    return telugu
      ? 'అప్లికేషన్ స్థితి ఇక్కడ ఆటోమేటిక్‌గా రావడం లేదు. My Applicationsలో మీరు స్వయంగా నమోదు చేసిన tracker మాత్రమే చూపుతుంది; అధికారిక స్థితి కోసం ప్రభుత్వ పోర్టల్‌ను చూడండి.'
      : 'Application status is not received automatically here. My Applications shows only updates you enter; check the government portal for official status.';
  }
  if (/what.*(now|next|step)|next step|guide me|help me apply|i don't understand|confused|ఇప్పుడు.*ఏమి|తర్వాత.*ఏమి|ippudu.*(em|emi)|next enti|cheyyali/.test(text)) {
    return getApplicationStepMessage(scheme, currentStep, records, language);
  }
  return undefined;
}

export function getApplicationVoiceMessage(scheme: Scheme, stepIndex: number, language: string) {
  const step = Math.min(Math.max(stepIndex, 0), applicationGuidanceSteps.length - 1);
  if (isTelugu(language)) {
    const messages = [
      `${scheme.name} అధికారిక పోర్టల్‌ను తెరవండి. దశ 1.`,
      'అధికారిక పోర్టల్‌లోనే సైన్ ఇన్ లేదా రిజిస్టర్ చేయండి. పాస్‌వర్డ్ లేదా OTPని ఇక్కడ పంచుకోవద్దు.',
      `పోర్టల్‌లో ${scheme.name} కనిపిస్తే దానిని ఎంచుకోండి.`,
      'పోర్టల్ అడిగిన వివరాలను అధికారిక పత్రాలతో సరిపోల్చి నింపండి. వివరాలను చాట్‌లో పంపవద్దు.',
      'పథక రికార్డులోని పత్రాల జాబితాను చూసి, ఫైళ్లను అధికారిక పోర్టల్‌లోనే అప్‌లోడ్ చేయండి.',
      'సమర్పించే ముందు మీ వివరాలు, పథకం, పత్రాలను తనిఖీ చేయండి.',
      'చివరి Submit అధికారిక ప్రభుత్వ పోర్టల్‌లో మీరే చేయాలి.',
      'Acknowledgement number‌ను భద్రపరచండి; ప్రభుత్వ స్థితి ఇక్కడ ఆటోమేటిక్‌గా రాదు.',
    ];
    return messages[step];
  }
  const messages = [
    `Step 1. Open the official portal for ${scheme.name}.`,
    'Sign in or register on the official portal only. Never share passwords or OTPs here.',
    `Select ${scheme.name} if it appears on the portal.`,
    'Fill portal fields using your official records. Do not send personal values in chat.',
    'Check the listed documents and upload them on the official portal only.',
    'Review your details, selected scheme and uploaded documents.',
    'Submit only on the official government portal. BharatSathi cannot submit it for you.',
    'Save the acknowledgement number. Status here is user-managed, not automatic.',
  ];
  return messages[step];
}

export function getScreenshotGuidanceReply(screenText: string, language: string) {
  const text = screenText.toLocaleLowerCase();
  const telugu = isTelugu(language);
  if (/personal details|applicant details|వ్యక్తిగత వివరాలు/.test(text)) {
    return telugu
      ? 'స్క్రీన్‌లో Personal Details కనిపిస్తోంది. అధికారిక పత్రాలతో సరిపోలే వివరాలను పోర్టల్‌లోనే నింపండి. మీ వివరాలను చాట్‌లో పంపవద్దు. పూర్తి చేసిన తర్వాత పోర్టల్‌లో Next ఉంటే దాన్ని ఎంచుకోండి.'
      : 'The screen text shows Personal Details. Fill those fields on the official portal using matching official records. Do not send the values in chat. When finished, use the portal’s Next button if shown.';
  }
  if (/document|upload|certificate|పత్రం|అప్‌లోడ్/.test(text)) {
    return telugu
      ? 'స్క్రీన్‌లో పత్రాల అప్‌లోడ్ భాగం కనిపిస్తోంది. పోర్టల్ అడిగిన పత్రాన్ని మాత్రమే ఎంచుకోండి; BharatSathi చాట్‌లో ఫైల్‌ను పంపవద్దు. ఖచ్చితమైన ఫార్మాట్ లేదా ప్రత్యామ్నాయం కనిపించకపోతే అధికారిక పోర్టల్ సూచనలను చూడండి.'
      : 'The screen text shows a document/upload section. Select only the document the portal requests; do not send the file in chat. Follow the portal for accepted formats or alternatives.';
  }
  if (/review|preview|summary|సమీక్ష|పరిశీలన/.test(text)) {
    return telugu
      ? 'స్క్రీన్‌లో సమీక్ష భాగం కనిపిస్తోంది. పేరు, వివరాలు, పథకం, పత్రాలు సరిచూసి, తప్పులు ఉంటే అధికారిక పోర్టల్‌లో సవరించండి. Submit మీరే అధికారిక పోర్టల్‌లో చేయాలి.'
      : 'The screen text shows a review/preview section. Check your details, scheme and documents; correct errors on the official portal. Submit only on that portal.';
  }
  return telugu
    ? `చిత్రం నుండి చదివిన స్క్రీన్ టెక్స్ట్: ${screenText.slice(0, 400)}. కనిపించే లేబుల్ మాత్రమే అడగండి; పాస్‌వర్డ్‌లు, OTPలు లేదా వ్యక్తిగత నంబర్లను పంపవద్దు.`
    : `Screen text read from the image: ${screenText.slice(0, 400)}. Ask about a visible label only; do not send passwords, OTPs or personal numbers.`;
}

export function isApplicationStartIntent(question: string) {
  return /\b(apply|start applying|help me apply|want to apply|application process|guide me|can you guide me|what next|what should i do now)\b|దరఖాస్తు|అప్లై|తర్వాత ఏమి చేయాలి/.test(question.toLocaleLowerCase());
}

export function isApplicationStepConfirmation(question: string) {
  return /^(done|finished|complete|completed|next|next step|continue|yes|done next|next step please|అయింది|పూర్తయింది|తదుపరి|ముందుకు)$/.test(
    question.trim().toLocaleLowerCase().replace(/[.!?]/g, ''),
  );
}

export function sanitizeScreenshotText(text: string) {
  return text.split(/\r?\n/)
    .filter((line) => !/(aadhaar|aadhar|otp|password|passcode|bank account|account number|card number|cvv|pin)/i.test(line))
    .join('\n')
    .replace(/\b\d{4,}\b/g, '[number removed]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .slice(0, 3000)
    .trim();
}
