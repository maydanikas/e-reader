import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind, Menu, X, Settings2, UploadCloud, BookOpen, Volume2, Smartphone, AlertCircle, Trash2 } from 'lucide-react';

// Types
type Sentence = {
  text: string;
  chapterIdx: number;
  paraIdx: number;
  sentenceIdx: number;
  globalIdx: number;
};

type Paragraph = {
  raw: string;
  sentences: Sentence[];
  chapterIdx: number;
  paraIdx: number;
};

type Chapter = {
  id: string;
  title: string;
  level: number;
  paragraphs: Paragraph[];
};

const SAMPLE_HTML = `
<h1>Евгений Онегин — Отрывок для теста голоса</h1>
<p>Мой дядя самых честных правил, когда не в шутку занемог, он уважать себя заставил и лучше выдумать не мог. Его пример другим наука; но, боже мой, какая скука с больным сидеть и день и ночь, не отходя ни шагу прочь!</p>
<h2>Глава первая</h2>
<p>Так думал молодой повеса, летя в пыли на почтовых, всевышней волею Зевеса наследник всех своих родных. Друзья Людмилы и Руслана! С героем моего романа без предисловий, сей же час позвольте познакомить вас.</p>
<p>Онегин, добрый мой приятель, родился на брегах Невы, где, может быть, родились вы или блистали, мой читатель. Там некогда гулял и я: но вреден север для меня.</p>
<p>Служив отлично-благородно, долгами жил его отец, давал три бала ежегодно и промотался наконец. Судьба Евгения хранила: сперва Madame за ним ходила, потом Monsieur ее сменил.</p>
<h2>Глава вторая</h2>
<p>Деревня, где скучал Евгений, была прелестный уголок. Там есть такой дремотный гений, товарищ барской праздности. В глуши, во мраке заточенья тянулись тихо дни мои без божества, без вдохновенья, без слез, без жизни, без любви.</p>
<p>Я помню чудное мгновенье: передо мной явилась ты, как милое виденье, как гений чистой красоты. И сердце бьется в упоенье, и для него воскресли вновь и божество, и вдохновенье, и жизнь, и слезы, и любовь.</p>
`;

function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];
  // Use Intl.Segmenter if available
  try {
    // @ts-ignore
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      // @ts-ignore
      const segmenter = new Intl.Segmenter('ru', { granularity: 'sentence' });
      const segs = Array.from(segmenter.segment(text)) as any[];
      return segs.map((s: any) => s.segment.trim()).filter(Boolean);
    }
  } catch {}
  // fallback regex
  const m = text.match(/[^.!?]+[.!?]+[\s]*/g);
  if (m) return m.map(s => s.trim()).filter(Boolean);
  return [text.trim()];
}

function parseBookHtml(htmlString: string): { chapters: Chapter[]; flatSentences: Sentence[]; flatParagraphs: Paragraph[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  // clean script/style
  doc.querySelectorAll('script,style,noscript').forEach(el => el.remove());

  const nodes = Array.from(doc.body.querySelectorAll('h1,h2,h3,p,[data-page]')) as HTMLElement[];
  let chapters: Chapter[] = [];
  let currentChapter: Chapter | null = null;
  let paraCounter = 0;
  let globalIdx = 0;
  let flatSentences: Sentence[] = [];
  let flatParagraphs: Paragraph[] = [];

  const ensureChapter = (title = 'Начало', level = 1) => {
    if (!currentChapter) {
      currentChapter = { id: `ch-${chapters.length}`, title, level, paragraphs: [] };
      chapters.push(currentChapter);
    }
    return currentChapter;
  };

  nodes.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const title = (el.textContent || '').trim();
      if (!title) return;
      const level = parseInt(tag[1]);
      currentChapter = { id: `ch-${chapters.length}-${Date.now()}`, title, level, paragraphs: [] };
      chapters.push(currentChapter);
    } else if (tag === 'p' || el.hasAttribute('data-page')) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) return;
      if (!currentChapter) ensureChapter();
      const sentenceTexts = splitIntoSentences(raw);
      const sentences: Sentence[] = sentenceTexts.map((t, si) => {
        const s: Sentence = {
          text: t,
          chapterIdx: chapters.length - 1,
          paraIdx: paraCounter,
          sentenceIdx: si,
          globalIdx: globalIdx++,
        };
        return s;
      });
      const para: Paragraph = {
        raw,
        sentences,
        chapterIdx: chapters.length - 1,
        paraIdx: paraCounter,
      };
      flatSentences.push(...sentences);
      flatParagraphs.push(para);
      currentChapter!.paragraphs.push(para);
      paraCounter++;
    }
  });

  chapters = chapters.filter(c => c.paragraphs.length > 0);
  if (chapters.length > 0) {
    let g = 0;
    let pCounter = 0;
    flatSentences = [];
    flatParagraphs = [];
    chapters.forEach((ch, newIdx) => {
      ch.paragraphs.forEach(p => {
        p.chapterIdx = newIdx;
        p.paraIdx = pCounter++;
        p.sentences.forEach(s => {
          s.chapterIdx = newIdx;
          s.globalIdx = g++;
          flatSentences.push(s);
        });
        flatParagraphs.push(p);
      });
    });
  }

  const hasRealHeadings = nodes.some(n => ['h1','h2','h3'].includes(n.tagName.toLowerCase()) && (n.textContent||'').trim().length>0);
  if (!hasRealHeadings && flatParagraphs.length > 5) {
    const newChapters: Chapter[] = [];
    let chunkIdx = 0;
    for (let i = 0; i < flatParagraphs.length; i += 5) {
      const slice = flatParagraphs.slice(i, i + 5);
      slice.forEach(p => p.chapterIdx = chunkIdx);
      slice.forEach(p => p.sentences.forEach(s => { s.chapterIdx = chunkIdx; }));
      newChapters.push({
        id: `auto-${chunkIdx}`,
        title: `Часть ${chunkIdx + 1}`,
        level: 2,
        paragraphs: slice,
      });
      chunkIdx++;
    }
    chapters = newChapters;
  }

  if (flatParagraphs.length === 0) {
    return parseBookHtml(SAMPLE_HTML);
  }

  return { chapters, flatSentences, flatParagraphs };
}

const STATE_KEY = 'bookvoice_state';
const HTML_FALLBACK_KEY = 'bookvoice_html';
const IDB_NAME = 'bookvoice';
const IDB_VERSION = 2;
const IDB_STORE = 'kv';
const BOOKS_STORE = 'books';
const LIBRARY_KEY = 'library';
const BOOK_HTML_KEY = 'bookHtml';

type PersistedState = {
  currentIdx?: number;
  rate?: number;
  voiceName?: string;
  isDemo?: boolean;
  bookName?: string;
  activeBookId?: string;
  progress?: Record<string, number>;
};

type LibraryEntry = {
  id: string;
  name: string;
  sentenceCount: number;
  chapterCount: number;
  updatedAt: number;
};

type StoredBook = LibraryEntry & { html: string };

function bookIdFromName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() || name;
  return base.trim().toLowerCase();
}

function displayBookName(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop() || name;
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

async function idbDel(key: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

function readPersistedState(): PersistedState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function clampIdx(idx: number, total: number) {
  if (!total) return 0;
  return Math.min(Math.max(0, Math.floor(idx)), total - 1);
}

async function loadSavedBookHtml(): Promise<string | undefined> {
  const fromIdb = await idbGet<string>(BOOK_HTML_KEY);
  if (fromIdb && fromIdb.trim()) return fromIdb;
  try {
    const fallback = localStorage.getItem(HTML_FALLBACK_KEY);
    if (fallback && fallback.trim()) return fallback;
  } catch {}
  return undefined;
}

async function idbBookGet(id: string): Promise<StoredBook | undefined> {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(BOOKS_STORE, 'readonly').objectStore(BOOKS_STORE).get(id);
      req.onsuccess = () => resolve(req.result as StoredBook | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbBookPut(book: StoredBook): Promise<boolean> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readwrite');
      tx.objectStore(BOOKS_STORE).put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

async function idbBookDel(id: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readwrite');
      tx.objectStore(BOOKS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function loadLibrary(): Promise<LibraryEntry[]> {
  const list = await idbGet<LibraryEntry[]>(LIBRARY_KEY);
  return Array.isArray(list) ? list : [];
}

async function saveLibrary(entries: LibraryEntry[]): Promise<void> {
  await idbSet(LIBRARY_KEY, entries);
}

async function upsertStoredBook(
  name: string,
  html: string,
  parsed: { chapters: Chapter[]; flatSentences: Sentence[] },
): Promise<{ entry: LibraryEntry; replaced: boolean } | null> {
  const id = bookIdFromName(name);
  if (!id) return null;
  const existing = await idbBookGet(id);
  const entry: LibraryEntry = {
    id,
    name: displayBookName(name),
    sentenceCount: parsed.flatSentences.length,
    chapterCount: parsed.chapters.length,
    updatedAt: Date.now(),
  };
  const ok = await idbBookPut({ ...entry, html });
  if (!ok) return null;
  const library = await loadLibrary();
  await saveLibrary([entry, ...library.filter(item => item.id !== id)]);
  return { entry, replaced: !!existing };
}

export default function App() {
  const [bookData, setBookData] = useState<{ chapters: Chapter[]; flatSentences: Sentence[]; flatParagraphs: Paragraph[] }>(() => parseBookHtml(SAMPLE_HTML));
  const [isDemo, setIsDemo] = useState(true);
  const [bookName, setBookName] = useState('');
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [activeBookId, setActiveBookId] = useState('');
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => {
    const saved = readPersistedState().voiceName;
    return typeof saved === 'string' ? saved : '';
  });
  const [rate, setRate] = useState(1);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const isPlayingRef = useRef(false);
  const currentIdxRef = useRef(0);
  const wakeLockRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<any>(null);
  const userLoadedRef = useRef(false);
  const preferredVoiceRef = useRef(selectedVoiceName);
  const activeBookIdRef = useRef('');
  const isDemoRef = useRef(true);
  const progressMapRef = useRef<Record<string, number>>({});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const chooseVoice = useCallback((name: string) => {
    preferredVoiceRef.current = name;
    setSelectedVoiceName(name);
  }, []);

  useEffect(() => { activeBookIdRef.current = activeBookId; }, [activeBookId]);
  useEffect(() => { isDemoRef.current = isDemo; }, [isDemo]);
  useEffect(() => { progressMapRef.current = progressMap; }, [progressMap]);

  const refreshVoices = useCallback(() => {
    try {
      const synth = window.speechSynthesis;
      const v = synth.getVoices() || [];
      if (v.length) {
        setVoices(v);
        const preferred = preferredVoiceRef.current;
        if (preferred) {
          if (v.some(x => x.name === preferred)) setSelectedVoiceName(preferred);
          return v;
        }
        const ru = v.find(x => x.lang.toLowerCase().includes('ru-ru')) || v.find(x => x.lang.toLowerCase().includes('ru')) || v[0];
        if (ru) chooseVoice(ru.name);
      }
      return v;
    } catch { return []; }
  }, [chooseVoice]);

  // Load voices - initial + onvoiceschanged
  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    const handler = () => refreshVoices();
    refreshVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', handler);
    // Retry timers for Chrome async loading
    const t1 = setTimeout(refreshVoices, 200);
    const t2 = setTimeout(refreshVoices, 800);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', handler);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [refreshVoices]);

  // Restore library + active book before any writes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = readPersistedState();
      if (typeof data.rate === 'number') setRate(data.rate);
      if (typeof data.voiceName === 'string' && data.voiceName) chooseVoice(data.voiceName);

      let libraryEntries = await loadLibrary();
      const progress: Record<string, number> = (data.progress && typeof data.progress === 'object') ? { ...data.progress } : {};

      if (libraryEntries.length === 0) {
        const html = await loadSavedBookHtml();
        if (html && data.isDemo === false) {
          try {
            const parsed = parseBookHtml(html);
            if (parsed.flatSentences.length) {
              const name = (typeof data.bookName === 'string' && data.bookName) ? data.bookName : 'Книга.html';
              const saved = await upsertStoredBook(name, html, parsed);
              if (saved) {
                libraryEntries = [saved.entry];
                const idx = clampIdx(typeof data.currentIdx === 'number' ? data.currentIdx : 0, parsed.flatSentences.length);
                progress[saved.entry.id] = idx;
                await idbDel(BOOK_HTML_KEY);
                try { localStorage.removeItem(HTML_FALLBACK_KEY); } catch {}
              }
            }
          } catch {}
        }
      } else if (typeof data.currentIdx === 'number') {
        const fallbackId = data.activeBookId || (data.bookName ? bookIdFromName(data.bookName) : '');
        if (fallbackId && progress[fallbackId] == null) progress[fallbackId] = data.currentIdx;
      }

      if (cancelled) return;
      if (userLoadedRef.current) {
        setHydrated(true);
        return;
      }

      setLibrary(libraryEntries);
      setProgressMap(progress);

      const activeId = (data.activeBookId && libraryEntries.some(b => b.id === data.activeBookId))
        ? data.activeBookId
        : (data.bookName ? libraryEntries.find(b => b.id === bookIdFromName(data.bookName))?.id : undefined) || libraryEntries[0]?.id;

      if (activeId && data.isDemo !== true) {
        const stored = await idbBookGet(activeId);
        if (cancelled) return;
        if (stored?.html) {
          try {
            const parsed = parseBookHtml(stored.html);
            if (parsed.flatSentences.length) {
              const idx = clampIdx(progress[activeId] ?? data.currentIdx ?? 0, parsed.flatSentences.length);
              setBookData(parsed);
              setIsDemo(false);
              setBookName(stored.name);
              setActiveBookId(activeId);
              activeBookIdRef.current = activeId;
              isDemoRef.current = false;
              setCurrentIdx(idx);
              currentIdxRef.current = idx;
              setHydrated(true);
              return;
            }
          } catch {}
        }
      }

      const demoTotal = parseBookHtml(SAMPLE_HTML).flatSentences.length;
      const idx = clampIdx(typeof data.currentIdx === 'number' && !activeId ? data.currentIdx : 0, demoTotal);
      setCurrentIdx(idx);
      currentIdxRef.current = idx;
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [chooseVoice]);

  // Persist position and settings after restore
  useEffect(() => {
    if (!hydrated) return;
    const progress = { ...progressMap, ...progressMapRef.current };
    if (activeBookId && !isDemo) progress[activeBookId] = currentIdx;
    progressMapRef.current = progress;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        currentIdx,
        rate,
        voiceName: selectedVoiceName || preferredVoiceRef.current,
        isDemo,
        bookName,
        activeBookId,
        progress,
      } satisfies PersistedState));
    } catch {}
  }, [hydrated, currentIdx, rate, selectedVoiceName, isDemo, bookName, activeBookId, progressMap]);

  // Wake lock
  const requestWakeLock = async () => {
    try {
      // @ts-ignore
      if (navigator.wakeLock) {
        // @ts-ignore
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {}
  };
  const releaseWakeLock = async () => {
    try {
      await wakeLockRef.current?.release();
      wakeLockRef.current = null;
    } catch {}
  };

  // TTS core
  const stopSpeaking = useCallback(() => {
    try {
      synthRef.current?.cancel();
    } catch {}
    utteranceRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    releaseWakeLock();
  }, []);

  const speakAt = useCallback((idx: number, attempt = 0) => {
    const sentences = bookData.flatSentences;
    if (idx < 0 || idx >= sentences.length) {
      stopSpeaking();
      return;
    }
    const synth = window.speechSynthesis;
    // Force voices load after user gesture
    let availableVoices = synth.getVoices();
    if (availableVoices.length) {
      setVoices(availableVoices);
    } else if (attempt === 0) {
      // first attempt with empty voices - retry in 500ms
      showToast('Голоса загружаются... повтор через 0.5с');
      setTimeout(() => speakAt(idx, 1), 500);
      return;
    }
    const sent = sentences[idx];
    if (!sent) return;
    // Cancel previous only if starting fresh is handled outside, but ensure no overlap
    // Do NOT cancel here for queue - only caller cancels for first. For safety, we don't cancel between sentences.
    try {
      if (attempt === 0 && idx === currentIdxRef.current) {
        // we already canceled in play handler
      }
    } catch {}
    const utter = new SpeechSynthesisUtterance(sent.text);
    const list = availableVoices.length ? availableVoices : voices;
    let voice = list.find(v => v.name === selectedVoiceName) || list.find(v => v.lang.toLowerCase().includes('ru-ru')) || list.find(v => v.lang.toLowerCase().includes('ru')) || list[0];
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'ru-RU';
    }
    utter.rate = Math.min(2, Math.max(0.8, rate));
    utter.pitch = 1;
    utter.volume = 1;

    utter.onstart = () => {
      currentIdxRef.current = idx;
      setCurrentIdx(idx);
      // highlight + scroll is handled by effect
    };
    utter.onend = () => {
      if (!isPlayingRef.current) return;
      const next = idx + 1;
      if (next < sentences.length) {
        currentIdxRef.current = next;
        setCurrentIdx(next);
        // queue next sentence after small delay to avoid clipping
        setTimeout(() => speakAt(next, 0), 40);
      } else {
        stopSpeaking();
        showToast('Конец книги');
      }
    };
    utter.onerror = (e: any) => {
      console.error('TTS error', e);
      const err = e?.error || 'unknown';
      if (err === 'canceled' || err === 'interrupted') return;
      showToast(`Ошибка озвучки: ${err}`);
      if (isPlayingRef.current) {
        const next = idx + 1;
        if (next < sentences.length) {
          currentIdxRef.current = next;
          setCurrentIdx(next);
          setTimeout(() => speakAt(next, 0), 300);
        } else {
          stopSpeaking();
        }
      }
    };
    utteranceRef.current = utter;
    try {
      synthRef.current = synth;
      synth.speak(utter);
    } catch (err) {
      console.error(err);
      showToast('Не удалось запустить озвучку');
      stopSpeaking();
    }
  }, [bookData.flatSentences, voices, selectedVoiceName, rate, stopSpeaking, showToast]);

  const handlePlayPause = useCallback(async () => {
    const synth = window.speechSynthesis;
    synthRef.current = synth;
    // MUST call getVoices after user gesture per spec
    const vs = synth.getVoices();
    if (vs.length) setVoices(vs);

    if (isPlayingRef.current && synth.speaking && !synth.paused) {
      // pause playback
      try {
        synth.pause();
      } catch {
        stopSpeaking();
        return;
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      releaseWakeLock();
      return;
    }
    if (synth.paused) {
      try {
        synth.resume();
        isPlayingRef.current = true;
        setIsPlaying(true);
        requestWakeLock();
        return;
      } catch {}
    }
    // start new queue
    try { synth.cancel(); } catch {}
    // small delay to let cancel finish on some browsers
    setTimeout(() => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      currentIdxRef.current = currentIdx;
      speakAt(currentIdx, 0);
      requestWakeLock();
    }, 60);
  }, [currentIdx, speakAt, stopSpeaking]);

  // Sync ref with state
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);

  // Auto scroll highlight
  useEffect(() => {
    const el = document.querySelector(`[data-global-idx="${currentIdx}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentIdx]);

  // Keyboard space
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'SELECT') {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePlayPause]);

  // Before install prompt
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const res = await installPrompt.userChoice;
      if (res.outcome === 'accepted') setInstallPrompt(null);
    } else {
      setShowInstallHelp(true);
    }
  };

  // File handling
  const rememberCurrentProgress = useCallback(() => {
    const id = activeBookIdRef.current;
    if (!id || isDemoRef.current) return;
    const idx = currentIdxRef.current;
    progressMapRef.current = { ...progressMapRef.current, [id]: idx };
    setProgressMap(prev => (prev[id] === idx ? prev : { ...prev, [id]: idx }));
  }, []);

  const openStoredBook = useCallback(async (id: string, preferIdx?: number) => {
    const stored = await idbBookGet(id);
    if (!stored?.html) {
      showToast('Не удалось открыть книгу');
      return false;
    }
    try {
      const parsed = parseBookHtml(stored.html);
      if (!parsed.flatSentences.length) {
        showToast('В книге нет текста');
        return false;
      }
      const idx = clampIdx(preferIdx ?? 0, parsed.flatSentences.length);
      userLoadedRef.current = true;
      setBookData(parsed);
      setIsDemo(false);
      isDemoRef.current = false;
      setBookName(stored.name);
      setActiveBookId(id);
      activeBookIdRef.current = id;
      setCurrentIdx(idx);
      currentIdxRef.current = idx;
      setProgressMap(prev => ({ ...prev, [id]: idx }));
      stopSpeaking();
      setShowToc(false);
      return true;
    } catch {
      showToast('Ошибка парсинга HTML');
      return false;
    }
  }, [showToast, stopSpeaking]);

  const loadHtmlFiles = useCallback(async (files: File[]) => {
    const htmlFiles = files.filter(Boolean);
    if (!htmlFiles.length) {
      showToast('Файл не выбран');
      return;
    }
    rememberCurrentProgress();

    let added = 0;
    let updated = 0;
    let last: { entry: LibraryEntry; replaced: boolean; parsed: ReturnType<typeof parseBookHtml>; keepIdx: number } | null = null;

    for (const file of htmlFiles) {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.html') && !lower.endsWith('.htm')) {
        showToast(`Пропущен файл: ${file.name}`);
      }
      let text = '';
      try {
        text = await file.text();
      } catch {
        showToast(`Ошибка чтения: ${file.name}`);
        continue;
      }
      if (!text || text.trim().length < 20) {
        showToast(`Файл пустой: ${file.name}`);
        continue;
      }
      let parsed: ReturnType<typeof parseBookHtml>;
      try {
        parsed = parseBookHtml(text);
      } catch {
        showToast(`Ошибка парсинга: ${file.name}`);
        continue;
      }
      if (!parsed.flatSentences.length) {
        showToast(`Нет текста: ${file.name}`);
        continue;
      }
      const saved = await upsertStoredBook(file.name, text, parsed);
      if (!saved) {
        showToast(`Не удалось сохранить: ${file.name}`);
        continue;
      }
      const isCurrent = saved.entry.id === activeBookIdRef.current && !isDemoRef.current;
      const previousIdx = isCurrent
        ? currentIdxRef.current
        : (progressMapRef.current[saved.entry.id] ?? 0);
      const keepIdx = saved.replaced ? clampIdx(previousIdx, parsed.flatSentences.length) : 0;
      if (saved.replaced) updated += 1;
      else added += 1;
      last = { entry: saved.entry, replaced: saved.replaced, parsed, keepIdx };
      setLibrary(prev => [saved.entry, ...prev.filter(item => item.id !== saved.entry.id)]);
      progressMapRef.current = { ...progressMapRef.current, [saved.entry.id]: keepIdx };
      setProgressMap(prev => ({ ...prev, [saved.entry.id]: keepIdx }));
    }

    if (!last) return;

    userLoadedRef.current = true;
    setBookData(last.parsed);
    setIsDemo(false);
    isDemoRef.current = false;
    setBookName(last.entry.name);
    setActiveBookId(last.entry.id);
    activeBookIdRef.current = last.entry.id;
    setCurrentIdx(last.keepIdx);
    currentIdxRef.current = last.keepIdx;
    stopSpeaking();
    setShowToc(false);

    if (htmlFiles.length === 1) {
      showToast(last.replaced
        ? `Обновлено: ${last.entry.name}. Место чтения сохранено.`
        : `В библиотеке: ${last.entry.name} — ${last.entry.chapterCount} гл., ${last.entry.sentenceCount} предл.`);
    } else {
      showToast(`Библиотека: ${added ? `+${added} новых` : 'без новых'}${updated ? `, ${updated} обновлено` : ''}`);
    }
  }, [rememberCurrentProgress, showToast, stopSpeaking]);

  const openLibraryBook = useCallback(async (id: string) => {
    if (id === activeBookIdRef.current && !isDemoRef.current) {
      setShowToc(false);
      return;
    }
    rememberCurrentProgress();
    await openStoredBook(id, progressMapRef.current[id]);
  }, [openStoredBook, rememberCurrentProgress]);

  const deleteLibraryBook = useCallback(async (id: string) => {
    await idbBookDel(id);
    const remaining = (await loadLibrary()).filter(item => item.id !== id);
    await saveLibrary(remaining);
    setLibrary(remaining);
    setProgressMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (id === activeBookIdRef.current) {
      stopSpeaking();
      if (remaining[0]) {
        await openStoredBook(remaining[0].id, progressMapRef.current[remaining[0].id] ?? 0);
        showToast(`Открыта: ${remaining[0].name}`);
      } else {
        setBookData(parseBookHtml(SAMPLE_HTML));
        setIsDemo(true);
        isDemoRef.current = true;
        setBookName('');
        setActiveBookId('');
        activeBookIdRef.current = '';
        setCurrentIdx(0);
        currentIdxRef.current = 0;
        showToast('Книга удалена');
      }
    } else {
      showToast('Книга удалена из библиотеки');
    }
  }, [openStoredBook, showToast, stopSpeaking]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length) void loadHtmlFiles(Array.from(list));
    e.target.value = '';
  }, [loadHtmlFiles]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const list = e.dataTransfer.files;
    if (list && list.length) void loadHtmlFiles(Array.from(list));
    else showToast('Перетащите .html файл');
  };

  const total = bookData.flatSentences.length;
  const progress = total ? (currentIdx / total) * 100 : 0;

  const currentChapterIdx = bookData.flatSentences[currentIdx]?.chapterIdx ?? 0;
  const currentParaIdx = bookData.flatSentences[currentIdx]?.paraIdx ?? 0;

  const speedOptions = [0.8, 1, 1.2, 1.5, 1.8, 2];

  // Service worker placeholder + manifest injection
  useEffect(() => {
    // Manifest
    try {
      const manifest = {
        name: "BookVoice - PWA плеер для твоего html",
        short_name: "BookVoice",
        start_url: ".",
        display: "standalone",
        background_color: "#fdf8f0",
        theme_color: "#ff6b35",
        icons: [
          { src: "/bookvoice-icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/bookvoice-icon.png", sizes: "512x512", type: "image/png", purpose: "any" }
        ]
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.appendChild(link);
      }
      link.href = url;
    } catch {}

    // SW placeholder - best effort
    if ('serviceWorker' in navigator) {
      try {
        const swCode = `
          self.addEventListener('install', e => self.skipWaiting());
          self.addEventListener('activate', e => self.clients.claim());
          self.addEventListener('fetch', e => {});
        `;
        const blob = new Blob([swCode], { type: 'text/javascript' });
        const swUrl = URL.createObjectURL(blob);
        navigator.serviceWorker.register(swUrl).catch(()=>{});
      } catch {}
    }
  }, []);

  const groupedVoices = useMemo(() => {
    const ru = voices.filter(v => v.lang.toLowerCase().startsWith('ru'));
    const en = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
    const other = voices.filter(v => !v.lang.toLowerCase().startsWith('ru') && !v.lang.toLowerCase().startsWith('en'));
    return [...ru, ...en, ...other];
  }, [voices]);

  return (
    <div className="min-h-[100dvh] bg-[#fdf8f0] text-[#1a1a1a] flex flex-col selection:bg-[#ff6b35]/20">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&family=Manrope:wght@500;700&display=swap');
        .serif { font-family: 'Merriweather', Georgia, serif; }
        .sans { font-family: 'Manrope', system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #e7ddd0; border-radius: 999px; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#fdf8f0]/90 backdrop-blur-xl border-b border-[#e7ddd0]">
        <div className="max-w-[1100px] mx-auto px-4 md:px-6 h-[64px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={()=>setShowToc(true)} className="sans md:hidden w-11 h-11 rounded-full bg-white shadow-sm border border-[#e7ddd0] flex items-center justify-center active:scale-95">
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2.5">
              <img src="/bookvoice-icon.png" alt="" className="w-9 h-9 rounded-[11px] shadow-[0_4px_12px_rgba(255,107,53,0.35)]" />
              <div className="leading-tight">
                <div className="sans font-bold text-[18px] tracking-[-0.02em]">BookVoice</div>
                <div className="sans text-[11px] text-[#8c7e6f] tracking-wide -mt-[1px]">PWA плеер для твоего html • {voices.length} голосов</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={()=>setShowToc(true)} className="hidden md:flex sans h-9 px-3.5 rounded-full bg-white border border-[#e7ddd0] text-[13px] font-medium items-center gap-2 hover:bg-[#fff7ef] transition">
              <BookOpen size={16}/> Оглавление
            </button>
            <button type="button" onClick={()=>setShowSettings(v=>!v)} className="sans w-11 h-11 md:w-9 md:h-9 rounded-full bg-white border border-[#e7ddd0] flex items-center justify-center hover:bg-[#fff7ef] active:scale-95">
              <Settings2 size={18}/>
            </button>
            <button type="button" onClick={handleInstallClick} className="hidden sm:flex sans h-9 px-3.5 rounded-full bg-[#1a1a1a] text-white text-[13px] font-medium items-center gap-1.5 hover:bg-black active:scale-95">
              <Smartphone size={14}/> Установить
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 w-full max-w-[1100px] mx-auto flex">
        {/* TOC desktop */}
        <aside className="hidden md:block w-[280px] shrink-0 sticky top-[64px] h-[calc(100dvh-64px-88px)] overflow-y-auto p-4 pr-2">
          <div className="rounded-[20px] bg-white border border-[#e7ddd0] shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-3">
            <div className="sans text-[11px] font-bold tracking-widest text-[#8c7e6f] px-2 py-2">ОГЛАВЛЕНИЕ</div>
          <div className="space-y-1">
              {bookData.chapters.map((ch, idx) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={()=>{
                    let firstIdx = bookData.flatSentences.findIndex(s=>s.chapterIdx===idx);
                    if (firstIdx<0) firstIdx = 0;
                    if (firstIdx === currentIdx) {
                      const nextInChapter = bookData.flatSentences.findIndex((s, i) => i > firstIdx && s.chapterIdx === idx);
                      if (nextInChapter >= 0) {
                        setCurrentIdx(nextInChapter);
                      } else {
                        const el = document.querySelector(`[data-global-idx="${firstIdx}"]`) as HTMLElement | null;
                        if (el) {
                          el.classList.add('!bg-[#ff6b35]/30');
                          setTimeout(()=>el.classList.remove('!bg-[#ff6b35]/30'), 300);
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }
                    } else {
                      setCurrentIdx(firstIdx);
                    }
                    stopSpeaking();
                    const el = document.querySelector(`#${ch.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl sans text-[13px] leading-[1.3] transition flex gap-2 min-h-[44px] items-start ${currentChapterIdx===idx ? 'bg-[#ff6b35] text-white shadow' : 'hover:bg-[#fdf8f0] text-[#3d3229]'}`}
                >
                  <span className={`mt-[2px] w-1.5 h-1.5 rounded-full shrink-0 ${currentChapterIdx===idx ? 'bg-white' : 'bg-[#ff6b35]/60'}`} />
                  <span className="line-clamp-2">{ch.title}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 p-3 rounded-xl bg-[#fdf8f0] border border-[#e7ddd0] sans">
              <div className="text-[12px] text-[#8c7e6f]">Всего предложений</div>
              <div className="text-[20px] font-bold tracking-tight">{total}</div>
              <div className="text-[11px] text-[#8c7e6f] mt-1">голосов загружено: {voices.length}</div>
            </div>
          </div>
        </aside>

        {/* Reader */}
        <main ref={readerContainerRef} className="flex-1 min-w-0 pb-[140px]">
          {/* Loader */}
          <div className="p-4 md:p-6">
            <div
              onDragOver={e=>{e.preventDefault(); setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-[24px] border-2 border-dashed bg-white p-5 md:p-6 flex flex-col md:flex-row items-center gap-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition ${dragOver ? 'border-[#ff6b35] bg-[#fff3ec]' : 'border-[#e7ddd0]'}`}
            >
              <div className="w-14 h-14 rounded-2xl bg-[#fdf8f0] border border-[#e7ddd0] grid place-items-center shrink-0">
                <UploadCloud className="text-[#ff6b35]" />
              </div>
              <div className="flex-1 text-center md:text-left">
                <div className="sans font-bold text-[15px]">{isDemo ? 'Демо книга загружена — протестируй голос' : (bookName ? `Сейчас: ${bookName}` : 'Книга загружена — можно читать')}</div>
                <div className="sans text-[13px] text-[#8c7e6f] mt-1">Перетащи один или несколько .html. Файл с тем же именем обновит книгу и оставит место чтения.</div>
                <div className="mt-2 flex flex-wrap gap-2 justify-center md:justify-start">
                  {isDemo && <div className="inline-flex sans text-[11px] px-2 py-1 rounded-full bg-[#ff6b35]/10 text-[#ff6b35] font-bold">DEMO MODE</div>}
                  <div className="inline-flex sans text-[11px] px-2 py-1 rounded-full bg-[#1a1a1a] text-white/80">голосов: {voices.length} • {groupedVoices[0]?.lang || 'loading'}</div>
                </div>
              </div>
              <div className="flex gap-2 w-full md:w-auto flex-col">
                <label htmlFor="book-file-input" className="sans flex-1 md:flex-none h-11 px-5 rounded-full bg-[#1a1a1a] text-white text-[14px] font-medium hover:bg-black active:scale-[0.98] transition flex items-center justify-center gap-2 cursor-pointer">
                  Загрузить HTML книги
                </label>
                <button type="button" onClick={()=>fileInputRef.current?.click()} className="sans md:hidden h-10 px-4 rounded-full bg-white border border-[#e7ddd0] text-[13px]">или выбрать файлы</button>
              </div>
              {/* Primary file input with proper id and label */}
              <input id="book-file-input" ref={fileInputRef} type="file" accept=".html,.htm,text/html" multiple className="hidden" onChange={handleFileChange} />
              {/* Second hidden input for fallback */}
              <input id="book-file-input-2" ref={fileInputRef2} type="file" accept=".html,.htm" multiple className="sr-only" tabIndex={-1} onChange={handleFileChange} />
            </div>
            {library.length > 0 && (
              <div className="mt-4 rounded-[24px] bg-white border border-[#e7ddd0] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                <div className="sans text-[11px] font-bold tracking-widest text-[#8c7e6f] mb-3">БИБЛИОТЕКА • {library.length}</div>
                <div className="space-y-1">
                  {library.map(book => {
                    const active = book.id === activeBookId && !isDemo;
                    const idx = active ? currentIdx : (progressMap[book.id] ?? 0);
                    return (
                      <div
                        key={book.id}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${active ? 'bg-[#ff6b35] text-white shadow' : 'hover:bg-[#fdf8f0] text-[#3d3229]'}`}
                      >
                        <button type="button" onClick={()=>{ void openLibraryBook(book.id); }} className="flex-1 text-left min-w-0">
                          <div className="sans text-[14px] font-bold truncate">{book.name}</div>
                          <div className={`sans text-[11px] mt-[2px] ${active ? 'text-white/80' : 'text-[#8c7e6f]'}`}>
                            {book.chapterCount} гл. • {Math.min(idx + 1, book.sentenceCount)} / {book.sentenceCount} предл.
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={()=>{ void deleteLibraryBook(book.id); }}
                          className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${active ? 'bg-white/15 hover:bg-white/25' : 'bg-[#fdf8f0] border border-[#e7ddd0] hover:bg-white'}`}
                          aria-label={`Удалить ${book.name}`}
                        >
                          <Trash2 size={16}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Text */}
          <div className="px-5 md:px-8">
            <div className="mx-auto max-w-[700px]">
              {bookData.chapters.map((ch, chIdx) => (
                <div key={ch.id} className="mb-10">
                  <h2 id={ch.id} className="serif text-[28px] md:text-[34px] font-bold tracking-[-0.02em] leading-[1.15] mt-10 mb-6">
                    {ch.title}
                  </h2>
                  <div className="space-y-6">
                    {ch.paragraphs.map((para) => {
                      const isActivePara = para.chapterIdx === currentChapterIdx && para.paraIdx === currentParaIdx;
                      return (
                        <p
                          key={`${ch.id}-${para.paraIdx}`}
                          className={`serif text-[18px] leading-[1.85] tracking-[-0.01em] px-3 py-2 rounded-xl transition ${isActivePara ? 'bg-white shadow-[0_2px_16px_rgba(0,0,0,0.04)] border border-[#efe6d9]' : ''}`}
                        >
                          {para.sentences.map((s) => {
                            const isActive = s.globalIdx === currentIdx;
                            return (
                              <span
                                key={s.globalIdx}
                                data-global-idx={s.globalIdx}
                                onClick={()=>{ setCurrentIdx(s.globalIdx); currentIdxRef.current = s.globalIdx; stopSpeaking(); }}
                                className={`cursor-pointer rounded-[6px] px-[1px] transition ${isActive ? 'bg-[#ff6b35] text-white shadow-[0_1px_8px_rgba(255,107,53,0.4)] active-sentence' : 'hover:bg-[#ff6b35]/10'}`}
                              >
                                {s.text}{' '}
                              </span>
                            );
                          })}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="serif text-[14px] text-[#8c7e6f] text-center py-12">Конец книги • {total} предложений • листай вверх для загрузки новой • voices: {voices.length}</div>
            </div>
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-[110px] left-1/2 -translate-x-1/2 z-[70] max-w-[90vw]">
          <div className="sans flex items-center gap-2 px-4 py-3 rounded-full bg-[#1a1a1a] text-white text-[13px] shadow-xl border border-white/10">
            <AlertCircle size={16} className="text-[#ff6b35] shrink-0"/>
            <span>{toast}</span>
            <button type="button" onClick={()=>setToast(null)} className="ml-2 w-6 h-6 rounded-full bg-white/10 grid place-items-center"><X size={12}/></button>
          </div>
        </div>
      )}

      {/* Bottom Player */}
      <div className="fixed bottom-0 inset-x-0 z-40">
        <div className="mx-auto max-w-[1100px] px-3 md:px-6 pb-[max(14px,env(safe-area-inset-bottom))] w-full box-border">
          <div className="rounded-[24px] bg-[#1a1a1a] text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] border border-white/10 overflow-hidden">
            {/* progress */}
            <div className="h-[4px] bg-white/10 w-full relative">
              <div className="absolute left-0 top-0 h-full bg-[#ff6b35] transition-all" style={{ width: `${progress}%` }} />
              <input
                type="range"
                min={0}
                max={Math.max(0, total-1)}
                value={currentIdx}
                onChange={e=>{ const v=parseInt(e.target.value); setCurrentIdx(v); currentIdxRef.current=v; if(isPlaying) { stopSpeaking(); setTimeout(()=>{ setCurrentIdx(v); }, 30);} }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2.5 md:gap-4 px-3 md:px-5 py-3.5 w-full max-w-full overflow-hidden">
              <button type="button" onClick={()=>{ const firstInPrev = bookData.flatSentences.findLastIndex(s=> s.paraIdx < currentParaIdx); const target = firstInPrev>=0 ? firstInPrev : Math.max(0, currentIdx-1); setCurrentIdx(target); currentIdxRef.current=target; if(isPlaying) { stopSpeaking(); setTimeout(()=>speakAt(target,0), 80);} }} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/15 grid place-items-center active:scale-95 shrink-0">
                <Rewind size={18}/>
              </button>
              <button type="button" onClick={()=>{ const prev = Math.max(0, currentIdx-1); setCurrentIdx(prev); currentIdxRef.current=prev; if(isPlaying) { stopSpeaking(); setTimeout(()=>speakAt(prev,0), 60);} }} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/15 grid place-items-center active:scale-95 shrink-0">
                <SkipBack size={18}/>
              </button>
              <button type="button" onClick={handlePlayPause} className="w-[56px] h-[56px] rounded-full bg-[#ff6b35] text-white grid place-items-center shadow-[0_6px_20px_rgba(255,107,53,0.5)] active:scale-95 transition shrink-0">
                {isPlaying ? <Pause size={26} fill="white"/> : <Play size={26} fill="white" className="ml-[3px]"/>}
              </button>
              <button type="button" onClick={()=>{ const next = Math.min(total-1, currentIdx+1); setCurrentIdx(next); currentIdxRef.current=next; if(isPlaying) { stopSpeaking(); setTimeout(()=>speakAt(next,0), 60);} }} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/15 grid place-items-center active:scale-95 shrink-0">
                <SkipForward size={18}/>
              </button>

              <div className="hidden md:flex items-center gap-3 ml-2 pl-4 border-l border-white/10">
                <div className="sans text-[12px] text-white/60 leading-none">Скорость</div>
                <div className="flex gap-1">
                  {speedOptions.map(sp => (
                    <button type="button" key={sp} onClick={()=>setRate(sp)} className={`sans h-8 px-2.5 rounded-full text-[12px] font-bold transition ${rate===sp ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}>{sp}x</button>
                  ))}
                </div>
              </div>

              <div className="flex-1 md:hidden flex flex-col items-end gap-1.5 min-w-0">
                <div className="sans text-[11px] text-white/60 shrink-0">{currentIdx+1} / {total}</div>
                <div className="flex gap-1 shrink-0">
                  {speedOptions.slice(0,3).map(sp=>(
                    <button type="button" key={sp} onClick={()=>setRate(sp)} className={`sans h-6 px-2 rounded-full text-[10px] font-bold min-w-[36px] ${rate===sp ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>{sp}x</button>
                  ))}
                </div>
              </div>

              <div className="hidden md:flex flex-1 justify-end items-center gap-3">
                <div className="sans text-[12px] text-white/50">{bookData.chapters[currentChapterIdx]?.title?.slice(0,32) || ''}</div>
                <div className="sans text-[12px] bg-white/10 px-2.5 py-1 rounded-full">{currentIdx+1} / {total}</div>
              </div>
            </div>
            {/* mobile extra progress label */}
            <div className="md:hidden px-4 pb-3 -mt-1 flex items-center justify-between gap-3">
              <div className="sans text-[11px] text-white/40 truncate max-w-[60%]">{bookData.chapters[currentChapterIdx]?.title} • {voices.length} голосов</div>
              <div className="sans text-[11px] text-white/40 shrink-0">{Math.round(progress)}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* TOC Drawer */}
      {showToc && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={()=>setShowToc(false)} />
          <div className="w-[88%] max-w-[360px] bg-[#fdf8f0] h-full shadow-2xl border-l border-[#e7ddd0] flex flex-col animate-[slideIn_0.25s_ease]">
            <div className="h-[64px] px-5 flex items-center justify-between border-b border-[#e7ddd0]">
              <div className="sans font-bold">Оглавление</div>
              <button type="button" onClick={()=>setShowToc(false)} className="w-9 h-9 rounded-full bg-white border border-[#e7ddd0] grid place-items-center"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {bookData.chapters.map((ch, idx) => (
                <button type="button" key={ch.id} onClick={()=>{ 
                  let first = bookData.flatSentences.findIndex(s=>s.chapterIdx===idx); 
                  if(first<0) first=0;
                  const nextInChapter = bookData.flatSentences.findIndex((s,i)=> i>first && s.chapterIdx===idx);
                  const target = (first===currentIdx && nextInChapter>=0) ? nextInChapter : first;
                  setCurrentIdx(target);
                  currentIdxRef.current=target;
                  stopSpeaking(); setShowToc(false);
                  setTimeout(()=>{ document.querySelector(`#${ch.id}`)?.scrollIntoView({ behavior: 'smooth' }); }, 100);
                }} className={`w-full text-left px-4 py-3.5 rounded-xl sans text-[14px] flex gap-2.5 min-h-[48px] ${currentChapterIdx===idx ? 'bg-[#1a1a1a] text-white' : 'bg-white border border-[#e7ddd0]'}`}>
                  <span className="opacity-60 mt-[2px]">{String(idx+1).padStart(2,'0')}</span> <span className="line-clamp-2 leading-[1.4]">{ch.title}</span>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-[#e7ddd0] space-y-3">
              <label htmlFor="book-file-input" className="w-full h-12 rounded-full bg-[#ff6b35] text-white sans font-medium flex items-center justify-center cursor-pointer">Загрузить книги</label>
              <button type="button" onClick={handleInstallClick} className="w-full h-12 rounded-full bg-white border border-[#e7ddd0] sans text-[13px] flex items-center justify-center gap-2"><Smartphone size={16}/> Установить на главный экран</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={()=>setShowSettings(false)} />
          <div className="relative w-full md:max-w-[440px] bg-white rounded-t-[28px] md:rounded-[28px] shadow-2xl border border-[#e7ddd0] p-6 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2"><Volume2 size={18}/><span className="sans font-bold">Настройки голоса</span></div>
              <button type="button" onClick={()=>setShowSettings(false)} className="w-8 h-8 rounded-full bg-[#fdf8f0] border border-[#e7ddd0] grid place-items-center"><X size={16}/></button>
            </div>

            <div className="space-y-6">
              <div>
                <div className="sans text-[12px] font-bold tracking-widest text-[#8c7e6f] mb-2">ГОЛОС • загружено: {voices.length}</div>
                <select value={selectedVoiceName} onChange={e=>chooseVoice(e.target.value)} className="w-full h-12 rounded-xl bg-[#fdf8f0] border border-[#e7ddd0] px-3 sans text-[14px]">
                  {groupedVoices.length===0 && <option>Загрузка голосов...</option>}
                  {selectedVoiceName && !groupedVoices.some(v => v.name === selectedVoiceName) && (
                    <option value={selectedVoiceName}>{selectedVoiceName} — сохранённый</option>
                  )}
                  {groupedVoices.map(v=>(
                    <option key={v.name+v.lang} value={v.name}>{v.name} — {v.lang} {v.default ? '(default)' : ''}</option>
                  ))}
                </select>
                <div className="sans text-[11px] text-[#8c7e6f] mt-2">Debug: voices count = {voices.length}. Нажми Play чтобы вызвать getVoices() после жеста. Совет: для русского выбери голос с ru-RU. На iOS доступен только один голос, но он качественный. На Android/Chrome список шире.</div>
                <button type="button" onClick={()=>{ const vs=refreshVoices(); showToast(`Голосов: ${vs.length}`); }} className="mt-2 sans h-8 px-3 rounded-full bg-[#fdf8f0] border border-[#e7ddd0] text-[12px]">Обновить список голосов</button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="sans text-[12px] font-bold tracking-widest text-[#8c7e6f]">СКОРОСТЬ</div>
                  <div className="sans text-[13px] font-bold bg-[#1a1a1a] text-white px-2.5 py-1 rounded-full">{rate}x</div>
                </div>
                <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={e=>setRate(parseFloat(e.target.value))} className="w-full accent-[#ff6b35] h-2" />
                <div className="flex justify-between sans text-[11px] text-[#8c7e6f] mt-1"><span>0.5x медленно</span><span>2x быстро</span></div>
                <div className="flex gap-1 mt-3 flex-wrap">
                  {speedOptions.map(sp=>(
                    <button type="button" key={sp} onClick={()=>setRate(sp)} className={`sans h-8 px-3 rounded-full text-[12px] font-bold border ${rate===sp ? 'bg-[#ff6b35] text-white border-[#ff6b35]' : 'bg-white border-[#e7ddd0] text-[#3d3229]'}`}>{sp}x</button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-[#fdf8f0] border border-[#e7ddd0] p-4 sans">
                <div className="text-[13px] font-bold mb-1">Как это работает</div>
                <ul className="text-[12px] text-[#6b5e52] space-y-1 list-disc pl-4">
                  <li>Мы разбиваем параграф на предложения через Intl.Segmenter</li>
                  <li>Каждое предложение озвучивается по очереди через onend</li>
                  <li>Текущее предложение подсвечивается и скроллится smooth</li>
                  <li>Книги хранятся в библиотеке. Файл с тем же именем обновляет книгу и оставляет место чтения</li>
                  <li>При воспроизведении пробуем Wake Lock чтобы экран не гас</li>
                  <li>Работает offline, это PWA</li>
                </ul>
              </div>

              <button type="button" onClick={()=>{
                stopSpeaking();
                setCurrentIdx(0);
                currentIdxRef.current = 0;
                if (activeBookId) {
                  progressMapRef.current = { ...progressMapRef.current, [activeBookId]: 0 };
                  setProgressMap(prev => ({ ...prev, [activeBookId]: 0 }));
                }
                setShowSettings(false);
                showToast('Прогресс текущей книги сброшен');
              }} className="w-full h-11 rounded-full bg-[#fdf8f0] border border-[#e7ddd0] sans text-[13px]">Сбросить прогресс</button>
            </div>
          </div>
        </div>
      )}

      {/* Install help modal */}
      {showInstallHelp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={()=>setShowInstallHelp(false)} />
          <div className="relative bg-white rounded-[24px] max-w-[380px] w-full p-6 shadow-2xl border border-[#e7ddd0]">
            <div className="sans font-bold text-[18px] mb-2">Установить BookVoice</div>
            <div className="sans text-[13px] text-[#6b5e52] leading-[1.5] space-y-2">
              <p><b>iOS Safari:</b> Нажми Поделиться → «На экран Домой».</p>
              <p><b>Android Chrome:</b> Меню ⋮ → «Установить приложение».</p>
              <p><b>Desktop:</b> Иконка установки в адресной строке.</p>
            </div>
            <button type="button" onClick={()=>setShowInstallHelp(false)} className="mt-4 w-full h-11 rounded-full bg-[#1a1a1a] text-white sans font-medium">Понятно</button>
          </div>
        </div>
      )}

      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
