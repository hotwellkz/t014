# Инструкция по деплою фронтенда на Netlify

## Текущая конфигурация

Проект настроен для деплоя на Netlify через файл `netlify.toml`:

```toml
[build]
  base = "frontend"
  command = "npm install && npm run build"
  publish = "dist"
```

## Настройки в Netlify Dashboard

Убедитесь, что в настройках сайта (Site settings → Build & deploy → Build settings) указано:

- **Base directory**: `frontend` (или оставьте пустым, если используется netlify.toml)
- **Build command**: `npm install && npm run build` (или оставьте пустым, если используется netlify.toml)
- **Publish directory**: `frontend/dist` (или `dist`, если base = "frontend")

**Важно**: Если в netlify.toml указан `base = "frontend"`, то publish должен быть просто `dist` (относительно frontend).

## Переменные окружения

В Netlify Dashboard (Site settings → Environment variables) должны быть установлены следующие переменные:

### Обязательные для Firebase:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (опционально)
- `VITE_FIREBASE_VAPID_KEY` (для FCM уведомлений)

### Опциональные:
- `VITE_API_URL` - URL бэкенда (если не указан, запросы идут относительно домена фронтенда)

## SPA Redirect

В `netlify.toml` настроен redirect для SPA:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Это гарантирует, что все маршруты (/, /jobs, /settings, /automation-debug) будут отдавать index.html.

## Проверка деплоя

После деплоя проверьте:

1. ✅ Деплой завершился успешно (зелёный статус)
2. ✅ В разделе "Deploys" видно опубликованную сборку
3. ✅ https://shortai.ru открывается без 404
4. ✅ GET /index.html возвращает 200 (проверьте в DevTools)
5. ✅ Навигация по страницам работает (SPA routing)

## Локальная проверка билда

Перед деплоем можно проверить билд локально:

```bash
cd frontend
npm install
npm run build
```

После этого в `frontend/dist` должны появиться:
- `index.html`
- `assets/` (CSS и JS файлы)
- `firebase-messaging-sw.js` (если есть в public/)

## Устранение проблем

### 404 на главной странице

1. Проверьте, что `publish` в netlify.toml указывает на правильную папку
2. Убедитесь, что redirect настроен правильно
3. Проверьте, что в Netlify Dashboard publish directory совпадает с netlify.toml

### Ошибки билда

1. Проверьте, что все переменные окружения установлены
2. Убедитесь, что `npm install` выполняется перед `npm run build`
3. Проверьте логи деплоя в Netlify Dashboard

### API запросы не работают

1. Убедитесь, что `VITE_API_URL` установлен и указывает на правильный backend URL
2. Проверьте CORS настройки на backend
3. Проверьте, что backend доступен по указанному URL


