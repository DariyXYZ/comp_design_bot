/**
 * ЧЕРНОВИК: содержимое разделов на выдуманных данных.
 *
 * Здесь лежит только то, чего ещё нет в базе: оформленные материалы под
 * темами, поток задач отдела и заявки пользователя. Сами темы (карточки
 * деки) настоящие — они приходят из Supabase, как в проде.
 *
 * Всё в этом файле нужно, чтобы кликать поток и спорить про структуру, а не
 * про тексты. Когда таксономия зафиксирована, файл заменяется запросом к
 * данным, а типы ниже остаются формой ответа.
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
  // «Геометрию нужно передать в Revit» — модули и кейсы, готовых инструментов нет.
  {
    id: "revit-rir-louvers",
    topic: "revit",
    type: "module",
    title: "Rhino.Inside.Revit: ламели в адаптивные семейства",
    summary: "Определение переносит ламели фасада как адаптивные компоненты",
    media: "Гифка: ламели уезжают из Rhino в Revit",
    steps: [
      "Открыть определение в Rhino с загруженным Rhino.Inside.Revit",
      "Подать кривые ламелей и указать семейство-приёмник",
      "Проверить количество экземпляров до записи в модель",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\rir_louvers",
    updated: "12 августа",
  },
  {
    id: "revit-grid-export",
    topic: "revit",
    type: "module",
    title: "Экспорт сетки осей и уровней",
    summary: "Оси и уровни из Grasshopper без ручного переноса",
    media: "Гифка: сетка осей появляется в Revit",
    steps: [
      "Указать глобальную сетку этажей",
      "Сверить нулевую отметку с моделью Revit",
      "Записать сначала оси, потом уровни — порядок важен",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\grid_export",
    updated: "29 июля",
  },
  {
    id: "revit-vereyskaya",
    topic: "revit",
    type: "case",
    title: "Фасад Верейской БЦ передан в Revit",
    summary: "9 вариантов концепции, принятый ушёл в модель целиком",
    project: "1-19-2026 МР Верейская БЦ",
    media: "Гифка: панели фасада собираются в модели",
    steps: [
      "Посмотреть, как разложены панели по вариантам",
      "Взять готовое определение из папки проекта",
      "Заявка «Хочу так же» — настроим под ваш проект",
    ],
    files: "X:\\CompDesign_Projects\\1-19-2026\\gh",
    updated: "5 августа",
  },
  {
    id: "revit-bishkek",
    topic: "revit",
    type: "case",
    title: "Витраж автовокзала в Бишкеке",
    summary: "Криволинейный витраж разложен на плоские стёкла",
    project: "1-69-2024 Western Bus Station Bishkek",
    media: "Гифка: раскладка витража",
    steps: [
      "Открыть пример раскладки",
      "Сверить допуск на плоскость стекла",
      "Заявка «Хочу так же» с номером своего проекта",
    ],
    files: "X:\\CompDesign_Projects\\1-69-2024\\gh",
    updated: "17 июня",
  },

  // «Нужно просчитать физику проекта» — здесь в основном готовые инструменты.
  {
    id: "physics-solar",
    topic: "physics",
    type: "tool",
    title: "IND Solar",
    summary: "Инсоляция и КЕО по нормам, отчёт таблицей",
    media: "Гифка: расчёт инсоляции по кварталу",
    steps: [
      "Подать объёмы окружения и своё здание",
      "Выбрать норматив и период расчёта",
      "Выгрузить отчёт — он подходит для проверки",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\ind_solar",
    updated: "8 августа",
  },
  {
    id: "physics-wind",
    topic: "physics",
    type: "tool",
    title: "IND Wind",
    summary: "Ветровой комфорт на уровне пешехода, без CFD-специалиста",
    media: "Гифка: карта ветрового комфорта",
    steps: [
      "Загрузить массинг и розу ветров города",
      "Задать высоту расчёта 1,5 м",
      "Смотреть карту комфорта, а не абсолютные скорости",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\ind_wind",
    updated: "1 августа",
  },
  {
    id: "physics-crowdflow",
    topic: "physics",
    type: "tool",
    title: "CrowdFlow",
    summary: "Пешеходные потоки: узкие места и время эвакуации",
    media: "Гифка: поток людей через вестибюль",
    steps: [
      "Разметить входы, выходы и препятствия",
      "Задать сценарий загрузки",
      "Сравнить варианты планировки по времени",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\crowdflow",
    updated: "23 июля",
  },
  {
    id: "physics-leninsky",
    topic: "physics",
    type: "case",
    title: "Инсоляция дворов МФК на Ленинском",
    summary: "Четыре варианта застройки проверены за один день",
    project: "2-04-2026 МФК Ленинский",
    media: "Гифка: сравнение вариантов застройки",
    steps: [
      "Посмотреть, как оформлен отчёт для заказчика",
      "Взять шаблон отчёта",
      "Заявка «Хочу так же» — соберём под ваши варианты",
    ],
    files: "X:\\CompDesign_Projects\\2-04-2026\\solar",
    updated: "11 августа",
  },

  // «Много уникальных элементов»
  {
    id: "unique-panels",
    topic: "unique",
    type: "case",
    title: "1 400 уникальных панелей фасада",
    summary: "Марки, ведомость и раскладка собираются автоматически",
    project: "1-19-2026 МР Верейская БЦ",
    media: "Гифка: маркировка панелей",
    steps: [
      "Посмотреть структуру ведомости",
      "Проверить правило маркировки на своём фасаде",
      "Заявка «Хочу так же»",
    ],
    files: "X:\\CompDesign_Projects\\1-19-2026\\panels",
    updated: "5 августа",
  },
  {
    id: "unique-layout-module",
    topic: "unique",
    type: "module",
    title: "Раскладка панелей по кривой",
    summary: "Переиспользуемое определение: шаг, допуск, нумерация",
    media: "Гифка: раскладка по кривой",
    steps: [
      "Подать кривую и шаг разбивки",
      "Выбрать правило нумерации",
      "Проверить стыки на изломах",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\panel_layout",
    updated: "19 июля",
  },

  // «Действие повторяется по всему проекту» — утилиты
  {
    id: "repeat-ind-tools",
    topic: "repeat",
    type: "tool",
    title: "IND Tools",
    summary: "Набор утилит: репараметризация кривой, чистка, переименование",
    media: "Гифка: утилита в работе",
    steps: [
      "Установить набор из общей папки",
      "Найти нужную утилиту в панели IND",
      "Утилиты под задачу нет — оставить заявку, добавим",
    ],
    files: "X:\\CompDesign_Projects\\Library\\tools\\ind_tools",
    updated: "14 августа",
  },

  // «Нужно перебрать много вариантов»
  {
    id: "variants-batch",
    topic: "variants",
    type: "module",
    title: "Пакетный перебор вариантов",
    summary: "Сетка параметров, рендер каждого варианта и сводная таблица",
    media: "Гифка: сетка вариантов массинга",
    steps: [
      "Задать параметры и их диапазоны",
      "Запустить перебор на ночь",
      "Сравнить варианты по таблице, а не на глаз",
    ],
    files: "X:\\CompDesign_Projects\\Library\\gh_definitions\\batch_variants",
    updated: "2 августа",
  },
];

export function materialsByTopic(topic: string): Material[] {
  return MATERIALS.filter((m) => m.topic === topic);
}

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

/**
 * Лента потока: то, что отдел делает и сделал, без оформления.
 *
 * В отличие от материалов эти строки никто не готовит руками — они
 * появляются из текущих и закрытых заявок. Ценность строки — название,
 * проект и путь к папке с файлами.
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
    id: "f-1",
    title: "Раскладка ламелей входной группы",
    project: "1-19-2026 МР Верейская БЦ",
    status: "in_work",
    owner: "Егор",
    files: "X:\\CompDesign_Projects\\1-19-2026\\louvers",
    when: "с 18 августа",
  },
  {
    id: "f-2",
    title: "Инсоляция двора, вариант с башней",
    project: "2-04-2026 МФК Ленинский",
    status: "in_work",
    owner: "Дарий",
    files: "X:\\CompDesign_Projects\\2-04-2026\\solar",
    when: "с 19 августа",
  },
  {
    id: "f-3",
    title: "Перенос фасада в Revit",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-19-2026\\revit",
    when: "15 августа",
  },
  {
    id: "f-4",
    title: "Пешеходные потоки вестибюля",
    project: "1-69-2024 Western Bus Station Bishkek",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-69-2024\\crowd",
    when: "12 августа",
  },
  {
    id: "f-5",
    title: "Ведомость уникальных панелей",
    project: "1-19-2026 МР Верейская БЦ",
    status: "done",
    files: "X:\\CompDesign_Projects\\1-19-2026\\panels",
    when: "5 августа",
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
    title: "Ламели фасада перенести в Revit",
    originLabel: "Кейс · Фасад Верейской БЦ передан в Revit",
    project: "1-19-2026 МР Верейская БЦ",
    stage: 2,
    when: "отправлена 18 августа",
  },
  {
    id: "r-002",
    title: "Инсоляция двух вариантов двора",
    originLabel: "Инструмент · IND Solar",
    project: "2-04-2026 МФК Ленинский",
    stage: 1,
    flag: "Требуется уточнение",
    when: "отправлена 19 августа",
  },
  {
    id: "r-003",
    title: "Ведомость панелей по новой раскладке",
    originLabel: "Тема · Много уникальных элементов",
    project: "1-19-2026 МР Верейская БЦ",
    stage: 3,
    when: "результат 19 августа",
  },
  {
    id: "r-004",
    title: "Раскладка ламелей входной группы",
    originLabel: "Отслеживаете задачу отдела",
    project: "1-19-2026 МР Верейская БЦ",
    stage: 2,
    watching: true,
    when: "в работе с 18 августа",
  },
];

export function myRequestById(id: string): MyRequest | undefined {
  return MY_REQUESTS.find((r) => r.id === id);
}
