using System.Text.Json.Serialization;

namespace CompDesignBot.Features.Topics;

/// <summary>
/// Карточка темы — восемь штук, общие для бота и Mini App. Ключи <c>Key</c>
/// совпадают с <c>web/src/features/topics/data.ts</c>, менять только вместе.
/// Имена в JSON — snake_case: клиент Mini App читает <c>image_front</c>.
/// </summary>
public sealed record CaseRow(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("hint")] string Hint,
    [property: JsonPropertyName("eta")] string Eta,
    [property: JsonPropertyName("image_front")] string ImageFront,
    [property: JsonPropertyName("image_back")] string ImageBack);

public static class Cases
{
    public static readonly IReadOnlyList<CaseRow> All =
    [
        new("unique", "Много уникальных элементов", "Панели, ламели или МАФы не повторяются один в один — руками это дни рутины. Скрипт сам генерирует всю партию по правилам.", "2 – 3 дня", "/topics/unique.jpg", "/topics/unique-back.jpg"),
        new("reference", "Есть задумка, но неясно как собрать", "Референс — скульптура, паттерн, сложная форма, где рисунок меняется по правилу. Разберём на алгоритм и соберём прототип.", "2 – 3 дня", "/topics/reference.jpg", "/topics/reference-back.jpg"),
        new("curved", "Форма здания криволинейная", "Объём или фасад не плоский: кривизна целиком или локально. Построим параметрически и разобьём на панели под сборку.", "2 – 3 дня", "/topics/curved.jpg", "/topics/curved-back.jpg"),
        new("revit", "Геометрию нужно передать в Revit", "Форма из Rhino/Grasshopper должна жить в Revit — семействами, с чистой топологией, без мусорной сетки.", "1 – 2 дня", "/topics/revit.jpg", "/topics/revit-back.jpg"),
        new("repeat", "Действие повторяется по всему проекту", "Расстановка, разбивка, подрезка — в десятках мест, при правках всё заново. Сделаем инструмент, который пересчитывает за секунды.", "1 день", "/topics/repeat.jpg", "/topics/repeat-back.jpg"),
        new("variants", "Нужно перебрать много вариантов", "Десятки вариантов паттерна, массинга или панелизации, решение нужно уже сегодня-завтра. Меняете параметр — сразу видите результат.", "1 – 2 дня", "/topics/variants.jpg", "/topics/variants-back.jpg"),
        new("physics", "Нужно просчитать физику проекта", "Инсоляция, ветер, пешеходные потоки, шум. Считаем сценарии и визуализируем — форма подстраивается осознанно, а не на глаз.", "1 – 2 дня", "/topics/physics.jpg", "/topics/physics-back.jpg"),
        new("custom", "Нетиповая или разовая задача", "Не попадает в пункты выше: чистка геометрии, скан, графика на 3D-форму или что-то совсем новое. Разберём и решим по ситуации.", "По ТЗ", "/topics/custom.jpg", "/topics/custom-back.jpg"),
    ];

    private static readonly Dictionary<string, CaseRow> ByKey = All.ToDictionary(c => c.Key, StringComparer.Ordinal);

    public static CaseRow? Find(string? key) =>
        key is not null && ByKey.TryGetValue(key, out var row) ? row : null;

    public static bool Exists(string? key) => key is not null && ByKey.ContainsKey(key);

    /// <summary>
    /// Ориентир по срокам — по названию темы: заявка из Pyrus несёт только
    /// название, а не ключ.
    /// </summary>
    public static string EtaByTitle(string? title)
    {
        foreach (var row in All)
        {
            if (row.Title == title)
            {
                return row.Eta.Length > 0 ? row.Eta : "—";
            }
        }

        return "—";
    }
}
