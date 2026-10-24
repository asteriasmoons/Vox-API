import { norm } from './identity';

// Broad reading subjects adapted from Loomey's fiction/nonfiction and interests catalogs.
// This limits subject-driven searches, never whether a book can be stored.
const topics = [
'fantasy','mystery','historical fiction','science fiction','romance','literary fiction',
'horror','thriller','contemporary fiction','magical realism','biography','memoir',
'history','psychology','science','technology','witchcraft','folklore','philosophy',
'self improvement','art','nature','true crime','health','business','poetry',
'graphic novels','young adult','adventure','paranormal','mythology','manga',
'comics','dystopian','spirituality','wellness','mindfulness','politics',
'writing','education','astronomy','astrology','anthropology','archaeology',
'architecture','biology','ecology','economics','ethics','evolution',
'neuroscience','nutrition','parenting','religion','travel','leadership',
'entrepreneurship','creativity','feminism','herbalism','meditation',
'art history','artificial intelligence','climate change','conservation',
'animal behavior','criminal investigation','cultures and traditions',
'dark academia','dragons','dreams','emotional intelligence','fae',
'ghosts','habit building','historical figures','human behavior',
'indigenous history','linguistics','magic','ocean life','political intrigue',
'relationships','rituals','secret societies','social justice',
'space exploration','time travel','trauma recovery','vampires',
'werewolves','witches','women s history','ancient civilizations',
'ancient egypt','food and cooking','mental health','personal growth',
'found family','coming of age','self discovery','workplace romance',
'betrayal','belonging','friendship','grief','healing','identity',
'justice','love','loyalty','morality','redemption','resilience',
'revenge','survival','transformation'
];
const allowed = new Set(topics.map(norm));
const blocked = new Set(['fiction','nonfiction','books','literature','general','adult',
'english','restaurants','restaurant management','production management',
'social aspects','production','social conditions','social life and customs']);
const unsuitable = /(?:^| )(?:management|operations|administration|manuals?|textbooks?|handbooks?|directories|catalogs?|industry|industries|occupational|vocational|manufacturing|production|restaurants?)(?: |$)/;

export function isReadingDiscoverySubject(subject: string): boolean {
 const label = norm(subject);
 if (!label || blocked.has(label) || unsuitable.test(label)) return false;
 if (allowed.has(label)) return true;
 // Don't require every legitimate nonfiction subject to appear in the app's picker.
 // Unknown specific subjects remain discoverable; reject only broad/operational noise.
 if (label.split(' ').length > 5) return false;
 if (/(?:^| )(?:aspects|studies|miscellaneous|general works|reference works)(?: |$)/.test(label)) return false;
 return true;
}
