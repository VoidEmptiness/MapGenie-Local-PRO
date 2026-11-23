# MapGenie Local PRO (ViolentMonkey)

UserScript для [mapgenie.io](https://mapgenie.io/), который разблокирует PRO-функции без подписки и хранит все данные **только в вашем браузере** (в `localStorage`). Никаких запросов к `/api/v1/user/*` не уходит на сервер.

## Что даёт

- Отметки «Found» (Found locations) — сохраняются после перезагрузки страницы.
- Неограниченное количество отмеченных локаций, категорий и заметок.
- Создание и переключение профилей (map profiles).
- Пресеты (фильтры) — сохраняются локально.
- Отслеживание категорий.
- Полностью убран апселл: «Upgrade to PRO», «Go pro to track more than 2 categories…», «PRO Features», подсказка «Tip: Right click a location to mark it found», блок «Ad Blocker? Consider an upgrade to PRO…».
- Панель «MapGenie Local» с импортом/экспортом данных.

## Установка

1. Установите расширение [ViolentMonkey](https://violentmonkey.github.io/) (Chrome/Firefox/Edge).
2. Откройте файл `mapgenie-pro-unlock.user.js` из этого репозитория.
3. ViolentMonkey предложит установить скрипт — подтвердите.
4. Откройте любую карту на mapgenie.io (например, Elden Ring).

Скрипт запускается на `@run-at document-start` и работает в контексте страницы (grant `none`).

## Как это работает

- Сайт держит состояние пользователя в `window.user`, а данные карты — в `window.mapData`. Для анонима `window.user === null`, поэтому PRO-функции заблокированы.
- Скрипт подставляет «локального PRO-пользователя» (`hasPro: true`, `maxMarkedLocations: 1e9`) и наполняет его данными из `localStorage`.
- Все запросы к `/api/v1/user/*` перехватываются (включая методы `get/post/put/delete/patch`, созданные через `axios.create()`) и отвечаются локально, в сеть ничего не отправляется.
- Данные хранятся под ключом `mg_local_data_v2` в `localStorage`.

## Импорт / экспорт

В правом нижнем углу есть панель «MapGenie Local»:

- **Экспорт всех данных** — скачивает JSON-файл со всеми картами/профилями.
- **Экспорт текущей карты** — только текущая карта.
- **Импорт (объединить)** — добавляет данные к существующим (merge).
- **Импорт (заменить всё)** — полностью перезаписывает хранилище.
- **Обновить счётчики** — пересчитать статистику.
- **Удалить локальные данные** — очистить всё (с подтверждением).

## Хранение данных

Формат (ключ `mg_local_data_v2`):

```json
{
  "version": 2,
  "locations": { "<gameId>:<mapId>": { "<locationId>": true } },
  "notes": { "<gameId>:<mapId>": [ ... ] },
  "presets": { "<gameId>": [ ... ] },
  "categories": { "<gameId>:<mapId>": [ ... ] },
  "profiles": { "<gameId>": [ ... ] },
  "activeProfile": { "<gameId>": <profileId> },
  "updatedAt": "..."
}
```

Всё хранится только в браузере. При очистке данных сайта / `localStorage` прогресс будет потерян.
