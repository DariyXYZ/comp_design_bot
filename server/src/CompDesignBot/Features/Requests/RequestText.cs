using System.Text;

namespace CompDesignBot.Features.Requests;

/// <summary>Текстовые правила заявки, не зависящие от канала: лимиты, шапка описания, выдержка.</summary>
public static class RequestText
{
    public const int MaxDescription = 3000;
    public const int MaxSource = 500;
    /// <summary>Проект, срок, название основы — короткие строки.</summary>
    public const int MaxShortField = 200;
    /// <summary>Ожидаемый результат — абзац, не описание целиком.</summary>
    public const int MaxExpected = 1500;
    /// <summary>Столько картинок разрешает форма; лишнее отбрасывается.</summary>
    public const int MaxPhotos = 6;

    /// <summary>Шапка, которую дописывает заявка из Mini App: в списке и ленте она бесполезна.</summary>
    public static readonly string[] HeaderKeys = ["Проект:", "Основа:", "Срок:", "Картинки:"];

    private const int ExcerptLimit = 70;

    /// <summary>
    /// Описание заявки с шапкой: проект, основа и срок дописываются в текст, а
    /// не только в поля формы — карточка в чате отдела рендерится из описания и
    /// должна сохранять их при смене статуса.
    /// </summary>
    public static string ComposeDescription(string description, string? project, string? origin, string? deadline, int photos)
    {
        var head = new List<string>();
        if (!string.IsNullOrEmpty(project))
        {
            head.Add($"Проект: {project}");
        }

        if (!string.IsNullOrEmpty(origin))
        {
            head.Add($"Основа: {origin}");
        }

        if (!string.IsNullOrEmpty(deadline))
        {
            head.Add($"Срок: {deadline}");
        }

        if (photos > 0)
        {
            head.Add($"Картинки: {photos} — приложены в задаче Pyrus");
        }

        if (head.Count == 0)
        {
            return description;
        }

        var full = string.Join('\n', head) + "\n\n" + description;
        return full.Length > MaxDescription ? full[..MaxDescription] : full;
    }

    /// <summary>
    /// Короткая суть заявки для списка. Без неё две заявки одной темы читались
    /// как одна, и начальник решил, что видит чужие.
    /// </summary>
    public static string Excerpt(string? description, int limit = ExcerptLimit)
    {
        var first = (description ?? "")
            .Split('\n')
            .Select(line => line.Trim())
            .FirstOrDefault(line => line.Length > 0 && !HeaderKeys.Any(key => line.StartsWith(key, StringComparison.Ordinal)))
            ?? "";
        return CodePoints(first) > limit ? Truncate(first, limit - 1).TrimEnd() + "…" : first;
    }

    /// <summary>Подпись автора: имя и ник, если есть.</summary>
    public static string AuthorLine(string fullName, string? username)
    {
        var name = fullName.Length > 0 ? fullName : "—";
        var handle = username?.TrimStart('@');
        return string.IsNullOrEmpty(handle) ? name : $"{name} (@{handle})";
    }

    /// <summary>Обрезает строку по лимиту; пустое — null.</summary>
    public static string? Clean(string? value, int limit)
    {
        var text = value?.Trim() ?? "";
        if (text.Length > limit)
        {
            text = text[..limit];
        }

        return text.Length > 0 ? text : null;
    }

    /// <summary>Длина в code points, как <c>len()</c> в Python-версии — эмодзи вне BMP не ломают бюджет.</summary>
    public static int CodePoints(string text) => text.EnumerateRunes().Count();

    public static string Truncate(string text, int maxCodePoints)
    {
        var builder = new StringBuilder();
        var count = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            if (count++ >= maxCodePoints)
            {
                break;
            }

            builder.Append(rune.ToString());
        }

        return builder.ToString();
    }
}
