/**
 * Контент разделов черновика.
 *
 * Названия проектов, задач и инструментов — настоящие, выгружены из ClickUp
 * (пространство Computational Design: папки Algorithmic Modeling, Projects,
 * IND Tools, Tools, LLM to CAD). Настоящие и темы карточек — они приходят из
 * Supabase, как в проде.
 *
 * Дописаны руками и требуют проверки: описания «чем полезно», шаги «как
 * применить» и пути к папкам. Пути собраны по общему шаблону
 * `X:\CompDesign_Projects\<проект>\...` (из ClickUp достоверно известен только
 * путь к библиотеке ветра), поэтому перед публикацией их надо сверить с диском.
 *
 * Заявки в профиле выдуманы целиком: своих заявок в ClickUp нет.
 *
 * Когда появится таксономия и данные, файл заменяется запросом, а типы ниже
 * остаются формой ответа.
 */

/** Что лежит под темой. Три типа из контентной модели отдела. */
export type MaterialType = "case" | "tool" | "module";

export type Material = {
  id: string;
  /** Ключ темы из таблицы `cases` — карточка деки, под которой лежит материал. */
  topic: string;
  type: MaterialType;
  title: string;
  /** Одна строка списка: чем это полезно. */
  summary: string;
  /** Проект IND, где решение уже применялось (у кейсов). */
  project?: string;
  /** Подпись под демо-медиа: в черновике вместо гифки серый блок. */
  media: string;
  /** Инструкция «сделай сам» — то, ради чего материал оформляют. */
  steps: readonly string[];
  /** Где лежат файлы. Это путь на сетевом диске, а не ссылка. */
  files: string;
  updated: string;
};

export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  case: "Кейс",
  tool: "Инструмент",
  module: "Модуль",
};

export const MATERIALS: readonly Material[] = [
  // ──────────────────────────────────────────────────────────────────────
  // physics — «Нужно просчитать физику проекта». Здесь готовые инструменты:
  // тему закрывают продукты отдела, а не разовые скрипты.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "tool-insolation",
    topic: "physics",
    type: "tool",
    title: "IND Solar — инсоляция и КЕО",
    summary: "Окна, площадки и solar envelope с тепловой картой",
    media: "Гифка: тепловая карта инсоляции квартала",
    steps: [
      "Подать геометрию контекста и своё здание (INPUT: geometry context)",
      "Выбрать сценарий: insolation_windows, insolation_heatmap или solar_envelope",
      "Проверить окна — их можно добавить вручную, если геометрия сложная",
      "Выгрузить тепловую карту в отчёт",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\insolation",
    updated: "11 февраля",
  },
  {
    id: "tool-wind",
    topic: "physics",
    type: "tool",
    title: "Ветровой комфорт — оффлайн-пакет",
    summary: "Расчёт на нескольких ядрах без MS-MPI, отчёт по классификации Lawson LDDC",
    media: "Гифка: карта ветрового комфорта на уровне пешехода",
    steps: [
      "Взять оффлайн-дистрибутив из сетевой папки и запустить START_INSTALLER.bat",
      "Открыть рабочий файл .gh, подать массинг и .epw Москвы",
      "Задать число ядер — патч переводит блокирующую ошибку MPI в предупреждение",
      "Экспорт отчёта .docx/.pdf по шаблону, вид сверху сохраняется автоматически",
    ],
    files: "X:\\CompDesign_Projects\\Library\\wind\\Templates New",
    updated: "9 апреля",
  },
  {
    id: "tool-crowdflow",
    topic: "physics",
    type: "tool",
    title: "GhCrowdFlow — пешеходные потоки",
    summary: "Гибридный солвер, 5 режимов тепловых карт, Clearance и Travel Time",
    media: "Гифка: поток людей через вестибюль и карта загрузки",
    steps: [
      "Установить плагин из Yak Package Manager (v0.1.2) или из INDTools",
      "Разметить входы, выходы и препятствия, задать сценарий загрузки",
      "Смотреть метрики Clearance Time, Travel Time, Exit Split — не только картинку",
      "Presentation mode и легенда — для выдачи заказчику",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\crowdflow",
    updated: "24 июня",
  },
  {
    id: "case-shelepiha-wind",
    topic: "physics",
    type: "case",
    title: "Ветровой комфорт НПС БЦ Шелепиха",
    summary: "Проект, под который собирали алгоритм генерации модели расчёта",
    project: "1-72-2025 НПС БЦ Шелепиха",
    media: "Гифка: модель расчёта ветра по площадке",
    steps: [
      "Посмотреть, как собрана модель расчёта под реальную площадку",
      "Взять регламент по зонам ветровой активности",
      "Заявка «Хочу так же» — соберём под ваш участок",
    ],
    files: "X:\\CompDesign_Projects\\1-72-2025\\wind",
    updated: "19 декабря",
  },
  {
    id: "case-porivaevoy-wind",
    topic: "physics",
    type: "case",
    title: "Штаб на Маши Порываевой — ветровой комфорт",
    summary: "Существующее положение и проектное предложение в одном расчёте",
    project: "1-52-2025 АЛЬФА Маши Порываевой Штаб",
    media: "Гифка: сравнение существующего и проектного",
    steps: [
      "Посмотреть, как оформлено сравнение двух состояний",
      "Взять шаблон отчёта",
      "Заявка «Хочу так же» с номером своего проекта",
    ],
    files: "X:\\CompDesign_Projects\\1-52-2025\\wind",
    updated: "24 июня",
  },

  // ──────────────────────────────────────────────────────────────────────
  // revit — «Геометрию нужно передать в Revit»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "module-rir-transfer",
    topic: "revit",
    type: "module",
    title: "Передача геометрии через Rhino.Inside.Revit",
    summary: "Панели уезжают в Revit экземплярами семейства, с параметрами",
    media: "Гифка: панели фасада собираются в модели Revit",
    steps: [
      "Проверить структуру панелей в Rhino: геометрия, атрибуты, группировка",
      "Настроить шаблон семейства панели в Revit",
      "Подать панели — маппинг параметров и позиционирование экземпляров идёт скриптом",
      "Сверить количество экземпляров до записи в модель",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\rhino_inside_revit",
    updated: "10 августа",
  },
  {
    id: "case-izmailovo",
    topic: "revit",
    type: "case",
    title: "ФСК Измайлово БЦ — фасад в Revit",
    summary: "На этом проекте скрипт обкатали и обобщили в универсальный инструмент",
    project: "1-76-2025 ФСК Измайлово БЦ",
    media: "Гифка: перенос панелей проекта в модель",
    steps: [
      "Посмотреть, как разложены панели и что попало в параметры семейства",
      "Взять определение из папки проекта",
      "Заявка «Хочу так же» — настроим под ваш шаблон семейств",
    ],
    files: "X:\\CompDesign_Projects\\1-76-2025\\gh",
    updated: "10 августа",
  },

  // ──────────────────────────────────────────────────────────────────────
  // unique — «Много уникальных элементов»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "module-panel-marking",
    topic: "unique",
    type: "module",
    title: "Маркировка панелей по расположению в здании",
    summary: "Марка каждой панели считается из её места на фасаде, а не вручную",
    media: "Гифка: марки проступают на панелях фасада",
    steps: [
      "Подать панели и оси/этажи как систему координат маркировки",
      "Выбрать правило марки (фасад, ярус, позиция в ряду)",
      "Проверить уникальность марок перед выгрузкой ведомости",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\panel_marking",
    updated: "19 августа",
  },
  {
    id: "module-panel-typing",
    topic: "unique",
    type: "module",
    title: "Типизация и разбивка на стандартные панели",
    summary: "Сводит уникальные элементы к набору типов — меньше позиций в заказе",
    media: "Гифка: панели раскрашиваются по типам",
    steps: [
      "Задать допуск, в пределах которого панели считаются одинаковыми",
      "Посмотреть распределение по типам и подкрутить допуск",
      "Выгрузить ведомость типов и уникальных позиций",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\panel_typing",
    updated: "24 июня",
  },
  {
    id: "module-louvers-cutouts",
    topic: "unique",
    type: "module",
    title: "Параметрический скрипт ламелей с вырезами",
    summary: "Ламели по фасаду с вырезами под проёмы и переменным шагом",
    media: "Гифка: ламели обходят проёмы фасада",
    steps: [
      "Подать линию фасада, проёмы и шаг ламелей",
      "Задать правило разрыва у проёма",
      "Проверить стыки на изломах фасада",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\louvers",
    updated: "24 июня",
  },
  {
    id: "case-vereyskaya",
    topic: "unique",
    type: "case",
    title: "МР Верейская БЦ — фасад и ламели",
    summary: "8 вариантов паттерна, ламели с вырезами, типизация панелей",
    project: "1-19-2026 МР Верейская БЦ",
    media: "Гифка: варианты паттерна фасада",
    steps: [
      "Посмотреть, как перебирались варианты паттерна",
      "Взять определение из папки проекта",
      "Заявка «Хочу так же» — соберём под геометрию вашего фасада",
    ],
    files: "X:\\CompDesign_Projects\\1-19-2026\\gh",
    updated: "24 июня",
  },
  {
    id: "case-centrlab",
    topic: "unique",
    type: "case",
    title: "ЦентрЛаб — фасадные панели",
    summary: "Исследовательский центр: панелизация фасада под изготовление",
    project: "1-2-2026 ЦентрЛаб Исследовательский Центр",
    media: "Гифка: раскладка панелей фасада",
    steps: [
      "Посмотреть логику раскладки и стыков",
      "Сверить с ограничениями своего производителя",
      "Заявка «Хочу так же»",
    ],
    files: "X:\\CompDesign_Projects\\1-2-2026\\gh",
    updated: "31 марта",
  },
  {
    id: "case-coldy",
    topic: "unique",
    type: "case",
    title: "Coldy Красносельская БЦ — фасадные панели",
    summary: "Панелизация фасада с ведомостью на изготовление",
    project: "1-36-2025 Coldy Красносельская БЦ",
    media: "Гифка: панели и ведомость",
    steps: [
      "Посмотреть структуру ведомости",
      "Проверить правило маркировки на своём фасаде",
      "Заявка «Хочу так же»",
    ],
    files: "X:\\CompDesign_Projects\\1-36-2025\\gh",
    updated: "31 марта",
  },

  // ──────────────────────────────────────────────────────────────────────
  // curved — «Форма здания криволинейная»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "tool-remesh",
    topic: "curved",
    type: "tool",
    title: "Remesh — quad-топология из любой геометрии",
    summary: "Перестраивает геометрию Rhino в mesh с управляемым числом полигонов",
    media: "Гифка: пересборка сетки на криволинейной форме",
    steps: [
      "Подать любую геометрию (Brep, mesh, поли-сюрфейс)",
      "Задать целевое число полигонов",
      "Проверить сетку перед расчётом инсоляции — гайд лежит рядом",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\remesh",
    updated: "25 декабря",
  },
  {
    id: "case-bishkek",
    topic: "curved",
    type: "case",
    title: "Автовокзал в Бишкеке — карниз",
    summary: "Деление на треугольные панели, развёртки к мокапу, раскладка под резку",
    project: "1-69-2024 Western Bus Station Bishkek",
    media: "Гифка: карниз и развёртки панелей",
    steps: [
      "Посмотреть, как карниз разбит на треугольные панели по сложной сетке",
      "Открыть раскладку: линии реза, сгибов, отверстий и швов",
      "Заявка «Хочу так же» — под другую геометрию это собирается заново, готового определения нет",
    ],
    files: "X:\\CompDesign_Projects\\1-69-2024\\gh",
    updated: "19 августа",
  },
  {
    id: "case-concrete-bowls",
    topic: "curved",
    type: "case",
    title: "Бетонные слоёные чаши",
    summary: "Ландшафтный объект: объём разложен слоями под опалубку, форма под этот случай",
    media: "Гифка: чаша собирается слоями",
    steps: [
      "Посмотреть, как объём разложен на слои и как считалась опалубка",
      "Открыть контуры слоёв для раскроя",
      "Заявка «Хочу так же» — под другую форму алгоритм собирается заново",
    ],
    files: "X:\\CompDesign_Projects\\landscape\\bowls",
    updated: "6 марта",
  },

  // ──────────────────────────────────────────────────────────────────────
  // reference — «Есть задумка, но неясно как собрать»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "tool-ai-geometry",
    topic: "reference",
    type: "tool",
    title: "AI-геометрия: из референса в массинг",
    summary: "Три сценария — Reference, Simplification, Massing. Дорабатывается, спросите отдел",
    media: "Гифка: башня упрощается от v8 к v20",
    steps: [
      "Выбрать сценарий: разобрать референс, упростить модель или собрать массинг",
      "Подать mesh — VSA-скрипт даёт упрощённую геометрию",
      "Для острых кромок смотреть ShrinkWrap/AlphaWrap",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\ai_geometry_workflows",
    updated: "24 июня",
  },
  {
    id: "module-barcode-gradient",
    topic: "reference",
    type: "module",
    title: "Алгоритм штрихкод-градиента",
    summary: "Рисунок фасада меняется по правилу, а не рисуется руками",
    media: "Гифка: градиент штрихкода по фасаду",
    steps: [
      "Подать поверхность фасада и сетку модулей",
      "Задать кривую распределения плотности",
      "Проверить, читается ли рисунок с уровня улицы",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\barcode_gradient",
    updated: "24 июня",
  },
  {
    id: "module-metaballs",
    topic: "reference",
    type: "module",
    title: "Метаболлы — плавные объёмы",
    summary: "Скульптурная форма из набора центров, для МАФов и ландшафта",
    media: "Гифка: метаболлы сливаются в объём",
    steps: [
      "Расставить центры и радиусы влияния",
      "Подобрать порог слияния",
      "Перестроить в mesh под производство",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\metaballs",
    updated: "25 декабря",
  },

  // ──────────────────────────────────────────────────────────────────────
  // variants — «Нужно перебрать много вариантов»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "module-pattern-variants",
    topic: "variants",
    type: "module",
    title: "Перебор вариантов паттерна",
    summary: "Восемь вариантов одним прогоном — так подбирали фасад Верейской и карниз Бишкека",
    media: "Гифка: сетка вариантов паттерна",
    steps: [
      "Задать параметры паттерна и их диапазоны",
      "Запустить перебор, получить рендер каждого варианта",
      "Сравнить варианты таблицей, а не на глаз",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\pattern_variants",
    updated: "24 июня",
  },
  {
    id: "case-krasnopresnenskaya",
    topic: "variants",
    type: "case",
    title: "Capital Краснопресненская МФК — варианты фасада",
    summary: "Паттерны, типизация панелей и штрихкод-градиент на одном проекте",
    project: "1-5-2026 Capital Краснопресненская МФК",
    media: "Гифка: варианты фасада МФК",
    steps: [
      "Посмотреть, какие параметры перебирались",
      "Взять определение из папки проекта",
      "Заявка «Хочу так же»",
    ],
    files: "X:\\CompDesign_Projects\\1-5-2026\\gh",
    updated: "24 июня",
  },
  {
    id: "case-barka",
    topic: "variants",
    type: "case",
    title: "Бордюрный камень «Барка» — серия объектов",
    summary: "Две версии по ТЗ плюс шесть дополнительных вариантов объектов",
    project: "1-52-2025 АЛЬФА Бордюрный камень Барка",
    media: "Гифка: серия вариантов камня",
    steps: [
      "Посмотреть, как параметризован профиль",
      "Взять определение и подставить свои габариты",
      "Заявка «Хочу так же» для своей серии",
    ],
    files: "X:\\CompDesign_Projects\\1-52-2025\\barka",
    updated: "30 января",
  },

  // ──────────────────────────────────────────────────────────────────────
  // repeat — «Действие повторяется по всему проекту»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "module-rod-modeling",
    topic: "repeat",
    type: "module",
    title: "Стержневой моделинг из блоков",
    summary: "Стержни расставляются по правилу — от осей до кровли",
    media: "Гифка: стержни разбегаются по каркасу",
    steps: [
      "Подать блоки-заготовки и сетку осей",
      "Задать правило расстановки и подрезки",
      "Проверить узлы на пересечениях",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\rod_modeling",
    updated: "24 июня",
  },
  {
    id: "module-facade-split",
    topic: "repeat",
    type: "module",
    title: "Фасадная разбивка по модулю",
    summary: "Модуль, высокий первый этаж и кровля с парапетом одним определением",
    media: "Гифка: разбивка фасада по этажам",
    steps: [
      "Задать модуль и высоты этажей",
      "Отметить первый этаж и парапет отдельными правилами",
      "Проверить стыки разбивки на углах",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\facade_split",
    updated: "24 июня",
  },
  {
    id: "module-sketchup-blocks",
    topic: "repeat",
    type: "module",
    title: "Интеграция блоков в модель SketchUp",
    summary: "Готовые блоки уезжают в SketchUp без ручной пересборки",
    media: "Гифка: блоки появляются в SketchUp",
    steps: [
      "Собрать блоки в Rhino по правилу",
      "Экспортировать через определение — имена и слои сохраняются",
      "Проверить масштаб и точку вставки",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\sketchup_blocks",
    updated: "24 июня",
  },
  {
    id: "case-mosfilm",
    topic: "repeat",
    type: "case",
    title: "MR Мосфильмовская ЖК — каркас и разбивка",
    summary: "Стержневой моделинг, фасадная разбивка и 6 демо формообразования",
    project: "1-24-2026 MR Мосфильмовская ЖК",
    media: "Гифка: демо формообразования",
    steps: [
      "Посмотреть 6 демо-примеров формообразования",
      "Взять определение разбивки из папки проекта",
      "Заявка «Хочу так же»",
    ],
    files: "X:\\CompDesign_Projects\\1-24-2026\\gh",
    updated: "24 июня",
  },

  // ──────────────────────────────────────────────────────────────────────
  // custom — «Нетиповая или разовая задача»
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "module-logo-import",
    topic: "custom",
    type: "module",
    title: "Импорт логотипа и графики в Grasshopper",
    summary: "Растр или вектор становится геометрией для фасада и графики",
    media: "Гифка: логотип превращается в геометрию",
    steps: [
      "Подать файл логотипа",
      "Задать порог и плотность трассировки",
      "Получить кривые для дальнейшей работы",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\logo_import",
    updated: "10 февраля",
  },
];

export function materialsByTopic(topic: string): Material[] {
  return MATERIALS.filter((m) => m.topic === topic);
}

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

/**
 * Поток отдела: то, что делается сейчас и что уже сделано.
 *
 * В отличие от материалов эти строки никто не готовит руками — они приходят из
 * задач. Ценность строки — название, проект и путь к папке с файлами.
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
};

export const FEED: readonly FeedItem[] = [
  {
    id: "f-louvers-openings",
    title: "Логика разрывов ламелей под проёмы",
    project: "1-19-2026 МР Верейская БЦ",
    status: "in_work",
    owner: "Дарий",
    files: "X:\\CompDesign_Projects\\1-19-2026\\gh",
    when: "в работе",
  },
  {
    id: "f-louvers-complex",
    title: "Генерация ламелей сложной формы вдоль фасада",
    project: "1-19-2026 МР Верейская БЦ",
    status: "in_work",
    owner: "Дарий",
    files: "X:\\CompDesign_Projects\\1-19-2026\\gh",
    when: "в работе",
  },
  {
    id: "f-wind-testing",
    title: "Тестирование инструмента ветра в рабочих проектах",
    project: "Ветровой комфорт · IND Tools",
    status: "in_work",
    owner: "Дарий",
    files: "X:\\CompDesign_Projects\\Library\\wind\\Templates New",
    when: "в работе",
  },
  {
    id: "f-insolation-calc",
    title: "Погрешность расчёта инсоляции",
    project: "Инсоляция · IND Tools",
    status: "in_work",
    owner: "Елена",
    files: "X:\\CompDesign_Projects\\Library\\tools\\insolation",
    when: "в работе",
  },
  {
    id: "f-plancy-projects",
    title: "Оформление проектов в архитектуре Plancy",
    project: "Plancy Projects · IND Tools",
    status: "in_work",
    owner: "Дарий",
    files: "X:\\CompDesign_Projects\\Library\\plancy",
    when: "в работе",
  },
  {
    id: "f-google-3d",
    title: "Выгрузка 3D-окружения по API из Google — проверка возможности",
    project: "Google Maps · Tools",
    status: "in_work",
    owner: "Пётр",
    files: "X:\\CompDesign_Projects\\Library\\tools\\google_maps",
    when: "в работе",
  },
  {
    id: "f-landscape-tool",
    title: "Инструмент для ландшафтников — старт работ",
    project: "Ландшафтный отдел",
    status: "in_work",
    owner: "Пётр",
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\landscape",
    when: "в работе",
  },
  {
    id: "f-bishkek-cornice",
    title: "Раскладка карниза: линии реза, сгибов, отверстий, швов",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-69-2024\\gh",
    when: "19 августа",
  },
  {
    id: "f-bishkek-mockup",
    title: "Подготовка развёрток к мокапу",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-69-2024\\mockup",
    when: "19 августа",
  },
  {
    id: "f-izmailovo-revit",
    title: "Передача панелей в Revit через Rhino.Inside",
    project: "1-76-2025 ФСК Измайлово БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-76-2025\\gh",
    when: "10 августа",
  },
  {
    id: "f-vereyskaya-patterns",
    title: "8 вариантов паттернов фасада",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-19-2026\\gh",
    when: "24 июня",
  },
  {
    id: "f-mosfilm-rods",
    title: "Скрипт стержневого моделинга из блоков",
    project: "1-24-2026 MR Мосфильмовская ЖК",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-24-2026\\gh",
    when: "24 июня",
  },
  {
    id: "f-crowdflow-release",
    title: "GhCrowdFlow — публикация в Yak и интеграция в INDTools",
    project: "Пешеходные потоки · Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\tools\\crowdflow",
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
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\concrete_bowls",
    when: "6 марта",
  },
  {
    id: "f-solar-envelope",
    title: "Оформление solar_envelope для архитекторов",
    project: "Инсоляция · IND Tools",
    status: "done",
    files: "X:\\CompDesign_Projects\\Library\\tools\\insolation",
    when: "11 февраля",
  },
];

/** Вехи заявки. Порядок = порядок прохождения. */
export const REQUEST_STAGES = [
  "Отправлена",
  "Принята",
  "В работе",
  "Результат",
] as const;

export type MyRequest = {
  id: string;
  title: string;
  /** Откуда заявка родилась — тема или конкретный материал. */
  originLabel: string;
  project: string;
  /** Индекс текущей вехи в REQUEST_STAGES. */
  stage: number;
  /**
   * Состояние, которое не является вехой: оно возвращает заявку назад, и
   * шкала вех такое показать не может — поэтому отдельным баннером.
   */
  flag?: "Требуется уточнение" | "На доработке";
  /** Чужая задача, на которую подписались, а не своя заявка. */
  watching?: boolean;
  when: string;
};

export const MY_REQUESTS: readonly MyRequest[] = [
  {
    id: "r-001",
    title: "Панели фасада передать в Revit семействами",
    originLabel: "Кейс · ФСК Измайлово БЦ — фасад в Revit",
    project: "1-5-2026 Capital Краснопресненская МФК",
    stage: 2,
    when: "отправлена 18 августа",
  },
  {
    id: "r-002",
    title: "Инсоляция двора для двух вариантов застройки",
    originLabel: "Инструмент · IND Solar",
    project: "1-2-2026 ЦентрЛаб Исследовательский Центр",
    stage: 1,
    flag: "Требуется уточнение",
    when: "отправлена 19 августа",
  },
  {
    id: "r-003",
    title: "Ведомость панелей по новой раскладке",
    originLabel: "Модуль · Типизация и разбивка на стандартные панели",
    project: "1-36-2025 Coldy Красносельская БЦ",
    stage: 3,
    when: "результат 19 августа",
  },
  {
    id: "r-004",
    title: "Логика разрывов ламелей под проёмы",
    originLabel: "Отслеживаете задачу отдела",
    project: "1-19-2026 МР Верейская БЦ",
    stage: 2,
    watching: true,
    when: "в работе",
  },
];

export function myRequestById(id: string): MyRequest | undefined {
  return MY_REQUESTS.find((r) => r.id === id);
}
