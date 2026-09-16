/**
 * Карточки тем — локально, в коде. Раньше лежали в Supabase, но восемь
 * карточек не стоят внешней базы: правка — коммит, деплой по пушу.
 * Ключи `key` — общие с ботом (bot/cases.py), менять только вместе.
 */
export type CaseRow = {
  key: string;
  title: string;
  hint: string;
  eta: string;
  image_front: string;
  image_back: string;
};

export const CASES: readonly CaseRow[] = [
  {"key": "unique", "title": "Много уникальных элементов", "hint": "Панели, ламели или МАФы не повторяются один в один — руками это дни рутины. Скрипт сам генерирует всю партию по правилам.", "eta": "2 – 3 дня", "image_front": "/topics/unique.jpg", "image_back": "/topics/unique-back.jpg"},
  {"key": "reference", "title": "Есть задумка, но неясно как собрать", "hint": "Референс — скульптура, паттерн, сложная форма, где рисунок меняется по правилу. Разберём на алгоритм и соберём прототип.", "eta": "2 – 3 дня", "image_front": "/topics/reference.jpg", "image_back": "/topics/reference-back.jpg"},
  {"key": "curved", "title": "Форма здания криволинейная", "hint": "Объём или фасад не плоский: кривизна целиком или локально. Построим параметрически и разобьём на панели под сборку.", "eta": "2 – 3 дня", "image_front": "/topics/curved.jpg", "image_back": "/topics/curved-back.jpg"},
  {"key": "revit", "title": "Геометрию нужно передать в Revit", "hint": "Форма из Rhino/Grasshopper должна жить в Revit — семействами, с чистой топологией, без мусорной сетки.", "eta": "1 – 2 дня", "image_front": "/topics/revit.jpg", "image_back": "/topics/revit-back.jpg"},
  {"key": "repeat", "title": "Действие повторяется по всему проекту", "hint": "Расстановка, разбивка, подрезка — в десятках мест, при правках всё заново. Сделаем инструмент, который пересчитывает за секунды.", "eta": "1 день", "image_front": "/topics/repeat.jpg", "image_back": "/topics/repeat-back.jpg"},
  {"key": "variants", "title": "Нужно перебрать много вариантов", "hint": "Десятки вариантов паттерна, массинга или панелизации, решение нужно уже сегодня-завтра. Меняете параметр — сразу видите результат.", "eta": "1 – 2 дня", "image_front": "/topics/variants.jpg", "image_back": "/topics/variants-back.jpg"},
  {"key": "physics", "title": "Нужно просчитать физику проекта", "hint": "Инсоляция, ветер, пешеходные потоки, шум. Считаем сценарии и визуализируем — форма подстраивается осознанно, а не на глаз.", "eta": "1 – 2 дня", "image_front": "/topics/physics.jpg", "image_back": "/topics/physics-back.jpg"},
  {"key": "custom", "title": "Нетиповая или разовая задача", "hint": "Не попадает в пункты выше: чистка геометрии, скан, графика на 3D-форму или что-то совсем новое. Разберём и решим по ситуации.", "eta": "По ТЗ", "image_front": "/topics/custom.jpg", "image_back": "/topics/custom-back.jpg"},
];
