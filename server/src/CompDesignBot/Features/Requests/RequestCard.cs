using System.Net;
using System.Text;
using CompDesignBot.Features.Topics;

namespace CompDesignBot.Features.Requests;

/// <summary>Единственный рендерер карточки заявки для чата отдела и превью.</summary>
public static class RequestCard
{
    /// <summary>Жёсткий лимит Telegram на подпись к фото/альбому.</summary>
    public const int CaptionLimit = 1024;

    /// <summary>Шапка, которую дописывает заявка из Mini App: в списке и ленте она бесполезна.</summary>
    public static readonly string[] HeaderKeys = ["Проект:", "Основа:", "Срок:", "Картинки:"];

    private const int ExcerptLimit = 70;

    public static string Escape(string? text) => WebUtility.HtmlEncode(text ?? "");

    /// <summary>
    /// Карточка заявки. Весь пользовательский текст экранируется.
    /// <paramref name="maxLen"/> — для подписи к фото: обрезается только описание,
    /// чтобы не разрезать HTML-теги в шапке и хвосте. Длины считаются в code
    /// points, как <c>len()</c> в Python-версии — эмодзи вне BMP не ломают бюджет.
    /// </summary>
    public static string Render(
        long? reqId,
        string caseTitle,
        string description,
        string? sourcePath,
        string author,
        string status = ChatStatus.New,
        int? maxLen = null,
        string? actorLine = null,
        string? expected = null)
    {
        // Номер заявки = id задачи Pyrus, поэтому заголовок сразу ведёт в неё.
        var header = reqId is { } id
            ? $"<a href=\"https://pyrus.com/t#id{id}\">Заявка №{id}</a>"
            : "Новая заявка";
        var head = new List<string>
        {
            $"<b>{header} · {Escape(caseTitle)}</b>",
            $"Ориентир по срокам: {Cases.EtaByTitle(caseTitle)}",
            $"От: {Escape(author)}",
            "",
        };
        var tail = new List<string>();
        if (!string.IsNullOrEmpty(expected))
        {
            tail.Add("");
            tail.Add($"🎯 Ожидаемый результат: {Escape(expected)}");
        }

        if (!string.IsNullOrEmpty(sourcePath))
        {
            tail.Add("");
            tail.Add($"📁 Исходники: <code>{Escape(sourcePath)}</code>");
        }

        tail.Add("");
        tail.Add(ChatStatus.Label(status));
        if (!string.IsNullOrEmpty(actorLine))
        {
            tail.Add(Escape(actorLine));
        }

        var desc = Escape(description);
        if (maxLen is { } limit)
        {
            // +2 — переносы строки между head/desc и между desc/tail.
            var fixedLen = CodePoints(string.Join('\n', head)) + CodePoints(string.Join('\n', tail)) + 2;
            var budget = Math.Max(limit - fixedLen, 10);
            if (CodePoints(desc) > budget)
            {
                desc = Truncate(desc, budget - 1).TrimEnd() + "…";
            }
        }

        return string.Join('\n', head.Concat([desc]).Concat(tail));
    }

    /// <summary>Короткая строка под альбомом: у альбома кнопок быть не может.</summary>
    public static string ShortLine(long reqId, string caseTitle, string status, string? actorLine = null)
    {
        var text = $"Заявка №{reqId} · {Escape(caseTitle)}\n{ChatStatus.Label(status)}";
        return string.IsNullOrEmpty(actorLine) ? text : $"{text}\n{Escape(actorLine)}";
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

    public static string AuthorLine(string fullName, string? username)
    {
        var name = fullName.Length > 0 ? fullName : "—";
        return string.IsNullOrEmpty(username) ? name : $"{name} (@{username})";
    }

    private static int CodePoints(string text) => text.EnumerateRunes().Count();

    private static string Truncate(string text, int maxCodePoints)
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
