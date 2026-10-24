/**
 * Red Squiggly — 6th Grade Spelling Bee Web App
 * Runs on Cloudflare Pages + Cloudflare KV (/api/progress) with offline-first localStorage sync.
 */

const STORAGE_KEYS = {
  PROGRESS: 'red_squiggly_progress_v2',
  SETTINGS: 'red_squiggly_settings_v2',
  AUDIO_CACHE: 'red_squiggly_audio_cache_v1',
  CUSTOM_CSV: 'red_squiggly_custom_csv_v1',
};

const DEFAULT_SETTINGS = {
  quizLength: 10,
  selectedLevels: [], // populated once CSV loads
  filterMode: 'smart', // 'smart' | 'unseen' | 'missed' | 'starred'
  preferHumanAudio: true,
  soundEffects: true,
  showOnScreenKeyboard: false,
  voiceURI: '',
  speechRate: 0.88,
};

const state = {
  activeTab: 'home', // 'home' | 'quiz' | 'study' | 'settings'
  words: [], // Array of { id, level, word, altSpelling, partOfSpeech, phonetic, origin, definition, sentence }
  levels: [],
  progress: {}, // wordKey -> { correct, incorrect, streak, lastPracticed, bookmarked }
  settings: { ...DEFAULT_SETTINGS },
  audioCache: {}, // wordLower -> mp3Url | null
  voices: [],
  syncStatus: 'connecting', // 'connecting' | 'synced' | 'syncing' | 'local' | 'error'
  kvConfigured: false,
  lastSyncedAt: null,

  // Study Tab filters
  studySearch: '',
  studyFilter: 'all', // 'all' | 'starred' | 'missed' | 'mastered' | 'unseen'
  studyColumn: 'all',
  studyHideWords: false, // Flashcard self-test toggle in Study mode

  // Active Quiz state
  quiz: {
    active: false,
    status: 'inProgress', // 'inProgress' | 'summary'
    phase: 'answering', // 'answering' | 'feedback'
    words: [],
    currentIndex: 0,
    userSpelling: '',
    results: {}, // wordKey -> { isCorrect, typed }
    activeHint: null, // { type, label, text }
    lastAudioSource: '', // 'Dictionary MP3' | 'Device TTS'
    sessionStreak: 0,
    isListening: false,
    practiceRetryText: '',
    practiceRetrySolved: false,
  },
};

let recognitionInstance = null;
let currentAudioElement = null;

// ============================================================================
// 1. Initialization & CSV Parsing
// ============================================================================

async function initApp() {
  loadLocalState();
  initSpeechSynthesisVoices();
  bindHeaderEvents();

  await loadWordList();
  render();

  // Trigger background sync with Cloudflare KV
  syncWithCloudflareKV(true);

  // Pre-warm dictionary audio URLs for the first batch of words quietly
  prewarmDictionaryAudio();
}

function loadLocalState() {
  try {
    const rawProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS);
    if (rawProgress) state.progress = JSON.parse(rawProgress) || {};
  } catch (e) {
    console.warn('Could not load local progress:', e);
  }

  try {
    const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (rawSettings) {
      state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
    }
  } catch (e) {
    console.warn('Could not load local settings:', e);
  }

  try {
    const rawAudio = localStorage.getItem(STORAGE_KEYS.AUDIO_CACHE);
    if (rawAudio) state.audioCache = JSON.parse(rawAudio) || {};
  } catch (e) {
    console.warn('Could not load audio cache:', e);
  }
}

function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(state.progress));
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
  } catch (e) {
    console.warn('Could not save local state:', e);
  }
}

function saveAudioCache() {
  try {
    localStorage.setItem(STORAGE_KEYS.AUDIO_CACHE, JSON.stringify(state.audioCache));
  } catch (e) {
    // ignore quota errors
  }
}

/**
 * RFC-4180 compliant CSV line parser
 */
function parseCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseWordListCsv(csvText) {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const words = [];
  const seen = new Set();

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    if (cols.length < 2) continue;

    const level = cols[0] || 'Two Bee';
    const word = cols[1] || '';
    if (!word || word.toLowerCase() === 'word') continue;

    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    words.push({
      id: key,
      level,
      word,
      altSpelling: cols[2] || '',
      partOfSpeech: cols[3] || '',
      phonetic: cols[4] || '',
      origin: cols[5] || '',
      definition: cols[6] || '',
      sentence: cols[7] || '',
    });
  }

  return words;
}

async function loadWordList() {
  let csvText = localStorage.getItem(STORAGE_KEYS.CUSTOM_CSV);

  if (!csvText) {
    const res = await fetch('wordlist.csv', { cache: 'no-cache' });
    csvText = await res.text();
  }

  state.words = parseWordListCsv(csvText);
  const levelSet = new Set(state.words.map((w) => w.level));
  state.levels = Array.from(levelSet);

  // Ensure selectedLevels is valid
  if (!state.settings.selectedLevels || state.settings.selectedLevels.length === 0) {
    state.settings.selectedLevels = [...state.levels];
  } else {
    state.settings.selectedLevels = state.settings.selectedLevels.filter((l) =>
      levelSet.has(l)
    );
    if (state.settings.selectedLevels.length === 0) {
      state.settings.selectedLevels = [...state.levels];
    }
  }

  const badge = document.getElementById('studyCountBadge');
  if (badge) badge.textContent = `(${state.words.length})`;
}

// ============================================================================
// 2. Cloudflare KV Cloud Sync
// ============================================================================

function updateSyncBadge() {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (!dot || !text) return;

  dot.className = 'sync-dot';
  if (state.syncStatus === 'synced') {
    dot.classList.add('synced');
    text.textContent = 'KV Synced';
  } else if (state.syncStatus === 'syncing' || state.syncStatus === 'connecting') {
    dot.classList.add('syncing');
    text.textContent = 'Syncing...';
  } else if (state.syncStatus === 'local') {
    dot.classList.add('local');
    text.textContent = 'Local Saved';
  } else {
    text.textContent = 'Offline Saved';
  }
}

function mergeClientAndServerProgress(localProg, remoteProg) {
  const merged = { ...remoteProg };
  for (const [k, localItem] of Object.entries(localProg)) {
    const remoteItem = merged[k];
    if (!remoteItem) {
      merged[k] = { ...localItem };
      continue;
    }
    const localTotal = (localItem.correct || 0) + (localItem.incorrect || 0);
    const remoteTotal = (remoteItem.correct || 0) + (remoteItem.incorrect || 0);
    const localTime = localItem.lastPracticed || 0;
    const remoteTime = remoteItem.lastPracticed || 0;

    if (localTotal > remoteTotal || (localTotal === remoteTotal && localTime >= remoteTime)) {
      merged[k] = { ...remoteItem, ...localItem };
    } else {
      merged[k] = { ...localItem, ...remoteItem };
    }
  }
  return merged;
}

async function syncWithCloudflareKV(isInitial = false) {
  state.syncStatus = 'syncing';
  updateSyncBadge();

  try {
    if (isInitial) {
      const getRes = await fetch('/api/progress', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!getRes.ok) {
        state.syncStatus = 'local';
        updateSyncBadge();
        return;
      }

      const data = await getRes.json();
      state.kvConfigured = Boolean(data.kvConfigured);

      if (data.kvConfigured && data.progress) {
        state.progress = mergeClientAndServerProgress(state.progress, data.progress);
        saveLocalState();
        if (state.activeTab === 'home' || state.activeTab === 'study') {
          render();
        }
      }
    }

    // Push merged progress back to KV
    const putRes = await fetch('/api/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        progress: state.progress,
        settings: {
          quizLength: state.settings.quizLength,
          preferHumanAudio: state.settings.preferHumanAudio,
        },
        merge: true,
      }),
    });

    if (putRes.ok) {
      const putData = await putRes.json();
      state.kvConfigured = Boolean(putData.kvConfigured);
      if (putData.kvConfigured && putData.progress) {
        state.progress = putData.progress;
        saveLocalState();
      }
      state.syncStatus = state.kvConfigured ? 'synced' : 'local';
      state.lastSyncedAt = Date.now();
    } else {
      state.syncStatus = 'local';
    }
  } catch (err) {
    // Running on a local static server without Pages Functions or offline
    state.syncStatus = 'local';
  }

  updateSyncBadge();
}

// ============================================================================
// 3. Mastery & Spaced Repetition Logic
// ============================================================================

function getWordStats(wordKey) {
  return (
    state.progress[wordKey] || {
      correct: 0,
      incorrect: 0,
      streak: 0,
      lastPracticed: 0,
      bookmarked: false,
    }
  );
}

/**
 * Mastery Buckets:
 * - 'unseen': correct === 0 && incorrect === 0
 * - 'needs-work': incorrect > 0 && (correct - incorrect < 0 || streak === 0)
 * - 'mastered': (correct - incorrect) >= 3 && streak >= 2
 * - 'learning': everything else that has been practiced at least once
 */
function getWordCategory(wordKey) {
  const s = getWordStats(wordKey);
  if (s.correct === 0 && s.incorrect === 0) return 'unseen';
  const net = s.correct - s.incorrect;
  if (net >= 3 && s.streak >= 2) return 'mastered';
  if (net < 0 || (s.incorrect > 0 && s.streak === 0)) return 'needs-work';
  return 'learning';
}

function getOverallStats() {
  const counts = {
    total: state.words.length,
    mastered: 0,
    learning: 0,
    needsWork: 0,
    unseen: 0,
    starred: 0,
  };

  for (const w of state.words) {
    const cat = getWordCategory(w.id);
    if (cat === 'mastered') counts.mastered++;
    else if (cat === 'learning') counts.learning++;
    else if (cat === 'needs-work') counts.needsWork++;
    else counts.unseen++;

    if (getWordStats(w.id).bookmarked) counts.starred++;
  }
  return counts;
}

function selectQuizWords(count, selectedLevels, filterMode) {
  let pool = state.words.filter((w) => selectedLevels.includes(w.level));

  if (filterMode === 'starred') {
    pool = pool.filter((w) => getWordStats(w.id).bookmarked);
  } else if (filterMode === 'missed') {
    pool = pool.filter((w) => {
      const cat = getWordCategory(w.id);
      return cat === 'needs-work' || getWordStats(w.id).incorrect > 0;
    });
  } else if (filterMode === 'unseen') {
    pool = pool.filter((w) => getWordCategory(w.id) === 'unseen');
  }

  if (pool.length === 0) {
    pool = state.words.filter((w) => selectedLevels.includes(w.level));
  }

  // Score each word for Spaced Repetition priority (lower score = higher priority)
  const scored = pool.map((w) => {
    const s = getWordStats(w.id);
    const cat = getWordCategory(w.id);
    let priority = 0;

    if (cat === 'needs-work') priority = -100 + (s.correct - s.incorrect) * 10;
    else if (cat === 'unseen') priority = -50;
    else if (cat === 'learning') priority = 0 + (s.correct - s.incorrect) * 10;
    else priority = 100 + (s.correct - s.incorrect) * 10;

    if (s.bookmarked) priority -= 35;

    // Add small jitter so quizzes stay fresh
    priority += (Math.random() - 0.5) * 25;

    return { word: w, priority };
  });

  scored.sort((a, b) => a.priority - b.priority);
  return scored.slice(0, count).map((item) => item.word);
}

function recordWordAttempt(wordKey, isCorrect) {
  const prev = getWordStats(wordKey);
  const updated = {
    ...prev,
    correct: prev.correct + (isCorrect ? 1 : 0),
    incorrect: prev.incorrect + (isCorrect ? 0 : 1),
    streak: isCorrect ? (prev.streak || 0) + 1 : 0,
    lastPracticed: Date.now(),
  };

  state.progress[wordKey] = updated;
  saveLocalState();
  syncWithCloudflareKV(false);
}

function toggleBookmark(wordKey) {
  const prev = getWordStats(wordKey);
  state.progress[wordKey] = {
    ...prev,
    bookmarked: !prev.bookmarked,
    lastPracticed: prev.lastPracticed || Date.now(),
  };
  saveLocalState();
  syncWithCloudflareKV(false);
  render();
}

// ============================================================================
// 4. Human MP3 Dictionary Lookup + Smart TTS Engine
// ============================================================================

function initSpeechSynthesisVoices() {
  if (!('speechSynthesis' in window)) return;

  const updateVoices = () => {
    const all = window.speechSynthesis.getVoices() || [];
    state.voices = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));

    // Auto-select a high quality natural US English voice if none chosen yet
    if (!state.settings.voiceURI && state.voices.length > 0) {
      const preferred =
        state.voices.find((v) => v.name.includes('Natural') && v.lang.includes('US')) ||
        state.voices.find((v) => v.name.includes('Google US English')) ||
        state.voices.find((v) => v.name.includes('Samantha')) ||
        state.voices.find((v) => v.lang === 'en-US') ||
        state.voices[0];
      if (preferred) {
        state.settings.voiceURI = preferred.voiceURI;
      }
    }
  };

  updateVoices();
  window.speechSynthesis.onvoiceschanged = updateVoices;
}

/**
 * Resolves an authentic human pronunciation MP3 from Free Dictionary API.
 * Strictly validates that the returned headword and audio filename match the exact word
 * (preventing plural words like "salamanders" from playing singular "salamander.mp3").
 */
async function resolveHumanMp3Url(word) {
  const lower = word.toLowerCase();
  if (lower in state.audioCache) {
    return state.audioCache[lower];
  }

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lower)}`
    );
    if (!res.ok) {
      state.audioCache[lower] = null;
      saveAudioCache();
      return null;
    }

    const entries = await res.json();
    if (!Array.isArray(entries)) return null;

    const candidateUrls = [];
    for (const entry of entries) {
      if ((entry.word || '').toLowerCase() !== lower) continue;
      for (const p of entry.phonetics || []) {
        if (p.audio && typeof p.audio === 'string' && p.audio.endsWith('.mp3')) {
          const audioLower = p.audio.toLowerCase();
          // Ensure plural words don't accidentally use a singular stem audio file
          if (lower.endsWith('s') && !audioLower.includes(lower)) {
            continue;
          }
          candidateUrls.push(p.audio);
        }
      }
    }

    // Prefer US pronunciation MP3s first
    const bestUrl =
      candidateUrls.find((u) => u.includes('-us.mp3') || u.includes('_us')) ||
      candidateUrls[0] ||
      null;

    state.audioCache[lower] = bestUrl;
    saveAudioCache();
    return bestUrl;
  } catch (e) {
    return null;
  }
}

async function prewarmDictionaryAudio() {
  // Quietly resolve the first 15 words in the background
  const subset = state.words.slice(0, 15);
  for (const w of subset) {
    if (!(w.id in state.audioCache)) {
      await resolveHumanMp3Url(w.word);
    }
  }
}

function speakWithTts(text, rateOverride = null) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = rateOverride || state.settings.speechRate || 0.88;

  if (state.settings.voiceURI && state.voices.length > 0) {
    const matched = state.voices.find((v) => v.voiceURI === state.settings.voiceURI);
    if (matched) utter.voice = matched;
  }

  window.speechSynthesis.speak(utter);
}

async function speakWord(wordObj, { slow = false } = {}) {
  if (!wordObj) return;

  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement = null;
  }

  // Slow mode always uses TTS at a deliberate 0.55x speed for syllable clarity
  if (slow) {
    state.quiz.lastAudioSource = 'Slow Syllable Voice (0.55x)';
    updateAudioSourceBadge();
    speakWithTts(wordObj.word, 0.55);
    return;
  }

  if (state.settings.preferHumanAudio) {
    const mp3Url = await resolveHumanMp3Url(wordObj.word);
    if (mp3Url) {
      try {
        const audio = new Audio(mp3Url);
        currentAudioElement = audio;
        state.quiz.lastAudioSource = '🎙️ Dictionary Human Recording';
        updateAudioSourceBadge();
        await audio.play();
        return;
      } catch (err) {
        // Fall through to TTS if audio fails to play
      }
    }
  }

  state.quiz.lastAudioSource = '🔊 Natural Device Voice';
  updateAudioSourceBadge();
  speakWithTts(wordObj.word);
}

function updateAudioSourceBadge() {
  const el = document.getElementById('audioSourceBadge');
  if (el && state.quiz.lastAudioSource) {
    el.textContent = state.quiz.lastAudioSource;
  }
}

// ============================================================================
// 5. Sound Effects (Synthesized via Web Audio API)
// ============================================================================

function playToneEffect(isCorrect) {
  if (!state.settings.soundEffects) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (isCorrect) {
      // Cheerful ascending major third chime (C5 -> E5 -> G5)
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.26);
      });
    } else {
      // Gentle soft low double-tone
      [260, 220].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.24);
      });
    }
  } catch (e) {
    // Ignore audio context restrictions
  }
}

// ============================================================================
// 6. Visual Character Diff & Grading
// ============================================================================

function normalizeSpelling(input) {
  return (input || '')
    .trim()
    .replace(/[\s\-']/g, '')
    .toLowerCase();
}

function isSpellingMatch(wordObj, userSpelling) {
  const cleanUser = normalizeSpelling(userSpelling);
  if (!cleanUser) return false;

  const cleanPrimary = normalizeSpelling(wordObj.word);
  if (cleanUser === cleanPrimary) return true;

  if (wordObj.altSpelling) {
    const alts = wordObj.altSpelling.split('|').map((s) => normalizeSpelling(s));
    if (alts.includes(cleanUser)) return true;
  }
  return false;
}

/**
 * Computes an aligned character-by-character diff between user's attempt and the target word
 * using Longest Common Subsequence (LCS) alignment.
 */
function computeCharacterDiff(targetWord, userTyped) {
  const a = (userTyped || '').trim().toLowerCase().split('');
  const b = targetWord.toLowerCase().split('');
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      tokens.push({ type: 'match', char: targetWord[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: 'wrong', char: a[i] });
      i++;
    } else {
      tokens.push({ type: 'missing', char: targetWord[j] });
      j++;
    }
  }
  while (i < m) {
    tokens.push({ type: 'wrong', char: a[i++] });
  }
  while (j < n) {
    tokens.push({ type: 'missing', char: targetWord[j++] });
  }

  return tokens;
}

// ============================================================================
// 7. Voice Spelling Recognition (Spoken Letters -> Spelling)
// ============================================================================

const SPOKEN_LETTER_MAP = {
  a: 'a', ay: 'a', hey: 'a',
  b: 'b', be: 'b', bee: 'b',
  c: 'c', see: 'c', sea: 'c', cee: 'c',
  d: 'd', de: 'd', dee: 'd',
  e: 'e', ee: 'e',
  f: 'f', ef: 'f', eff: 'f',
  g: 'g', gee: 'g', jee: 'g',
  h: 'h', aitch: 'h', haitch: 'h',
  i: 'i', eye: 'i', aye: 'i',
  j: 'j', jay: 'j',
  k: 'k', kay: 'k',
  l: 'l', el: 'l', ell: 'l',
  m: 'm', em: 'm',
  n: 'n', en: 'n',
  o: 'o', oh: 'o', owe: 'o',
  p: 'p', pee: 'p', pea: 'p',
  q: 'q', cue: 'q', queue: 'q', kyu: 'q',
  r: 'r', are: 'r', ar: 'r',
  s: 's', es: 's', ess: 's',
  t: 't', tee: 't', tea: 't',
  u: 'u', you: 'u', yew: 'u',
  v: 'v', vee: 'v',
  w: 'w', doubleu: 'w',
  x: 'x', ex: 'x',
  y: 'y', why: 'y', wye: 'y',
  z: 'z', zee: 'z', zed: 'z',
};

function parseSpokenTranscriptToSpelling(rawTranscript) {
  const cleaned = rawTranscript
    .toLowerCase()
    .replace(/double\s+([a-z]+)/g, '$1 $1')
    .replace(/[^a-z\s]/g, ' ')
    .trim();

  if (!cleaned) return '';

  const tokens = cleaned.split(/\s+/);
  // If the speaker said a single word (or the browser collapsed spelled letters into a single word)
  if (tokens.length === 1 && tokens[0].length > 2 && !(tokens[0] in SPOKEN_LETTER_MAP)) {
    return tokens[0];
  }

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'capital' || t === 'letter') continue;
    if (t === 'double' && tokens[i + 1]) {
      const nextMapped = SPOKEN_LETTER_MAP[tokens[i + 1]] || tokens[i + 1][0] || '';
      out += nextMapped + nextMapped;
      i++;
      continue;
    }
    if (t in SPOKEN_LETTER_MAP) {
      out += SPOKEN_LETTER_MAP[t];
    } else if (t.length === 1) {
      out += t;
    } else {
      out += t;
    }
  }
  return out;
}

function toggleVoiceInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert('Voice recognition is not supported in this browser. Try Chrome, Edge, or Safari.');
    return;
  }

  if (state.quiz.isListening && recognitionInstance) {
    recognitionInstance.stop();
    state.quiz.isListening = false;
    render();
    return;
  }

  recognitionInstance = new SpeechRec();
  recognitionInstance.lang = 'en-US';
  recognitionInstance.interimResults = true;
  recognitionInstance.continuous = false;

  state.quiz.isListening = true;
  render();

  recognitionInstance.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript + ' ';
    }
    const parsed = parseSpokenTranscriptToSpelling(transcript);
    if (parsed) {
      state.quiz.userSpelling = parsed;
      const inputEl = document.getElementById('spellingInputBox');
      if (inputEl) inputEl.value = parsed;
      const submitBtn = document.getElementById('submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = !parsed.trim();
    }
  };

  recognitionInstance.onend = () => {
    state.quiz.isListening = false;
    render();
  };

  recognitionInstance.onerror = () => {
    state.quiz.isListening = false;
    render();
  };

  recognitionInstance.start();
}

// ============================================================================
// 8. Quiz Workflow Actions
// ============================================================================

function startNewQuiz(customWordList = null) {
  const words =
    customWordList ||
    selectQuizWords(
      state.settings.quizLength,
      state.settings.selectedLevels,
      state.settings.filterMode
    );

  if (words.length === 0) {
    alert('No words match your current filter! Try selecting all columns or "Smart Mix".');
    return;
  }

  state.activeTab = 'quiz';
  state.quiz = {
    active: true,
    status: 'inProgress',
    phase: 'answering',
    words,
    currentIndex: 0,
    userSpelling: '',
    results: {},
    activeHint: null,
    lastAudioSource: '',
    sessionStreak: 0,
    isListening: false,
    practiceRetryText: '',
    practiceRetrySolved: false,
  };

  render();
  const current = state.quiz.words[0];
  if (current) {
    speakWord(current);
  }
}

function showHint(type) {
  const wordObj = state.quiz.words[state.quiz.currentIndex];
  if (!wordObj) return;

  if (type === 'definition') {
    const text = wordObj.definition || 'Definition not available.';
    state.quiz.activeHint = {
      type: 'definition',
      label: `📖 Definition (${wordObj.partOfSpeech || 'word'})`,
      text,
    };
    render();
    speakWithTts(text);
  } else if (type === 'origin') {
    const text = wordObj.origin || 'Origin not available.';
    state.quiz.activeHint = {
      type: 'origin',
      label: '🌍 Language of Origin',
      text,
    };
    render();
    speakWithTts(`Language of origin: ${text}`);
  } else if (type === 'sentence') {
    const displaySentence = wordObj.sentence || `Can you spell _____?`;
    const spokenSentence = displaySentence.replace(/_____/g, wordObj.word);
    state.quiz.activeHint = {
      type: 'sentence',
      label: '💬 Example Sentence',
      text: displaySentence,
    };
    render();
    speakWithTts(spokenSentence);
  } else if (type === 'clue') {
    const text = `${wordObj.partOfSpeech || 'word'} • ${wordObj.word.length} letters • Starts with "${wordObj.word[0].toUpperCase()}"`;
    state.quiz.activeHint = {
      type: 'clue',
      label: '🔤 Word Structure Clue',
      text,
    };
    render();
  }
}

function submitQuizAnswer() {
  if (state.quiz.phase !== 'answering') return;
  const wordObj = state.quiz.words[state.quiz.currentIndex];
  if (!wordObj) return;

  const typed = state.quiz.userSpelling.trim();
  if (!typed) return;

  if (recognitionInstance && state.quiz.isListening) {
    recognitionInstance.stop();
    state.quiz.isListening = false;
  }

  const isCorrect = isSpellingMatch(wordObj, typed);
  state.quiz.results[wordObj.id] = { isCorrect, typed };
  state.quiz.phase = 'feedback';
  state.quiz.sessionStreak = isCorrect ? state.quiz.sessionStreak + 1 : 0;
  state.quiz.practiceRetryText = '';
  state.quiz.practiceRetrySolved = false;

  playToneEffect(isCorrect);
  recordWordAttempt(wordObj.id, isCorrect);
  render();
}

function advanceToNextWord() {
  if (state.quiz.currentIndex < state.quiz.words.length - 1) {
    state.quiz.currentIndex++;
    state.quiz.phase = 'answering';
    state.quiz.userSpelling = '';
    state.quiz.activeHint = null;
    state.quiz.practiceRetryText = '';
    state.quiz.practiceRetrySolved = false;
    render();
    speakWord(state.quiz.words[state.quiz.currentIndex]);
  } else {
    state.quiz.status = 'summary';
    render();
  }
}

// ============================================================================
// 9. Rendering Views
// ============================================================================

function bindHeaderEvents() {
  document.getElementById('brandHomeBtn')?.addEventListener('click', () => {
    state.activeTab = 'home';
    render();
  });

  document.getElementById('navHomeBtn')?.addEventListener('click', () => {
    state.activeTab = state.quiz.active && state.quiz.status === 'inProgress' ? 'quiz' : 'home';
    render();
  });

  document.getElementById('navStudyBtn')?.addEventListener('click', () => {
    state.activeTab = 'study';
    render();
  });

  document.getElementById('navSettingsBtn')?.addEventListener('click', () => {
    state.activeTab = 'settings';
    render();
  });

  document.getElementById('syncStatusBtn')?.addEventListener('click', () => {
    syncWithCloudflareKV(true);
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  // Highlight active nav button
  const navTabMap = {
    home: 'navHomeBtn',
    quiz: 'navHomeBtn',
    study: 'navStudyBtn',
    settings: 'navSettingsBtn',
  };
  document.querySelectorAll('.nav-tab').forEach((btn) => btn.classList.remove('active'));
  const activeNavId = navTabMap[state.activeTab];
  if (activeNavId) document.getElementById(activeNavId)?.classList.add('active');

  updateSyncBadge();

  const root = document.getElementById('appRoot');
  if (!root) return;

  if (state.activeTab === 'home') {
    renderHomeView(root);
  } else if (state.activeTab === 'quiz') {
    renderQuizView(root);
  } else if (state.activeTab === 'study') {
    renderStudyView(root);
  } else if (state.activeTab === 'settings') {
    renderSettingsView(root);
  }
}

function renderHomeView(root) {
  const stats = getOverallStats();
  const lengthOptions = [5, 10, 15, 25, 50];
  const filterModes = [
    { id: 'smart', icon: '🧠', label: 'Smart Spaced Repetition', count: state.words.length },
    { id: 'unseen', icon: '✨', label: 'Unpracticed Only', count: stats.unseen },
    { id: 'missed', icon: '🔥', label: 'Needs Work / Missed', count: stats.needsWork },
    { id: 'starred', icon: '⭐', label: 'Starred Words', count: stats.starred },
  ];

  const hasActiveQuiz = state.quiz.active && state.quiz.status === 'inProgress';

  root.innerHTML = `
    ${
      hasActiveQuiz
        ? `<div class="card" style="background: var(--honey-soft); border-color: #fcd34d; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div>
              <strong>🐝 Quiz in Progress!</strong>
              <div style="font-size: 0.9rem; color: #92400e;">You are on Word ${state.quiz.currentIndex + 1} of ${state.quiz.words.length}.</div>
            </div>
            <button class="btn btn-primary" id="resumeQuizBtn" style="padding: 10px 20px;">Resume Quiz →</button>
          </div>`
        : ''
    }

    <div class="stats-grid">
      <div class="stat-box stat-mastered" title="Spelled correctly at least 3 more times than missed">
        <div class="stat-value">${stats.mastered}</div>
        <div class="stat-label">Mastered</div>
      </div>
      <div class="stat-box stat-learning" title="Currently practicing and building streak">
        <div class="stat-value">${stats.learning}</div>
        <div class="stat-label">Learning</div>
      </div>
      <div class="stat-box stat-needs-work" title="Missed recently — high priority in quizzes">
        <div class="stat-value">${stats.needsWork}</div>
        <div class="stat-label">Needs Work</div>
      </div>
      <div class="stat-box stat-unseen" title="Words not practiced yet">
        <div class="stat-value">${stats.unseen}</div>
        <div class="stat-label">Unseen</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>1. Choose Practice Mode</span>
        <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600;">${stats.total} Total Words</span>
      </div>
      <div class="chip-group">
        ${filterModes
          .map(
            (m) => `
          <button class="chip ${state.settings.filterMode === m.id ? 'selected' : ''}" data-filter-mode="${m.id}">
            <span>${m.icon}</span>
            <span>${escapeHtml(m.label)}</span>
            <span class="chip-count">${m.count}</span>
          </button>
        `
          )
          .join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>2. Which Columns from Her Sheet?</span>
        <button class="btn-secondary" id="selectAllLevelsBtn" style="font-size: 0.78rem; padding: 4px 10px; border-radius: 8px; cursor: pointer;">Select All</button>
      </div>
      <div class="chip-group">
        ${state.levels
          .map((lvl) => {
            const count = state.words.filter((w) => w.level === lvl).length;
            const isSel = state.settings.selectedLevels.includes(lvl);
            return `
              <button class="chip ${isSel ? 'selected' : ''}" data-level="${escapeHtml(lvl)}">
                <span>${isSel ? '✓' : '+'} ${escapeHtml(lvl)}</span>
                <span class="chip-count">${count} words</span>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>3. How Many Words in This Round?</span>
      </div>
      <div class="chip-group" style="margin-bottom: 22px;">
        ${lengthOptions
          .map(
            (len) => `
          <button class="chip ${state.settings.quizLength === len ? 'selected' : ''}" data-quiz-len="${len}">
            ${len === 50 ? 'All 50 Words' : `${len} Words`}
          </button>
        `
          )
          .join('')}
      </div>

      <button class="btn btn-primary btn-block" id="startQuizBtn" ${state.settings.selectedLevels.length === 0 ? 'disabled' : ''}>
        <span>▶</span> Start Spelling Bee Round
      </button>
    </div>
  `;

  document.getElementById('resumeQuizBtn')?.addEventListener('click', () => {
    state.activeTab = 'quiz';
    render();
  });

  root.querySelectorAll('[data-filter-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settings.filterMode = btn.getAttribute('data-filter-mode');
      saveLocalState();
      render();
    });
  });

  document.getElementById('selectAllLevelsBtn')?.addEventListener('click', () => {
    state.settings.selectedLevels = [...state.levels];
    saveLocalState();
    render();
  });

  root.querySelectorAll('[data-level]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lvl = btn.getAttribute('data-level');
      const idx = state.settings.selectedLevels.indexOf(lvl);
      if (idx >= 0) {
        state.settings.selectedLevels.splice(idx, 1);
      } else {
        state.settings.selectedLevels.push(lvl);
      }
      saveLocalState();
      render();
    });
  });

  root.querySelectorAll('[data-quiz-len]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settings.quizLength = Number(btn.getAttribute('data-quiz-len'));
      saveLocalState();
      render();
    });
  });

  document.getElementById('startQuizBtn')?.addEventListener('click', () => {
    startNewQuiz();
  });
}

function renderQuizView(root) {
  if (!state.quiz.active || state.quiz.words.length === 0) {
    state.activeTab = 'home';
    renderHomeView(root);
    return;
  }

  if (state.quiz.status === 'summary') {
    renderQuizSummary(root);
    return;
  }

  const wordObj = state.quiz.words[state.quiz.currentIndex];
  const isFeedback = state.quiz.phase === 'feedback';
  const result = state.quiz.results[wordObj.id];
  const isCorrect = result?.isCorrect;
  const wordStats = getWordStats(wordObj.id);
  const progressPct = Math.round(((state.quiz.currentIndex + 1) / state.quiz.words.length) * 100);

  let feedbackHtml = '';
  if (isFeedback) {
    const diffTokens = computeCharacterDiff(wordObj.word, result.typed);
    const diffHtml = diffTokens
      .map((t) => {
        if (t.type === 'match') return `<span class="diff-char diff-match">${escapeHtml(t.char)}</span>`;
        if (t.type === 'wrong') return `<span class="diff-char diff-wrong" title="Extra or wrong letter">${escapeHtml(t.char)}</span>`;
        return `<span class="diff-char diff-missing" title="Missing letter">${escapeHtml(t.char)}</span>`;
      })
      .join('');

    const capitalNote =
      wordObj.word[0] === wordObj.word[0].toUpperCase()
        ? `<div style="font-size: 0.84rem; color: #92400e; background: var(--honey-soft); display: inline-block; padding: 3px 10px; border-radius: 999px; margin-top: 6px; font-weight: 600;">💡 Proper Noun: Capitalized as <strong>${escapeHtml(wordObj.word)}</strong></div>`
        : '';

    const altNote = wordObj.altSpelling
      ? `<div style="font-size: 0.84rem; color: var(--text-muted); margin-top: 4px; font-weight: 600;">🇬🇧 Also accepted: <strong>${escapeHtml(wordObj.altSpelling)}</strong></div>`
      : '';

    feedbackHtml = `
      <div>
        <div style="font-size: 0.9rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: ${isCorrect ? 'var(--success)' : 'var(--danger)'}; margin-bottom: 4px;">
          ${isCorrect ? '🎉 Correct!' : '❌ Not Quite — Check the Highlighted Letters'}
        </div>
        <div class="feedback-word">${escapeHtml(wordObj.word)}</div>
        <div class="feedback-phonetic">${escapeHtml(wordObj.phonetic)} • <em>${escapeHtml(wordObj.partOfSpeech)}</em></div>
        ${capitalNote}
        ${altNote}

        ${
          !isCorrect
            ? `
            <div style="margin-top: 8px; font-size: 0.85rem; color: var(--text-muted);">
              Your spelling: <strong>${escapeHtml(result.typed)}</strong>
            </div>
            <div class="diff-container" aria-label="Letter comparison">
              ${diffHtml}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-muted); margin-bottom: 6px;">
              <span style="color: var(--success); font-weight:700;">Green</span> = right &nbsp;•&nbsp;
              <span style="color: var(--danger); font-weight:700; text-decoration: line-through;">Red</span> = wrong letter &nbsp;•&nbsp;
              <span style="color: #b45309; font-weight:700;">Gold</span> = missing letter
            </div>

            <div class="practice-retry-box">
              <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; color: var(--text);">
                ✍️ Type <strong>${escapeHtml(wordObj.word)}</strong> once to lock it into memory:
              </div>
              <div style="display: flex; gap: 8px; justify-content: center; max-width: 360px; margin: 0 auto;">
                <input
                  type="text"
                  id="practiceRetryInput"
                  class="spelling-input"
                  style="font-size: 1.15rem; padding: 10px 14px; border-color: ${state.quiz.practiceRetrySolved ? 'var(--success)' : 'var(--border)'}; background: ${state.quiz.practiceRetrySolved ? '#f0fdf4' : '#fff'};"
                  placeholder="Type ${escapeHtml(wordObj.word)}..."
                  value="${escapeHtml(state.quiz.practiceRetryText)}"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </div>
              ${
                state.quiz.practiceRetrySolved
                  ? `<div style="color: var(--success); font-weight: 700; font-size: 0.85rem; margin-top: 6px;">✓ Nailed it! Ready for the next word.</div>`
                  : ''
              }
            </div>
          `
            : ''
        }

        <div style="margin-top: 14px; font-size: 0.92rem; color: var(--text); max-width: 560px; margin-left: auto; margin-right: auto;">
          <strong>Definition:</strong> ${escapeHtml(wordObj.definition)}
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">
            <strong>Origin:</strong> ${escapeHtml(wordObj.origin)}
          </div>
        </div>
      </div>
    `;
  }

  root.innerHTML = `
    <div class="quiz-topbar">
      <div style="display: flex; align-items: center; gap: 10px;">
        <button class="btn-secondary" id="quitQuizBtn" style="padding: 6px 12px; border-radius: 10px; font-size: 0.85rem; font-weight: 700; cursor: pointer;">
          ← Exit
        </button>
        <span style="font-weight: 800; font-size: 1rem;">
          Word ${state.quiz.currentIndex + 1} <span style="color: var(--text-muted); font-weight: 600;">of ${state.quiz.words.length}</span>
        </span>
        <span class="brand-badge" style="background: var(--surface-muted); color: var(--text-muted);">${escapeHtml(wordObj.level)}</span>
      </div>

      <div style="display: flex; align-items: center; gap: 10px;">
        ${
          state.quiz.sessionStreak >= 2
            ? `<span class="brand-badge" style="background: #ffedd5; color: #c2410c;">🔥 ${state.quiz.sessionStreak} Streak</span>`
            : ''
        }
        <button class="star-btn" id="quizBookmarkBtn" title="Bookmark this word as tricky">
          ${wordStats.bookmarked ? '⭐' : '☆'}
        </button>
      </div>
    </div>

    <div class="progress-track">
      <div class="progress-fill" style="width: ${progressPct}%;"></div>
    </div>

    <div class="speaker-stage ${isFeedback ? (isCorrect ? 'correct' : 'incorrect') : ''}">
      ${
        isFeedback
          ? feedbackHtml
          : `
          <div class="speaker-btn-row">
            <button class="big-speaker-btn" id="speakWordMainBtn">
              <span>🔊</span> Hear Word
            </button>
            <button class="slow-speaker-btn" id="speakWordSlowBtn" title="Speak slowly to hear every syllable">
              <span>🐢</span> Slow
            </button>
          </div>
          <div class="audio-source-badge" id="audioSourceBadge">
            ${escapeHtml(state.quiz.lastAudioSource || 'Tap Hear Word to listen')}
          </div>
        `
      }
    </div>

    ${
      !isFeedback
        ? `
        <div class="hints-row">
          <button class="hint-btn ${state.quiz.activeHint?.type === 'definition' ? 'active' : ''}" data-hint="definition">
            📖 Definition
          </button>
          <button class="hint-btn ${state.quiz.activeHint?.type === 'origin' ? 'active' : ''}" data-hint="origin">
            🌍 Origin
          </button>
          <button class="hint-btn ${state.quiz.activeHint?.type === 'sentence' ? 'active' : ''}" data-hint="sentence">
            💬 Sentence
          </button>
          <button class="hint-btn ${state.quiz.activeHint?.type === 'clue' ? 'active' : ''}" data-hint="clue">
            🔤 Clue
          </button>
        </div>

        ${
          state.quiz.activeHint
            ? `
            <div class="hint-card">
              <div>
                <div class="hint-card-label">${escapeHtml(state.quiz.activeHint.label)}</div>
                <div>${escapeHtml(state.quiz.activeHint.text)}</div>
              </div>
              <button class="btn-secondary" id="replayHintAudioBtn" style="padding: 6px 11px; border-radius: 8px; cursor: pointer; flex-shrink: 0;" title="Read hint aloud">
                🔊
              </button>
            </div>
          `
            : ''
        }

        <form id="quizSpellingForm" autocomplete="off">
          <div class="spelling-input-wrap">
            <input
              type="text"
              id="spellingInputBox"
              class="spelling-input"
              placeholder="Type spelling here (no spellcheck!)..."
              value="${escapeHtml(state.quiz.userSpelling)}"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-gramm="false"
              autofocus
            />
            <button
              type="button"
              class="mic-btn ${state.quiz.isListening ? 'listening' : ''}"
              id="voiceMicBtn"
              title="Spell aloud with your microphone"
            >
              🎤
            </button>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 0.82rem; color: var(--text-muted);">
            <span>${state.quiz.isListening ? '🔴 Listening... Say the letters clearly' : 'Tip: Press Enter to submit, or tap 🎤 to spell aloud'}</span>
            <button type="button" id="toggleOnscreenKbBtn" style="background: none; border: none; color: var(--primary); font-weight: 700; cursor: pointer; font-family: inherit;">
              ${state.settings.showOnScreenKeyboard ? 'Hide Tile Keypad ▲' : 'Show Tile Keypad ⌨️'}
            </button>
          </div>

          ${state.settings.showOnScreenKeyboard ? renderOnscreenKeyboardHtml() : ''}

          <button
            type="submit"
            class="btn btn-success btn-block"
            id="submitAnswerBtn"
            ${!state.quiz.userSpelling.trim() ? 'disabled' : ''}
          >
            ✓ Check Spelling
          </button>
        </form>
      `
        : `
        <div style="display: flex; gap: 12px;">
          <button class="btn btn-secondary" id="speakWordFeedbackBtn" style="flex: 0 0 auto;">
            🔊 Hear Again
          </button>
          <button class="btn btn-primary btn-block" id="nextWordBtn">
            ${state.quiz.currentIndex < state.quiz.words.length - 1 ? 'Next Word →' : 'See Final Score 🏆'}
          </button>
        </div>
      `
    }
  `;

  // Wire up events
  document.getElementById('quitQuizBtn')?.addEventListener('click', () => {
    state.activeTab = 'home';
    render();
  });

  document.getElementById('quizBookmarkBtn')?.addEventListener('click', () => {
    toggleBookmark(wordObj.id);
  });

  document.getElementById('speakWordMainBtn')?.addEventListener('click', () => {
    speakWord(wordObj, { slow: false });
  });

  document.getElementById('speakWordSlowBtn')?.addEventListener('click', () => {
    speakWord(wordObj, { slow: true });
  });

  document.getElementById('speakWordFeedbackBtn')?.addEventListener('click', () => {
    speakWord(wordObj, { slow: false });
  });

  root.querySelectorAll('[data-hint]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showHint(btn.getAttribute('data-hint'));
    });
  });

  document.getElementById('replayHintAudioBtn')?.addEventListener('click', () => {
    if (state.quiz.activeHint) {
      showHint(state.quiz.activeHint.type);
    }
  });

  const spellingInput = document.getElementById('spellingInputBox');
  if (spellingInput) {
    spellingInput.focus();
    spellingInput.setSelectionRange(spellingInput.value.length, spellingInput.value.length);

    spellingInput.addEventListener('input', (e) => {
      state.quiz.userSpelling = e.target.value;
      const submitBtn = document.getElementById('submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = !state.quiz.userSpelling.trim();
    });
  }

  document.getElementById('voiceMicBtn')?.addEventListener('click', () => {
    toggleVoiceInput();
  });

  document.getElementById('toggleOnscreenKbBtn')?.addEventListener('click', () => {
    state.settings.showOnScreenKeyboard = !state.settings.showOnScreenKeyboard;
    saveLocalState();
    render();
  });

  root.querySelectorAll('[data-kb-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-kb-key');
      if (k === 'BACKSPACE') {
        state.quiz.userSpelling = state.quiz.userSpelling.slice(0, -1);
      } else if (k === 'CLEAR') {
        state.quiz.userSpelling = '';
      } else {
        state.quiz.userSpelling += k;
      }
      if (spellingInput) {
        spellingInput.value = state.quiz.userSpelling;
      }
      const submitBtn = document.getElementById('submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = !state.quiz.userSpelling.trim();
    });
  });

  document.getElementById('quizSpellingForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuizAnswer();
  });

  const retryInput = document.getElementById('practiceRetryInput');
  if (retryInput) {
    retryInput.focus();
    retryInput.addEventListener('input', (e) => {
      state.quiz.practiceRetryText = e.target.value;
      if (isSpellingMatch(wordObj, state.quiz.practiceRetryText) && !state.quiz.practiceRetrySolved) {
        state.quiz.practiceRetrySolved = true;
        playToneEffect(true);
        render();
      }
    });
    retryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.quiz.practiceRetrySolved) {
        e.preventDefault();
        advanceToNextWord();
      }
    });
  }

  const nextBtn = document.getElementById('nextWordBtn');
  if (nextBtn) {
    if (isCorrect) nextBtn.focus();
    nextBtn.addEventListener('click', () => {
      advanceToNextWord();
    });
  }
}

function renderOnscreenKeyboardHtml() {
  const rows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['CLEAR', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'BACKSPACE'],
  ];

  return `
    <div class="onscreen-keyboard" aria-label="On-screen letter keypad">
      ${rows
        .map(
          (row) => `
        <div class="kb-row">
          ${row
            .map((k) => {
              if (k === 'BACKSPACE') {
                return `<button type="button" class="kb-key kb-wide" data-kb-key="BACKSPACE">⌫ Del</button>`;
              }
              if (k === 'CLEAR') {
                return `<button type="button" class="kb-key kb-wide" data-kb-key="CLEAR">Clear</button>`;
              }
              return `<button type="button" class="kb-key" data-kb-key="${k}">${k}</button>`;
            })
            .join('')}
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderQuizSummary(root) {
  const total = state.quiz.words.length;
  const missedWords = [];
  let correctCount = 0;

  for (const w of state.quiz.words) {
    const r = state.quiz.results[w.id];
    if (r?.isCorrect) correctCount++;
    else missedWords.push(w);
  }

  const pct = Math.round((correctCount / total) * 100);

  root.innerHTML = `
    <div class="card" style="text-align: center; padding: 32px 24px;">
      <div style="font-size: 3rem; margin-bottom: 6px;">${pct === 100 ? '🏆' : pct >= 80 ? '🌟' : '🐝'}</div>
      <h2 style="font-size: 1.75rem; font-weight: 800;">Round Complete!</h2>
      <div style="font-size: 3.2rem; font-weight: 800; color: var(--primary); margin: 8px 0;">
        ${correctCount} / ${total} <span style="font-size: 1.4rem; color: var(--text-muted);">(${pct}%)</span>
      </div>
      <p style="color: var(--text-muted); margin-bottom: 24px;">
        ${
          missedWords.length === 0
            ? 'Flawless victory! Every single word spelled accurately.'
            : `Great effort! Let's review the ${missedWords.length} word${missedWords.length === 1 ? '' : 's'} you missed.`
        }
      </p>

      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        ${
          missedWords.length > 0
            ? `<button class="btn btn-primary" id="retryMissedBtn">
                🔁 Retry ${missedWords.length} Missed Word${missedWords.length === 1 ? '' : 's'}
              </button>`
            : ''
        }
        <button class="btn btn-secondary" id="newRoundBtn">
          ▶ Start Another Round
        </button>
        <button class="btn btn-secondary" id="backHomeBtn">
          🏠 Back to Dashboard
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Round Breakdown</div>
      <div style="display: grid; gap: 10px;">
        ${state.quiz.words
          .map((w) => {
            const r = state.quiz.results[w.id];
            const ok = r?.isCorrect;
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 12px; background: ${ok ? 'var(--success-soft)' : 'var(--danger-soft)'};">
                <div>
                  <span style="font-weight: 800; font-family: var(--mono); font-size: 1.1rem;">
                    ${ok ? '✓' : '✗'} ${escapeHtml(w.word)}
                  </span>
                  <span style="font-size: 0.82rem; color: var(--text-muted); margin-left: 8px;">(${escapeHtml(w.phonetic)})</span>
                  ${
                    !ok && r?.typed
                      ? `<div style="font-size: 0.82rem; color: var(--danger);">You typed: <strong>${escapeHtml(r.typed)}</strong></div>`
                      : ''
                  }
                </div>
                <button class="btn-secondary" data-speak-summary="${escapeHtml(w.id)}" style="padding: 6px 12px; border-radius: 8px; cursor: pointer;">
                  🔊
                </button>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('retryMissedBtn')?.addEventListener('click', () => {
    startNewQuiz(missedWords);
  });

  document.getElementById('newRoundBtn')?.addEventListener('click', () => {
    startNewQuiz();
  });

  document.getElementById('backHomeBtn')?.addEventListener('click', () => {
    state.quiz.active = false;
    state.activeTab = 'home';
    render();
  });

  root.querySelectorAll('[data-speak-summary]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-speak-summary');
      const found = state.words.find((w) => w.id === id);
      if (found) speakWord(found);
    });
  });
}

// ============================================================================
// 10. Study List / Word Explorer View
// ============================================================================

function renderStudyView(root) {
  const searchLower = state.studySearch.trim().toLowerCase();

  const filtered = state.words.filter((w) => {
    if (state.studyColumn !== 'all' && w.level !== state.studyColumn) return false;

    const cat = getWordCategory(w.id);
    const s = getWordStats(w.id);
    if (state.studyFilter === 'starred' && !s.bookmarked) return false;
    if (state.studyFilter === 'missed' && cat !== 'needs-work' && s.incorrect === 0) return false;
    if (state.studyFilter === 'mastered' && cat !== 'mastered') return false;
    if (state.studyFilter === 'unseen' && cat !== 'unseen') return false;

    if (searchLower) {
      return (
        w.word.toLowerCase().includes(searchLower) ||
        w.definition.toLowerCase().includes(searchLower) ||
        w.origin.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  root.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>📖 6th Grade Spelling Bee Study Guide (${filtered.length} of ${state.words.length})</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="chip ${state.studyHideWords ? 'selected' : ''}" id="toggleFlashcardHideBtn" style="padding: 6px 12px; font-size: 0.82rem;">
            ${state.studyHideWords ? '🙈 Words Hidden (Self-Test)' : '👁️ Hide Spellings'}
          </button>
          ${
            filtered.length > 0
              ? `<button class="btn btn-primary" id="quizFilteredWordsBtn" style="padding: 7px 14px; font-size: 0.84rem; border-radius: 10px;">
                  ▶ Quiz These (${filtered.length})
                </button>`
              : ''
          }
        </div>
      </div>

      <div class="study-controls">
        <input
          type="search"
          id="studySearchInput"
          class="search-input"
          placeholder="Search words, definitions, or origins (e.g. Greek, French)..."
          value="${escapeHtml(state.studySearch)}"
        />
        <select id="studyColumnSelect" class="search-input" style="flex: 0 0 auto; min-width: 150px;">
          <option value="all" ${state.studyColumn === 'all' ? 'selected' : ''}>All 3 Columns (50)</option>
          ${state.levels
            .map(
              (lvl) =>
                `<option value="${escapeHtml(lvl)}" ${state.studyColumn === lvl ? 'selected' : ''}>${escapeHtml(lvl)}</option>`
            )
            .join('')}
        </select>
        <select id="studyStatusSelect" class="search-input" style="flex: 0 0 auto; min-width: 165px;">
          <option value="all" ${state.studyFilter === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="starred" ${state.studyFilter === 'starred' ? 'selected' : ''}>⭐ Starred</option>
          <option value="missed" ${state.studyFilter === 'missed' ? 'selected' : ''}>🔥 Needs Work / Missed</option>
          <option value="unseen" ${state.studyFilter === 'unseen' ? 'selected' : ''}>✨ Unpracticed</option>
          <option value="mastered" ${state.studyFilter === 'mastered' ? 'selected' : ''}>✓ Mastered</option>
        </select>
      </div>
    </div>

    <div class="word-list-grid">
      ${filtered
        .map((w) => {
          const s = getWordStats(w.id);
          const cat = getWordCategory(w.id);
          const catBadgeMap = {
            mastered: { label: '✓ Mastered', bg: 'var(--success-soft)', color: 'var(--success)' },
            learning: { label: 'Learning', bg: 'var(--honey-soft)', color: '#b45309' },
            'needs-work': { label: 'Needs Work', bg: 'var(--danger-soft)', color: 'var(--danger)' },
            unseen: { label: 'New', bg: 'var(--info-soft)', color: 'var(--info)' },
          };
          const badge = catBadgeMap[cat];

          return `
            <div class="study-word-card">
              <div class="study-word-header">
                <div class="study-word-title">
                  <button class="btn-secondary" data-study-speak="${escapeHtml(w.id)}" style="padding: 6px 11px; border-radius: 999px; cursor: pointer;" title="Listen to pronunciation">
                    🔊
                  </button>
                  <span style="font-family: var(--mono); ${state.studyHideWords ? 'filter: blur(8px); cursor: pointer;' : ''}" class="study-word-text" title="${state.studyHideWords ? 'Click to peek' : ''}">
                    ${escapeHtml(w.word)}
                  </span>
                  ${
                    w.altSpelling
                      ? `<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">(or ${escapeHtml(w.altSpelling)})</span>`
                      : ''
                  }
                  <span class="study-phonetic">${escapeHtml(w.phonetic)}</span>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 0.75rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: ${badge.bg}; color: ${badge.color};">
                    ${badge.label} (${s.correct}✓ / ${s.incorrect}✗)
                  </span>
                  <button class="star-btn" data-study-star="${escapeHtml(w.id)}" title="Bookmark tricky word">
                    ${s.bookmarked ? '⭐' : '☆'}
                  </button>
                </div>
              </div>

              <div class="study-meta">
                ${escapeHtml(w.level)} &nbsp;•&nbsp; <em>${escapeHtml(w.partOfSpeech)}</em> &nbsp;•&nbsp; Origin: <strong>${escapeHtml(w.origin)}</strong>
              </div>
              <div class="study-def">${escapeHtml(w.definition)}</div>
              <div class="study-sentence">"${escapeHtml(w.sentence)}"</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  const searchInput = document.getElementById('studySearchInput');
  searchInput?.addEventListener('input', (e) => {
    state.studySearch = e.target.value;
    renderStudyView(root);
    const el = document.getElementById('studySearchInput');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  document.getElementById('studyColumnSelect')?.addEventListener('change', (e) => {
    state.studyColumn = e.target.value;
    render();
  });

  document.getElementById('studyStatusSelect')?.addEventListener('change', (e) => {
    state.studyFilter = e.target.value;
    render();
  });

  document.getElementById('toggleFlashcardHideBtn')?.addEventListener('click', () => {
    state.studyHideWords = !state.studyHideWords;
    render();
  });

  document.getElementById('quizFilteredWordsBtn')?.addEventListener('click', () => {
    startNewQuiz(filtered.slice(0, state.settings.quizLength));
  });

  root.querySelectorAll('.study-word-text').forEach((el) => {
    el.addEventListener('click', () => {
      el.style.filter = el.style.filter === 'none' ? 'blur(8px)' : 'none';
    });
  });

  root.querySelectorAll('[data-study-speak]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-study-speak');
      const found = state.words.find((w) => w.id === id);
      if (found) speakWord(found);
    });
  });

  root.querySelectorAll('[data-study-star]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleBookmark(btn.getAttribute('data-study-star'));
    });
  });
}

// ============================================================================
// 11. Settings & Cloudflare KV Status View
// ============================================================================

function renderSettingsView(root) {
  root.innerHTML = `
    <div class="card">
      <div class="card-title">🔊 Audio & Pronunciation Settings</div>
      <div style="display: grid; gap: 16px;">
        <label style="display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 700;">Use Real Human Dictionary Audio (MP3)</div>
            <div style="font-size: 0.84rem; color: var(--text-muted);">
              Plays authentic human pronunciation recordings first and falls back to device Text-to-Speech when needed.
            </div>
          </div>
          <input type="checkbox" id="preferHumanAudioToggle" style="width: 22px; height: 22px;" ${state.settings.preferHumanAudio ? 'checked' : ''} />
        </label>

        <label style="display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 700;">Celebration Chimes & Sound Effects</div>
            <div style="font-size: 0.84rem; color: var(--text-muted);">Play gentle feedback tones when checking an answer.</div>
          </div>
          <input type="checkbox" id="soundEffectsToggle" style="width: 22px; height: 22px;" ${state.settings.soundEffects ? 'checked' : ''} />
        </label>

        <div>
          <div style="font-weight: 700; margin-bottom: 6px;">Fallback Text-to-Speech Voice (Used for Sentences, Origins & Definitions)</div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <select id="voiceSelectDropdown" class="search-input" style="flex: 1;">
              ${
                state.voices.length === 0
                  ? `<option value="">System Default English Voice</option>`
                  : state.voices
                      .map(
                        (v) =>
                          `<option value="${escapeHtml(v.voiceURI)}" ${state.settings.voiceURI === v.voiceURI ? 'selected' : ''}>${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`
                      )
                      .join('')
              }
            </select>
            <button class="btn btn-secondary" id="testVoiceBtn" style="padding: 10px 18px;">
              🔊 Test Voice
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">☁️ Cloudflare KV Multi-Device Sync</div>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 14px;">
        Status: <strong>${state.kvConfigured ? '✅ Connected to Cloudflare KV (PROGRESS_KV)' : '💾 Local Storage Mode (Bind PROGRESS_KV in Cloudflare Pages to sync across devices)'}</strong>
        ${state.lastSyncedAt ? `<br/>Last checked: ${new Date(state.lastSyncedAt).toLocaleTimeString()}` : ''}
      </p>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-secondary" id="forceSyncNowBtn" style="padding: 10px 18px;">
          🔄 Sync Progress Now
        </button>
        <button class="btn btn-secondary" id="exportProgressBtn" style="padding: 10px 18px;">
          ⬇️ Export Backup JSON
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📄 Custom Word List (CSV) & Reset</div>
      <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 14px;">
        Currently loaded: <strong>${state.words.length} words</strong> from <code>wordlist.csv</code>. You can also upload a new CSV file directly here or reset practice stats.
      </p>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <label class="btn btn-secondary" style="padding: 10px 18px; cursor: pointer;">
          📂 Upload Custom CSV
          <input type="file" id="uploadCsvInput" accept=".csv,text/csv" style="display: none;" />
        </label>
        ${
          localStorage.getItem(STORAGE_KEYS.CUSTOM_CSV)
            ? `<button class="btn btn-secondary" id="restoreDefaultCsvBtn" style="padding: 10px 18px;">
                ↩️ Restore Default 6th Grade List
              </button>`
            : ''
        }
        <button class="btn btn-secondary" id="resetAllProgressBtn" style="padding: 10px 18px; color: var(--danger); border-color: #fca5a5;">
          🗑️ Reset All Progress
        </button>
      </div>
    </div>
  `;

  document.getElementById('preferHumanAudioToggle')?.addEventListener('change', (e) => {
    state.settings.preferHumanAudio = e.target.checked;
    saveLocalState();
  });

  document.getElementById('soundEffectsToggle')?.addEventListener('change', (e) => {
    state.settings.soundEffects = e.target.checked;
    saveLocalState();
  });

  document.getElementById('voiceSelectDropdown')?.addEventListener('change', (e) => {
    state.settings.voiceURI = e.target.value;
    saveLocalState();
  });

  document.getElementById('testVoiceBtn')?.addEventListener('click', () => {
    speakWithTts('Welcome to Red Squiggly! Your next word is persnickety.');
  });

  document.getElementById('forceSyncNowBtn')?.addEventListener('click', async () => {
    await syncWithCloudflareKV(true);
    render();
  });

  document.getElementById('exportProgressBtn')?.addEventListener('click', () => {
    const blob = new Blob(
      [JSON.stringify({ progress: state.progress, exportedAt: new Date().toISOString() }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'red-squiggly-progress.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('uploadCsvInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseWordListCsv(text);
    if (parsed.length === 0) {
      alert('Could not find valid Level,Word rows in that CSV.');
      return;
    }
    localStorage.setItem(STORAGE_KEYS.CUSTOM_CSV, text);
    await loadWordList();
    render();
  });

  document.getElementById('restoreDefaultCsvBtn')?.addEventListener('click', async () => {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_CSV);
    await loadWordList();
    render();
  });

  document.getElementById('resetAllProgressBtn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset all practice counts and mastered words?')) return;
    state.progress = {};
    saveLocalState();
    try {
      await fetch('/api/progress', { method: 'DELETE' });
    } catch (e) {
      // ignore offline
    }
    render();
  });
}

// Start application
initApp();
