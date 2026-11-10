window.STATE =
{
  "version": 2,
  "slug": "news-agent-v2",
  "dir": "2026-11-10-news-agent-v2--wip",
  "title": "Перенос на новый сервер и переделка оценки новостей",
  "mode": "interview",
  "depth": "deep",
  "tier": null,
  "briefFile": "2026-11-10-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "/Users/aleksandrtrisenkov/.dsh/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-10T12:18:05+04:00",
  "updatedAt": "2026-11-10T13:28:49+04:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-10T12:18:05+04:00",
      "finishedAt": "2026-11-10T12:19:32+04:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-10T12:19:32+04:00",
      "finishedAt": "2026-11-10T12:19:32+04:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-11-10T12:19:32+04:00",
      "finishedAt": "2026-11-10T13:23:36+04:00"
    },
    {
      "id": "spec",
      "status": "active",
      "startedAt": "2026-11-10T13:23:36+04:00"
    },
    {
      "id": "plan",
      "status": "pending"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 29,
    "done": 2,
    "inTicket": 27,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Темы, судья и дешёвый префильтр",
      "requirements": [
        "R07",
        "R07.1",
        "R20",
        "R20e",
        "R20i",
        "R18.1"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "app/scripts/hermes/topics.ts",
        "app/scripts/hermes/judge.ts",
        "app/scripts/hermes/prefilter.ts",
        "app/scripts/hermes/relevance-fixtures.ts",
        "app/scripts/hermes/judge.test.ts",
        "app/scripts/hermes/prefilter.test.ts",
        "app/scripts/hermes/relevance-set.test.ts"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Провайдеры: GigaChat, OpenCode и цепочка с классификацией ошибок",
      "requirements": [
        "R12",
        "R12.1",
        "R13",
        "R14",
        "R14.1",
        "R15"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "app/api/ai/providers/",
        "app/api/ai/providers/*.test.ts",
        "scripts/update-key.sh",
        ".env.example"
      ],
      "review": "да — ключи и секреты",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Конвейер: префильтр, судья, бюджет дня и счётчики",
      "requirements": [
        "R06",
        "R07",
        "R08",
        "R08.1",
        "R17",
        "R18",
        "R18.1",
        "R19"
      ],
      "blockedBy": [
        "01",
        "02"
      ],
      "wave": 2,
      "zone": [
        "app/scripts/hermes/evaluate-news.ts",
        "app/scripts/hermes/manifest-gen.ts",
        "app/scripts/hermes/publish-budget.ts",
        "app/scripts/hermes/ralph-loop.sh",
        "app/db/schema.ts",
        "app/db/migrations/0011_*.sql",
        "app/scripts/hermes/pipeline-budget.test.ts"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "04",
      "title": "Дайджест по эталону и разделение получателей",
      "requirements": [
        "R06",
        "R09",
        "R10",
        "R11",
        "R17",
        "R17i",
        "R21"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "app/scripts/hermes/digest-format.ts",
        "app/scripts/hermes/daily-digest.ts",
        "app/scripts/hermes/digest-format.test.ts",
        "app/scripts/hermes/__fixtures__/"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "Развёртывание, бэкапы вне сервера и правда в документации",
      "requirements": [
        "R01",
        "R01.1",
        "R02",
        "R02i",
        "R03",
        "R03.1",
        "R04",
        "R05",
        "R12.2",
        "R16",
        "G01",
        "G02"
      ],
      "blockedBy": [
        "03",
        "04"
      ],
      "wave": 3,
      "zone": [
        "scripts/deploy/",
        "scripts/backup-offsite.sh",
        "scripts/check-env-example.ts",
        "scripts/check-docs.ts",
        "docs/DEPLOY.md",
        "ARCHITECTURE.md",
        "CONTEXT.md",
        "PROGRESS.md",
        "docs/adr/",
        "ecosystem.config.cjs",
        ".env.example"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": null,
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-10T12:18:05+04:00",
    "2026-11-10T12:19:32+04:00",
    "2026-11-10T12:29:21+04:00",
    "2026-11-10T13:23:36+04:00",
    "2026-11-10T13:28:49+04:00"
  ],
  "rev": 15,
  "waiting": null,
  "waits": [
    {
      "kind": "briefing",
      "from": "2026-11-10T12:19:32+04:00",
      "to": "2026-11-10T13:23:36+04:00"
    }
  ],
  "log": [
    {
      "t": "2026-11-10T12:18:05+04:00",
      "k": "init"
    },
    {
      "t": "2026-11-10T12:19:32+04:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-10T12:19:32+04:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-10T12:19:32+04:00",
      "k": "ask",
      "kind": "briefing",
      "note": "раунд 1: сервер, остатки данных, срок, репозиторий"
    },
    {
      "t": "2026-11-10T12:29:21+04:00",
      "k": "ask",
      "kind": "briefing",
      "note": "раунд 2: что считать темой, объём на день, строгость отсева, кто подтверждает качество"
    },
    {
      "t": "2026-11-10T13:23:36+04:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-11-10T13:23:36+04:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 29,
      "total": 29
    },
    {
      "t": "2026-11-10T13:23:36+04:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-10T13:28:49+04:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-10T13:28:49+04:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«перенести наш проект на новый сервак»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«Теперь нужно перенести всё на новый сервер»",
      "status": "in-ticket"
    },
    {
      "id": "R02i",
      "text": "(подразумевается) после потери данных БД и доступы создаются заново",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«атака была на инфраструктуру beget»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«Ты должен навести порядок»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«помочь мне полностью осмыслить стек и архитектуру»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«+ доработать проект»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«ии-агент собирал новости по выбранным заказчиком темам»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«выбирал самые крутые новости»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«делал саммари»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«добавлял карточки новостей в дашборд»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«присылал пуши в тг выбранным контактам»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«заменить провайдера с бесплатного опенкода на gigachat api»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«там 365 миллионов токенов бесплатно для физлиц. Хз на сколько хватит»",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«В качестве фолбэка я бы мог поставить один из своих ключей opencode go»",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "«они постоянно меняются у меня, так что и тут придётся контролить этот момент»",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "«Система работала у нас на hermes agent, который был установлен на сервере»",
      "status": "in-ticket"
    },
    {
      "id": "R17",
      "text": "«сделать что-нибудь, чтобы эта автоматизация работала стабильно»",
      "status": "in-ticket"
    },
    {
      "id": "R17i",
      "text": "(подразумевается) клиент не должен видеть служебные строки про здоровье конвейера и алерты",
      "status": "in-ticket"
    },
    {
      "id": "R18",
      "text": "«меня не устраивала модель оценки новостей - куча данных обрабатывалась впустую, либо наоборот - вообще не обрабатывалась»",
      "status": "in-ticket"
    },
    {
      "id": "R19",
      "text": "«раз в день (как и раньше) агент публикует набор собранных новостей»",
      "status": "in-ticket"
    },
    {
      "id": "R20",
      "text": "«сами новости точно относятся к выбранным темам, без промахов»",
      "status": "in-ticket"
    },
    {
      "id": "R20i",
      "text": "(подразумевается) «без промахов» требует разметки, а обратной связи в продукте не будет",
      "status": "in-ticket"
    },
    {
      "id": "R20e",
      "text": "«тема \"ии в биологии\", а в подборку попадает новость про электрику»",
      "status": "in-ticket"
    },
    {
      "id": "R21",
      "text": "«отправка в тг должна быть по строго согласованному мной виду»",
      "status": "in-ticket"
    },
    {
      "id": "G02",
      "text": "«как куплю сервар - скину его данные»",
      "status": "in-ticket"
    },
    {
      "id": "R22",
      "text": "«Изучи директорию и репо»",
      "status": "done"
    },
    {
      "id": "G01",
      "text": "«Эта неделя»",
      "status": "in-ticket"
    },
    {
      "id": "R23",
      "text": "«Проведи со мной максимально глубокое интервью, чтобы определить все \"белые пятна\"»",
      "status": "done"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-10T13:23:36+04:00",
      "open": 29,
      "total": 29
    },
    "G3": {
      "ok": true,
      "at": "2026-11-10T13:28:49+04:00",
      "problems": 0
    }
  },
  "result": null
}
