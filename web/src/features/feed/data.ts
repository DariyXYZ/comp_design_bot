/**
 * Поток отдела: что делается сейчас и что уже сделано.
 *
 * В отличие от материалов эти строки никто не готовит руками — они приходят из
 * задач. Ценность строки — название, проект и путь к папке с файлами.
 *
 * Состав сверен с отделом 3 сентября 2026: в работе остались два проекта,
 * остальное закрыто. У закрытых тогда же задач даты нет — они не были
 * записаны, и выдумывать её здесь нельзя: строка просто покажет «Готово».
 *
 * Пути сверены с диском. Те, чьи папки не нашлись, оставлены как были и ждут
 * сверки: ЦентрЛаб, Plancy, Google Maps, ландшафтный инструмент.
 */

export type FeedItem = {
  id: string;
  title: string;
  project: string;
  status: "in_work" | "done";
  /** Кто ведёт — показываем только у задач в работе. */
  owner?: string;
  files: string;
  when: string;
  /**
   * Обложка из папки проекта, уже сжатая и положенная в `public/feed`.
   *
   * Есть там, где превью в папке проекта нашлось. У остальных на её месте
   * остаётся знак скрипта: картинку для каждой строки никто не готовил, и
   * ставить её ради единообразия значило бы придумывать.
   */
  cover?: string;
};

export const FEED: readonly FeedItem[] = [
  // ──────────────────────────────────────────────────────────────────────
  // В работе. Пути — папки обмена с архитекторами: там лежит то, что отдел
  // отдаёт, а не его внутренняя кухня. Бишкек отсюда уехал 3 сентября: панели
  // сданы, и проект переехал в готовые кейсы (см. `case-bishkek-panels`).
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "f-alfa-wind",
    title: "Расчёт ветрового комфорта",
    project: "1-52-2025 АЛЬФА Маши Порываевой",
    status: "in_work",
    files: "X:\\CompDesign_Projects\\Exchange\\1-52-2025 АЛЬФА Маши Порываевой",
    when: "",
    cover: "/feed/alfa-poryvaevoy.jpg",
  },
  {
    id: "f-shenogina-louvers",
    title: "Ламели фасада — параметрическая модель",
    project: "1-34-2026 ФСК Шеногина Сидней",
    status: "in_work",
    files: "X:\\CompDesign_Projects\\Exchange\\1-34-2026 ФСК Шеногина Сидней",
    when: "",
    cover: "/feed/shenogina-louvers.jpg",
  },

  // ──────────────────────────────────────────────────────────────────────
  // Закрыто 3 сентября 2026 — то, что до этого числилось в работе. Идёт
  // первым в «сделано»: это самое свежее из закрытого.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "f-bishkek-panels-dwg",
    title: "Панели фасада: модель и выгрузка в DWG",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\Exchange\\1-69-2024 Western Bus Station Bishkek",
    when: "3 сентября",
    cover: "/feed/bishkek-panels.jpg",
  },
  {
    id: "f-louvers-openings",
    title: "Логика разрывов ламелей под проёмы",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2026\\1-19-2026 МР Верейская БЦ",
    when: "",
  },
  {
    id: "f-louvers-complex",
    title: "Генерация ламелей сложной формы вдоль фасада",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2026\\1-19-2026 МР Верейская БЦ",
    when: "",
  },
  {
    id: "f-wind-testing",
    title: "Тестирование инструмента ветра в рабочих проектах",
    project: "Ветровой комфорт · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\wind\\Templates New",
    when: "",
  },
  {
    id: "f-insolation-calc",
    title: "Погрешность расчёта инсоляции",
    project: "Инсоляция · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\insolation_beta",
    when: "",
  },
  {
    id: "f-plancy-projects",
    title: "Оформление проектов в архитектуре Plancy",
    project: "Plancy Projects · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\plancy",
    when: "",
  },
  {
    id: "f-google-3d",
    title: "Выгрузка 3D-окружения по API из Google — проверка возможности",
    project: "Google Maps · Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\tools\\google_maps",
    when: "",
  },
  {
    id: "f-landscape-tool",
    title: "Инструмент для ландшафтников — старт работ",
    project: "Ландшафтный отдел",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\landscape",
    when: "",
  },

  // ── Закрытое раньше, с датами ────────────────────────────────────────
  {
    id: "f-bishkek-cornice",
    title: "Раскладка карниза: линии реза, сгибов, отверстий, швов",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2024\\1-69-2024 Western Bus Station Bishkek",
    when: "19 августа",
  },
  {
    id: "f-bishkek-mockup",
    title: "Подготовка развёрток к мокапу",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2024\\1-69-2024 Western Bus Station Bishkek",
    when: "19 августа",
  },
  {
    id: "f-izmailovo-revit",
    title: "Передача панелей в Revit через Rhino.Inside",
    project: "1-76-2025 ФСК Измайлово БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2025\\1-76-2025 ФСК Измайлово БЦ",
    when: "10 августа",
  },
  {
    id: "f-vereyskaya-patterns",
    title: "8 вариантов паттернов фасада",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2026\\1-19-2026 МР Верейская БЦ",
    when: "24 июня",
  },
  {
    id: "f-mosfilm-rods",
    title: "Скрипт стержневого моделинга из блоков",
    project: "1-24-2026 MR Мосфильмовская ЖК",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\01_Architecture\\2026\\1-24-2026 MR Мосфильмовская ЖК",
    when: "24 июня",
  },
  {
    id: "f-crowdflow-release",
    title: "GhCrowdFlow — публикация в Yak и интеграция в INDTools",
    project: "Пешеходные потоки · Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\crowd_flow",
    when: "24 июня",
  },
  {
    id: "f-wind-offline",
    title: "Оффлайн-пакет расчёта ветра с MPI-патчем",
    project: "Ветровой комфорт · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\wind\\Templates New",
    when: "9 апреля",
  },
  {
    id: "f-centrlab-panels",
    title: "Фасадные панели исследовательского центра",
    project: "1-2-2026 ЦентрЛаб Исследовательский Центр",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-2-2026\\gh",
    when: "31 марта",
  },
  {
    id: "f-bowls",
    title: "Алгоритм бетонных слоёных чаш",
    project: "Ландшафтный отдел",
    status: "done",
    files: "X:\\CompDesign_Projects\\Work\\PROJECTS\\AlgorithmicModeling\\02_LandscapeArchitecture\\1-8-2025 Sarabi Residential Al Satwa\\concrete_bowls",
    when: "6 марта",
  },
  {
    id: "f-solar-envelope",
    title: "Оформление solar_envelope для архитекторов",
    project: "Инсоляция · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\insolation_beta",
    when: "11 февраля",
  },
];
