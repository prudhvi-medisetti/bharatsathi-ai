import type { DashboardRecord, UserProfile } from './dashboard';
import type { Scheme } from '../types';
import { evaluateSchemeEligibility } from './eligibility';

export type AssistantContext = {
  path: string;
  profile: UserProfile | null | undefined;
  documents: DashboardRecord[];
  applications: DashboardRecord[];
  schemes: Scheme[];
  activeScheme?: Scheme;
  previousSchemeId?: string;
  language: string;
};

export type AssistantReply = {
  text: string;
  schemeId?: string;
};

const welcomeMessages: Record<string, string> = {
  en: 'Welcome to BharatSathi. I can help you find government schemes and understand possible eligibility. What would you like help with?',
  te: 'భారత్‌సాథికి స్వాగతం. ప్రభుత్వ పథకాలను కనుగొనడంలో, మీకు ఉండే అర్హతను అర్థం చేసుకోవడంలో నేను సహాయపడతాను. మీకు ఏ సహాయం కావాలి?',
  hi: 'भारतसाथी में आपका स्वागत है। मैं सरकारी योजनाएँ खोजने और संभावित पात्रता समझने में मदद कर सकता हूँ। आपको किस बारे में सहायता चाहिए?',
  ta: 'பாரத்சாத்திக்கு வரவேற்கிறோம். அரசுத் திட்டங்களைக் கண்டறியவும், சாத்தியமான தகுதியைப் புரிந்துகொள்ளவும் நான் உதவுவேன். உங்களுக்கு என்ன உதவி வேண்டும்?',
  bn: 'ভারতসাথীতে স্বাগতম। সরকারি প্রকল্প খুঁজে পেতে এবং সম্ভাব্য যোগ্যতা বুঝতে আমি সাহায্য করতে পারি। কীভাবে সাহায্য করতে পারি?',
  gu: 'ભારતસાથીમાં આપનું સ્વાગત છે. સરકારી યોજનાઓ શોધવા અને સંભવિત પાત્રતા સમજવામાં હું મદદ કરી શકું છું. તમને શેમાં મદદ જોઈએ છે?',
  mr: 'भारतसाथीमध्ये आपले स्वागत आहे. सरकारी योजना शोधण्यात आणि संभाव्य पात्रता समजून घेण्यात मी मदत करू शकतो. तुम्हाला कशासाठी मदत हवी आहे?',
  pa: 'ਭਾਰਤਸਾਥੀ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ। ਮੈਂ ਸਰਕਾਰੀ ਯੋਜਨਾਵਾਂ ਲੱਭਣ ਅਤੇ ਸੰਭਾਵੀ ਯੋਗਤਾ ਸਮਝਣ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ। ਤੁਹਾਨੂੰ ਕਿਸ ਬਾਰੇ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?',
  ur: 'بھارت ساتھی میں خوش آمدید۔ میں سرکاری اسکیمیں تلاش کرنے اور ممکنہ اہلیت سمجھنے میں مدد کر سکتا ہوں۔ آپ کو کس بارے میں مدد چاہیے؟',
  kn: 'ಭಾರತಸಾಥಿಗೆ ಸ್ವಾಗತ. ಸರ್ಕಾರಿ ಯೋಜನೆಗಳನ್ನು ಹುಡುಕಲು ಮತ್ತು ಸಂಭಾವ್ಯ ಅರ್ಹತೆಯನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ನಾನು ಸಹಾಯ ಮಾಡಬಹುದು. ನಿಮಗೆ ಯಾವ ಸಹಾಯ ಬೇಕು?',
  ml: 'ഭാരത്‌സാഥിയിലേക്ക് സ്വാഗതം. സർക്കാർ പദ്ധതികൾ കണ്ടെത്താനും സാധ്യതയുള്ള അർഹത മനസ്സിലാക്കാനും ഞാൻ സഹായിക്കാം. എന്ത് സഹായമാണ് വേണ്ടത്?',
};

export function getAssistantWelcome(language: string): string {
  return welcomeMessages[language] ?? welcomeMessages.en;
}

const responseText: Record<string, {
  notFound: string;
  found: (names: string) => string;
  eligibility: (name: string, score: number, missing: string) => string;
  noRules: (name: string) => string;
  documents: (items: string) => string;
  profile: (missing: string) => string;
}> = {
  en: {
    notFound: 'I could not verify a specific scheme from the available records. Try asking about education, farming, work, health, housing or business. Scheme information is preliminary; the relevant government authority makes final decisions.',
    found: (names) => `Potentially relevant verified scheme records: ${names}. Check the official links for current requirements. Final eligibility and approval are decided by the government authority.`,
    eligibility: (name, score, missing) => `Eligibility Match for ${name}: ${score}%. ${missing ? `Requirements not met or not on file: ${missing}. ` : ''}This is a structured preliminary match, not an approval. The responsible government authority decides final eligibility.`,
    noRules: (name) => `${name} does not have structured eligibility rules in our catalogue, so I cannot calculate an Eligibility Match. Please review its official scheme source.`,
    documents: (items) => `The scheme lists these documents: ${items}. Check its official source because requirements can vary and change. Do not share document numbers or images in chat.`,
    profile: (missing) => missing ? `Your profile may need these details for more relevant guidance: ${missing}. You can review them in Profile settings.` : 'Your profile has the core details used for scheme guidance. You can review or update them in Profile settings.',
  },
  te: {
    notFound: 'అందుబాటులో ఉన్న వివరాల్లో నిర్దిష్ట పథకాన్ని ధృవీకరించలేకపోయాను. విద్య, వ్యవసాయం, ఉపాధి, ఆరోగ్యం, గృహం లేదా వ్యాపారం గురించి అడగండి. ఇది ప్రాథమిక సమాచారం; తుది నిర్ణయం సంబంధిత ప్రభుత్వ శాఖదే.',
    found: (names) => `సంబంధితంగా కనిపించిన ధృవీకరించిన పథకాలు: ${names}. తాజా నిబంధనల కోసం అధికారిక లింకులను చూడండి. తుది అర్హత, ఆమోదం ప్రభుత్వ శాఖదే.`,
    eligibility: (name, score, missing) => `${name} కోసం అర్హత సరిపోలిక: ${score}%. ${missing ? `నెరవేరని లేదా నమోదు కాని అంశాలు: ${missing}. ` : ''}ఇది ప్రాథమిక సరిపోలిక మాత్రమే, ఆమోదం కాదు. తుది అర్హతను ప్రభుత్వ శాఖ నిర్ణయిస్తుంది.`,
    noRules: (name) => `${name} కోసం నిర్మిత అర్హత నియమాలు అందుబాటులో లేవు, కాబట్టి అర్హత సరిపోలికను లెక్కించలేను. అధికారిక పథక సమాచారాన్ని చూడండి.`,
    documents: (items) => `ఈ పథకానికి సూచించిన పత్రాలు: ${items}. నిబంధనలు మారవచ్చు కాబట్టి అధికారిక మూలాన్ని చూడండి. చాట్‌లో పత్రాల నంబర్లు లేదా చిత్రాలు పంచుకోవద్దు.`,
    profile: (missing) => missing ? `మరింత సరైన మార్గదర్శకత్వం కోసం ఈ వివరాలు అవసరం కావచ్చు: ${missing}. ప్రొఫైల్‌లో వాటిని చూడండి.` : 'పథకాల మార్గదర్శకత్వానికి అవసరమైన ప్రధాన వివరాలు మీ ప్రొఫైల్‌లో ఉన్నాయి. ప్రొఫైల్‌లో మార్చవచ్చు.',
  },
  hi: {
    notFound: 'उपलब्ध रिकॉर्ड से किसी विशेष योजना की पुष्टि नहीं कर सका। शिक्षा, खेती, रोजगार, स्वास्थ्य, आवास या व्यवसाय के बारे में पूछें। यह शुरुआती जानकारी है; अंतिम निर्णय संबंधित सरकारी विभाग का है।',
    found: (names) => `संभावित रूप से संबंधित सत्यापित योजना रिकॉर्ड: ${names}। मौजूदा शर्तों के लिए आधिकारिक लिंक देखें। अंतिम पात्रता और स्वीकृति सरकारी विभाग तय करता है।`,
    eligibility: (name, score, missing) => `${name} के लिए पात्रता मिलान: ${score}%. ${missing ? `अधूरी या उपलब्ध न होने वाली शर्तें: ${missing}। ` : ''}यह प्रारंभिक मिलान है, स्वीकृति नहीं। अंतिम पात्रता संबंधित सरकारी विभाग तय करता है।`,
    noRules: (name) => `${name} के लिए संरचित पात्रता नियम उपलब्ध नहीं हैं, इसलिए पात्रता मिलान नहीं निकाला जा सकता। कृपया आधिकारिक योजना स्रोत देखें।`,
    documents: (items) => `योजना में ये दस्तावेज़ बताए गए हैं: ${items}। शर्तें बदल सकती हैं, इसलिए आधिकारिक स्रोत देखें। चैट में दस्तावेज़ संख्या या तस्वीरें साझा न करें।`,
    profile: (missing) => missing ? `अधिक उपयोगी जानकारी के लिए ये विवरण चाहिए हो सकते हैं: ${missing}। इन्हें प्रोफ़ाइल में देखें।` : 'योजना मार्गदर्शन के लिए आपकी प्रोफ़ाइल में मुख्य विवरण मौजूद हैं। आप प्रोफ़ाइल में उन्हें बदल सकते हैं।',
  },
  ta: {
    notFound: 'கிடைக்கும் பதிவுகளில் குறிப்பிட்ட திட்டத்தை உறுதிப்படுத்த முடியவில்லை. கல்வி, விவசாயம், வேலை, மருத்துவம், வீடு அல்லது வணிகம் பற்றி கேளுங்கள். இது ஆரம்ப வழிகாட்டுதல்; இறுதி முடிவு அரசு துறையினுடையது.',
    found: (names) => `தொடர்புடைய சரிபார்க்கப்பட்ட திட்டங்கள்: ${names}. தற்போதைய விதிகளுக்கு அதிகாரப்பூர்வ இணைப்புகளைப் பார்க்கவும். இறுதி தகுதியையும் ஒப்புதலையும் அரசு துறை தீர்மானிக்கும்.`,
    eligibility: (name, score, missing) => `${name} தகுதி பொருத்தம்: ${score}%. ${missing ? `நிறைவேறாத அல்லது பதிவில் இல்லாதவை: ${missing}. ` : ''}இது ஆரம்ப மதிப்பீடு; ஒப்புதல் அல்ல. இறுதி தகுதியை அரசு துறை தீர்மானிக்கும்.`,
    noRules: (name) => `${name} திட்டத்திற்கு கட்டமைக்கப்பட்ட தகுதி விதிகள் இல்லை; எனவே தகுதி பொருத்தத்தை கணக்கிட முடியாது. அதிகாரப்பூர்வ திட்டத் தகவலைப் பார்க்கவும்.`,
    documents: (items) => `இந்தத் திட்டத்தில் குறிப்பிடப்பட்ட ஆவணங்கள்: ${items}. தேவைகள் மாறக்கூடும்; அதிகாரப்பூர்வ தளத்தைப் பார்க்கவும். ஆவண எண்களையோ படங்களையோ அரட்டையில் பகிர வேண்டாம்.`,
    profile: (missing) => missing ? `மேலும் பொருத்தமான வழிகாட்டுதலுக்கு இந்த விவரங்கள் தேவைப்படலாம்: ${missing}. சுயவிவரத்தில் பார்க்கவும்.` : 'திட்ட வழிகாட்டுதலுக்குத் தேவையான முக்கிய விவரங்கள் உங்கள் சுயவிவரத்தில் உள்ளன.',
  },
  bn: {
    notFound: 'উপলব্ধ তথ্য থেকে নির্দিষ্ট কোনো প্রকল্প যাচাই করতে পারিনি। শিক্ষা, কৃষি, কাজ, স্বাস্থ্য, বাসস্থান বা ব্যবসা সম্পর্কে জিজ্ঞাসা করুন। এটি প্রাথমিক তথ্য; চূড়ান্ত সিদ্ধান্ত সংশ্লিষ্ট সরকারি কর্তৃপক্ষের।',
    found: (names) => `সম্ভাব্য প্রাসঙ্গিক যাচাইকৃত প্রকল্প: ${names}। বর্তমান নিয়মের জন্য সরকারি লিঙ্ক দেখুন। চূড়ান্ত যোগ্যতা ও অনুমোদন সরকারি কর্তৃপক্ষ নির্ধারণ করে।`,
    eligibility: (name, score, missing) => `${name}-এর যোগ্যতার মিল: ${score}%. ${missing ? `অপূর্ণ বা নথিভুক্ত নয়: ${missing}। ` : ''}এটি প্রাথমিক মিল, অনুমোদন নয়। চূড়ান্ত যোগ্যতা সরকারি কর্তৃপক্ষ নির্ধারণ করে।`,
    noRules: (name) => `${name}-এর কাঠামোবদ্ধ যোগ্যতার নিয়ম নেই, তাই যোগ্যতার মিল গণনা করতে পারছি না। সরকারি প্রকল্পের উৎস দেখুন।`,
    documents: (items) => `প্রকল্পে উল্লেখিত নথি: ${items}। নিয়ম বদলাতে পারে, তাই সরকারি উৎস দেখুন। চ্যাটে নথির নম্বর বা ছবি শেয়ার করবেন না।`,
    profile: (missing) => missing ? `আরও প্রাসঙ্গিক নির্দেশনার জন্য এই তথ্যগুলি লাগতে পারে: ${missing}। প্রোফাইলে দেখুন।` : 'প্রকল্প-সংক্রান্ত নির্দেশনার জন্য প্রয়োজনীয় মূল তথ্য আপনার প্রোফাইলে রয়েছে।',
  },
  gu: {
    notFound: 'ઉપલબ્ધ નોંધોમાંથી કોઈ ચોક્કસ યોજનાની પુષ્ટિ કરી શક્યો નથી. શિક્ષણ, ખેતી, રોજગાર, આરોગ્ય, આવાસ અથવા વ્યવસાય વિશે પૂછો. આ પ્રાથમિક માર્ગદર્શન છે; અંતિમ નિર્ણય સરકારી વિભાગ લે છે.',
    found: (names) => `સંભવિત સંબંધિત ચકાસાયેલ યોજનાઓ: ${names}. હાલની શરતો માટે સત્તાવાર લિંક્સ તપાસો. અંતિમ પાત્રતા અને મંજૂરી સરકારી વિભાગ નક્કી કરે છે.`,
    eligibility: (name, score, missing) => `${name} માટે પાત્રતા મેળ: ${score}%. ${missing ? `અપૂર્ણ અથવા ઉપલબ્ધ ન હોય તેવી શરતો: ${missing}. ` : ''}આ પ્રાથમિક મેળ છે, મંજૂરી નથી. અંતિમ પાત્રતા સરકારી વિભાગ નક્કી કરે છે.`,
    noRules: (name) => `${name} માટે રચનાત્મક પાત્રતા નિયમો ઉપલબ્ધ નથી, તેથી પાત્રતા મેળ ગણાવી શકાતો નથી. સત્તાવાર યોજના સ્ત્રોત તપાસો.`,
    documents: (items) => `યોજનામાં આ દસ્તાવેજો જણાવ્યા છે: ${items}. જરૂરિયાતો બદલાઈ શકે છે; સત્તાવાર સ્ત્રોત તપાસો. ચેટમાં દસ્તાવેજ નંબર અથવા છબીઓ શેર ન કરો.`,
    profile: (missing) => missing ? `વધુ ઉપયોગી માર્ગદર્શન માટે આ વિગતો જરૂરી હોઈ શકે છે: ${missing}. પ્રોફાઇલમાં તપાસો.` : 'યોજના માર્ગદર્શન માટે જરૂરી મુખ્ય વિગતો તમારી પ્રોફાઇલમાં છે.',
  },
  mr: {
    notFound: 'उपलब्ध नोंदींमधून विशिष्ट योजना पडताळता आली नाही. शिक्षण, शेती, रोजगार, आरोग्य, घर किंवा व्यवसायाबद्दल विचारा. ही प्राथमिक माहिती आहे; अंतिम निर्णय संबंधित सरकारी विभागाचा आहे.',
    found: (names) => `संभाव्य संबंधित पडताळलेल्या योजना: ${names}. सध्याच्या नियमांसाठी अधिकृत दुवे तपासा. अंतिम पात्रता आणि मंजुरी सरकारी विभाग ठरवतो.`,
    eligibility: (name, score, missing) => `${name} साठी पात्रता जुळणी: ${score}%. ${missing ? `अपूर्ण किंवा नोंदीत नसलेल्या अटी: ${missing}. ` : ''}ही प्राथमिक जुळणी आहे, मंजुरी नाही. अंतिम पात्रता सरकारी विभाग ठरवतो.`,
    noRules: (name) => `${name} साठी संरचित पात्रता नियम उपलब्ध नाहीत, त्यामुळे पात्रता जुळणी मोजता येत नाही. अधिकृत योजना स्रोत तपासा.`,
    documents: (items) => `योजनेत हे दस्तऐवज नमूद आहेत: ${items}. आवश्यकता बदलू शकतात; अधिकृत स्रोत तपासा. चॅटमध्ये दस्तऐवज क्रमांक किंवा प्रतिमा शेअर करू नका.`,
    profile: (missing) => missing ? `अधिक उपयुक्त मार्गदर्शनासाठी ही माहिती आवश्यक असू शकते: ${missing}. प्रोफाइलमध्ये तपासा.` : 'योजना मार्गदर्शनासाठी आवश्यक मुख्य माहिती तुमच्या प्रोफाइलमध्ये आहे.',
  },
  pa: {
    notFound: 'ਮੌਜੂਦਾ ਰਿਕਾਰਡਾਂ ਤੋਂ ਕਿਸੇ ਖਾਸ ਯੋਜਨਾ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋਈ। ਸਿੱਖਿਆ, ਖੇਤੀਬਾੜੀ, ਰੋਜ਼ਗਾਰ, ਸਿਹਤ, ਘਰ ਜਾਂ ਕਾਰੋਬਾਰ ਬਾਰੇ ਪੁੱਛੋ। ਇਹ ਸ਼ੁਰੂਆਤੀ ਜਾਣਕਾਰੀ ਹੈ; ਅੰਤਿਮ ਫੈਸਲਾ ਸਰਕਾਰੀ ਵਿਭਾਗ ਦਾ ਹੈ।',
    found: (names) => `ਸੰਭਾਵੀ ਤੌਰ 'ਤੇ ਸੰਬੰਧਿਤ ਪ੍ਰਮਾਣਿਤ ਯੋਜਨਾਵਾਂ: ${names}। ਮੌਜੂਦਾ ਨਿਯਮਾਂ ਲਈ ਸਰਕਾਰੀ ਲਿੰਕ ਵੇਖੋ। ਅੰਤਿਮ ਯੋਗਤਾ ਅਤੇ ਮਨਜ਼ੂਰੀ ਸਰਕਾਰੀ ਵਿਭਾਗ ਤੈਅ ਕਰਦਾ ਹੈ।`,
    eligibility: (name, score, missing) => `${name} ਲਈ ਯੋਗਤਾ ਮੇਲ: ${score}%. ${missing ? `ਅਧੂਰੀਆਂ ਜਾਂ ਰਿਕਾਰਡ ਵਿੱਚ ਨਾ ਹੋਣ ਵਾਲੀਆਂ ਸ਼ਰਤਾਂ: ${missing}। ` : ''}ਇਹ ਸ਼ੁਰੂਆਤੀ ਮੇਲ ਹੈ, ਮਨਜ਼ੂਰੀ ਨਹੀਂ। ਅੰਤਿਮ ਯੋਗਤਾ ਸਰਕਾਰੀ ਵਿਭਾਗ ਤੈਅ ਕਰਦਾ ਹੈ।`,
    noRules: (name) => `${name} ਲਈ ਢਾਂਚਾਗਤ ਯੋਗਤਾ ਨਿਯਮ ਨਹੀਂ ਹਨ, ਇਸ ਲਈ ਯੋਗਤਾ ਮੇਲ ਨਹੀਂ ਕੱਢਿਆ ਜਾ ਸਕਦਾ। ਸਰਕਾਰੀ ਸਰੋਤ ਵੇਖੋ।`,
    documents: (items) => `ਯੋਜਨਾ ਵਿੱਚ ਇਹ ਦਸਤਾਵੇਜ਼ ਦਿੱਤੇ ਹਨ: ${items}। ਲੋੜਾਂ ਬਦਲ ਸਕਦੀਆਂ ਹਨ; ਸਰਕਾਰੀ ਸਰੋਤ ਵੇਖੋ। ਚੈਟ ਵਿੱਚ ਦਸਤਾਵੇਜ਼ ਨੰਬਰ ਜਾਂ ਤਸਵੀਰਾਂ ਸਾਂਝੀਆਂ ਨਾ ਕਰੋ।`,
    profile: (missing) => missing ? `ਵਧੇਰੇ ਲਾਭਦਾਇਕ ਜਾਣਕਾਰੀ ਲਈ ਇਹ ਵੇਰਵੇ ਲੋੜੀਂਦੇ ਹੋ ਸਕਦੇ ਹਨ: ${missing}। ਪ੍ਰੋਫਾਈਲ ਵਿੱਚ ਵੇਖੋ।` : 'ਯੋਜਨਾ ਮਾਰਗਦਰਸ਼ਨ ਲਈ ਮੁੱਖ ਵੇਰਵੇ ਤੁਹਾਡੀ ਪ੍ਰੋਫਾਈਲ ਵਿੱਚ ਹਨ।',
  },
  ur: {
    notFound: 'دستیاب ریکارڈ سے کسی مخصوص اسکیم کی تصدیق نہیں ہو سکی۔ تعلیم، زراعت، روزگار، صحت، رہائش یا کاروبار کے بارے میں پوچھیں۔ یہ ابتدائی رہنمائی ہے؛ حتمی فیصلہ متعلقہ سرکاری ادارہ کرتا ہے۔',
    found: (names) => `ممکنہ طور پر متعلقہ تصدیق شدہ اسکیمیں: ${names}۔ موجودہ شرائط کے لیے سرکاری روابط دیکھیں۔ حتمی اہلیت اور منظوری سرکاری ادارہ طے کرتا ہے۔`,
    eligibility: (name, score, missing) => `${name} کے لیے اہلیت کا میل: ${score}٪۔ ${missing ? `نامکمل یا ریکارڈ میں موجود نہ ہونے والی شرائط: ${missing}۔ ` : ''}یہ ابتدائی میل ہے، منظوری نہیں۔ حتمی اہلیت سرکاری ادارہ طے کرتا ہے۔`,
    noRules: (name) => `${name} کے لیے منظم اہلیتی قواعد دستیاب نہیں، اس لیے اہلیت کا میل نہیں نکالا جا سکتا۔ سرکاری اسکیم کا ماخذ دیکھیں۔`,
    documents: (items) => `اسکیم میں درج دستاویزات: ${items}۔ تقاضے بدل سکتے ہیں، اس لیے سرکاری ماخذ دیکھیں۔ چیٹ میں دستاویز نمبر یا تصاویر شیئر نہ کریں۔`,
    profile: (missing) => missing ? `زیادہ متعلقہ رہنمائی کے لیے یہ معلومات درکار ہو سکتی ہیں: ${missing}۔ پروفائل میں دیکھیں۔` : 'اسکیم رہنمائی کے لیے بنیادی معلومات آپ کے پروفائل میں موجود ہیں۔',
  },
  kn: {
    notFound: 'ಲಭ್ಯವಿರುವ ದಾಖಲೆಗಳಿಂದ ನಿರ್ದಿಷ್ಟ ಯೋಜನೆಯನ್ನು ದೃಢೀಕರಿಸಲಾಗಲಿಲ್ಲ. ಶಿಕ್ಷಣ, ಕೃಷಿ, ಉದ್ಯೋಗ, ಆರೋಗ್ಯ, ವಸತಿ ಅಥವಾ ವ್ಯವಹಾರದ ಬಗ್ಗೆ ಕೇಳಿ. ಇದು ಪ್ರಾಥಮಿಕ ಮಾಹಿತಿ; ಅಂತಿಮ ನಿರ್ಧಾರ ಸರ್ಕಾರದ ಇಲಾಖೆಯದು.',
    found: (names) => `ಸಂಬಂಧಿತ ಪರಿಶೀಲಿತ ಯೋಜನೆಗಳು: ${names}. ಪ್ರಸ್ತುತ ನಿಯಮಗಳಿಗಾಗಿ ಅಧಿಕೃತ ಕೊಂಡಿಗಳನ್ನು ಪರಿಶೀಲಿಸಿ. ಅಂತಿಮ ಅರ್ಹತೆ ಮತ್ತು ಅನುಮೋದನೆಯನ್ನು ಸರ್ಕಾರಿ ಇಲಾಖೆ ನಿರ್ಧರಿಸುತ್ತದೆ.`,
    eligibility: (name, score, missing) => `${name} ಅರ್ಹತಾ ಹೊಂದಾಣಿಕೆ: ${score}%. ${missing ? `ಪೂರ್ಣವಾಗದ ಅಥವಾ ದಾಖಲೆಗಳಲ್ಲಿ ಇಲ್ಲದ ಅಂಶಗಳು: ${missing}. ` : ''}ಇದು ಪ್ರಾಥಮಿಕ ಹೊಂದಾಣಿಕೆ, ಅನುಮೋದನೆಯಲ್ಲ. ಅಂತಿಮ ಅರ್ಹತೆಯನ್ನು ಸರ್ಕಾರಿ ಇಲಾಖೆ ನಿರ್ಧರಿಸುತ್ತದೆ.`,
    noRules: (name) => `${name}ಗೆ ರಚನಾತ್ಮಕ ಅರ್ಹತಾ ನಿಯಮಗಳಿಲ್ಲ; ಆದ್ದರಿಂದ ಅರ್ಹತಾ ಹೊಂದಾಣಿಕೆಯನ್ನು ಲೆಕ್ಕಿಸಲಾಗುವುದಿಲ್ಲ. ಅಧಿಕೃತ ಮೂಲವನ್ನು ನೋಡಿ.`,
    documents: (items) => `ಯೋಜನೆಯಲ್ಲಿ ಸೂಚಿಸಿರುವ ದಾಖಲೆಗಳು: ${items}. ಅಗತ್ಯಗಳು ಬದಲಾಗಬಹುದು; ಅಧಿಕೃತ ಮೂಲವನ್ನು ಪರಿಶೀಲಿಸಿ. ಚಾಟ್‌ನಲ್ಲಿ ದಾಖಲೆ ಸಂಖ್ಯೆಗಳು ಅಥವಾ ಚಿತ್ರಗಳನ್ನು ಹಂಚಬೇಡಿ.`,
    profile: (missing) => missing ? `ಹೆಚ್ಚು ಸೂಕ್ತ ಮಾರ್ಗದರ್ಶನಕ್ಕೆ ಈ ವಿವರಗಳು ಬೇಕಾಗಬಹುದು: ${missing}. ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.` : 'ಯೋಜನೆ ಮಾರ್ಗದರ್ಶನಕ್ಕೆ ಅಗತ್ಯವಾದ ಮುಖ್ಯ ವಿವರಗಳು ನಿಮ್ಮ ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿವೆ.',
  },
  ml: {
    notFound: 'ലഭ്യമായ രേഖകളിൽ നിന്ന് ഒരു പ്രത്യേക പദ്ധതി സ്ഥിരീകരിക്കാനായില്ല. വിദ്യാഭ്യാസം, കൃഷി, തൊഴിൽ, ആരോഗ്യം, ഭവനം അല്ലെങ്കിൽ ബിസിനസ് സംബന്ധിച്ച് ചോദിക്കൂ. ഇത് പ്രാഥമിക വിവരമാണ്; അന്തിമ തീരുമാനം സർക്കാർ വകുപ്പിന്റേതാണ്.',
    found: (names) => `സാധ്യതയുള്ള സ്ഥിരീകരിച്ച പദ്ധതികൾ: ${names}. നിലവിലെ വ്യവസ്ഥകൾക്കായി ഔദ്യോഗിക ലിങ്കുകൾ പരിശോധിക്കുക. അന്തിമ യോഗ്യതയും അംഗീകാരവും സർക്കാർ വകുപ്പ് തീരുമാനിക്കും.`,
    eligibility: (name, score, missing) => `${name} യോഗ്യതാ പൊരുത്തം: ${score}%. ${missing ? `പൂർത്തിയാകാത്തതോ രേഖയിലുള്ളതല്ലാത്തതോ: ${missing}. ` : ''}ഇത് പ്രാഥമിക പൊരുത്തമാണ്, അംഗീകാരമല്ല. അന്തിമ യോഗ്യത സർക്കാർ വകുപ്പ് തീരുമാനിക്കും.`,
    noRules: (name) => `${name}-ന് ഘടനാപരമായ യോഗ്യതാ നിയമങ്ങളില്ല; അതിനാൽ യോഗ്യതാ പൊരുത്തം കണക്കാക്കാനാവില്ല. ഔദ്യോഗിക ഉറവിടം പരിശോധിക്കുക.`,
    documents: (items) => `പദ്ധതിയിൽ പറയുന്ന രേഖകൾ: ${items}. ആവശ്യകതകൾ മാറാം; ഔദ്യോഗിക ഉറവിടം പരിശോധിക്കുക. ചാറ്റിൽ രേഖാനമ്പറുകളോ ചിത്രങ്ങളോ പങ്കിടരുത്.`,
    profile: (missing) => missing ? `കൂടുതൽ പ്രസക്തമായ മാർഗനിർദേശത്തിന് ഈ വിവരങ്ങൾ ആവശ്യമായേക്കാം: ${missing}. പ്രൊഫൈലിൽ പരിശോധിക്കുക.` : 'പദ്ധതി മാർഗനിർദേശത്തിന് ആവശ്യമായ പ്രധാന വിവരങ്ങൾ പ്രൊഫൈലിലുണ്ട്.',
  },
};

const intentWords = {
  eligibility: ['eligible', 'eligibility', 'qualify', 'apply', 'am i', 'అర్హత', 'అర్హుడా', 'योग्य', 'पात्र', 'தகுதி', 'যোগ্য', 'પાત્ર', 'ಯೋಗ್ಯ', 'യോഗ്യത', 'ਪਾਤਰ', 'اہل'],
  documents: ['document', 'documents', 'certificate', 'paper', 'పత్రం', 'పత్రాలు', 'दस्तावेज', 'प्रमाणपत्र', 'ஆவணம்', 'নথি', 'દસ્તાવેજ', 'ದಾಖಲೆ', 'രേഖ', 'ਦਸਤਾਵੇਜ਼', 'دستاویز'],
  profile: ['profile', 'missing from my profile', 'my details', 'ప్రొఫైల్', 'వివరాలు', 'प्रोफ़ाइल', 'जानकारी', 'சுயவிவரம்', 'প্রোফাইল', 'પ્રોફાઇલ', 'ಪ್ರೊಫೈಲ್', 'പ്രൊഫൈൽ', 'پروفائل'],
  education: ['scholarship', 'student', 'education', 'college', 'విద్యార్థి', 'విద్య', 'छात्रवृत्ति', 'शिक्षा', 'छात्र', 'உதவித்தொகை', 'கல்வி', 'শিক্ষা', 'ছাত্রবৃত্তি', 'શિક્ષણ', 'ವಿದ್ಯಾರ್ಥಿ'],
  farming: ['farmer', 'farming', 'agriculture', 'crop', 'రైతు', 'వ్యవసాయం', 'किसान', 'कृषि', 'விவசாயம்', 'விவசாயி', 'কৃষি', 'ખેતી', 'ಕೃಷಿ', 'കൃഷി', 'کسان'],
  business: ['business', 'loan', 'vendor', 'enterprise', 'వ్యాపార', 'రుణం', 'व्यवसाय', 'ऋण', 'வணிகம்', 'கடன்', 'ব্যবসা', 'વ્યવસાય', 'ವ್ಯವಹಾರ', 'ബിസിനസ്', 'کاروبار'],
};

function hasIntent(question: string, words: string[]): boolean {
  return words.some((word) => question.includes(word));
}

function languageResponses(language: string) {
  return responseText[language] ?? responseText.en;
}

export function getAssistantReply(question: string, context: AssistantContext): AssistantReply {
  const text = question.trim().toLocaleLowerCase();
  const previousScheme = context.schemes.find((scheme) => scheme.id === context.previousSchemeId);
  const activeScheme = context.activeScheme ?? previousScheme;
  const messages = languageResponses(context.language);

  if (hasIntent(text, intentWords.profile)) {
    const profile = context.profile ?? {};
    const missing = [
      ['name', 'full name'], ['phone', 'phone number'], ['state', 'state'], ['district', 'district'],
      ['occupation', 'occupation'], ['education', 'education'], ['annualIncome', 'annual household income'],
    ].filter(([key]) => !String(profile[key] ?? '').trim()).map(([, label]) => label);
    return { text: messages.profile(missing.join(', ')) };
  }

  if (hasIntent(text, intentWords.documents) || context.path === '/documents') {
    const scheme = activeScheme;
    if (scheme) {
      return { text: messages.documents(scheme.documents.join(', ')), schemeId: scheme.id };
    }
    const pending = context.documents
      .filter((document) => !['VERIFIED', 'UPLOADED', 'completed'].includes(document.status ?? ''))
      .map((document) => document.documentType ?? document.name)
      .filter((name): name is string => Boolean(name));
    return {
      text: pending.length ? messages.documents(pending.join(', ')) : messages.documents('the document checklist on your Documents page'),
    };
  }

  if (hasIntent(text, intentWords.eligibility) || context.path === '/eligibility') {
    const scheme = activeScheme ?? context.schemes.find((candidate) => candidate.eligibilityRules);
    if (!scheme) return { text: messages.notFound };
    const result = evaluateSchemeEligibility(scheme, context.profile, context.documents);
    if (!result.hasStructuredRules || result.score === null) return { text: messages.noRules(scheme.name), schemeId: scheme.id };
    return {
      text: messages.eligibility(scheme.name, result.score, result.missingRequirements.join(', ')),
      schemeId: scheme.id,
    };
  }

  if (context.path === '/profile') {
    const profile = context.profile ?? {};
    const missing = ['name', 'phone', 'state', 'district', 'occupation', 'education', 'annualIncome']
      .filter((key) => !String(profile[key] ?? '').trim());
    return { text: messages.profile(missing.join(', ')) };
  }

  const intentCategory = hasIntent(text, intentWords.education) ? 'Education'
    : hasIntent(text, intentWords.farming) ? 'Agriculture'
      : hasIntent(text, intentWords.business) ? 'Business' : '';
  const matches = context.schemes.filter((scheme) => (
    scheme === activeScheme
    || (intentCategory ? scheme.category.toLocaleLowerCase() === intentCategory.toLocaleLowerCase() : false)
    || scheme.tags.some((tag) => text.includes(tag.toLocaleLowerCase()))
    || text.includes(scheme.category.toLocaleLowerCase())
    || text.includes(scheme.name.toLocaleLowerCase())
  )).slice(0, 3);

  if (!matches.length) return { text: messages.notFound };
  return {
    text: messages.found(matches.map((scheme) => scheme.name).join(', ')),
    schemeId: matches[0].id,
  };
}

export function redactConversationText(value: string): string {
  if (/\b(?:aadhaar|aadhar|bank account|account number|password|one[- ]time password|otp)\b/i.test(value)) {
    return '[message omitted for privacy]';
  }
  return value
    .replace(/\b\d{12}\b/g, '[redacted ID number]')
    .replace(/\b\d{9,18}\b/g, '[redacted number]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[redacted tax ID]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .slice(0, 1200);
}
