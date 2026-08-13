# BookVoice PWA

Простой PWA плеер для чтения HTML книг вслух через Web Speech API.

## Структура
- `App.tsx` — исходник React приложения
- `index.html` — точка входа Vite
- `index.standalone.html` — старый однофайловый билд (можно открыть прямо в браузере)
- `index_v1.html` — первая версия

## Запуск в Cursor
1. `npm install`
2. `npm run dev`
3. Открой в Chrome/Edge адрес, который покажет Vite (обычно `http://localhost:5173`)

TTS лучше всего работает в Chrome. Нажми Play, чтобы загрузились голоса.

## Сборка
`npm run build` — результат в папке `dist`.

## Что чинить (баги)
- Загрузка файла: input file не триггерится в некоторых webview
- TTS: speechSynthesis.getVoices() пустой до user gesture
