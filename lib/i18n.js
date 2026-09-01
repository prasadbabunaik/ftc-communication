// Lightweight client-side i18n. Translations are keyed by the ENGLISH source
// string, so a missing key simply falls back to English — partial coverage is
// always safe. English needs no map (the key is the text). Add Hindi here.
export const HI = {
  // Sidebar sections
  'Main': 'मुख्य',
  'Grid Tracker': 'ग्रिड ट्रैकर',
  'Administration': 'प्रशासन',
  // Sidebar items
  'Dashboard': 'डैशबोर्ड',
  'CONTD-4 Applications': 'CONTD-4 आवेदन',
  'FTC Tracker': 'FTC ट्रैकर',
  'Transmission': 'पारेषण',
  'Region-wise Breakup': 'क्षेत्रवार विवरण',
  'Source-wise Breakup': 'स्रोतवार विवरण',
  'BESS Data': 'BESS डेटा',
  'User Management': 'उपयोगकर्ता प्रबंधन',
  'Access Control': 'पहुँच नियंत्रण',
  'Login Activity': 'लॉगिन गतिविधि',
  'Database Backups': 'डेटाबेस बैकअप',
  'Settings': 'सेटिंग्स',
  // Header / chrome
  'FTC Communication Portal': 'FTC संचार पोर्टल',
  'Session': 'सत्र',
  'Profile': 'प्रोफ़ाइल',
  'Logout': 'लॉग आउट',
  'Log out': 'लॉग आउट',
  'Language': 'भाषा',
};

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिंदी', short: 'हिं' },
];

export function translate(lang, key) {
  if (lang === 'hi') return HI[key] ?? key;
  return key;
}
