using System.Net;
using CompDesignBot.Features.Catalog;
using CompDesignBot.Features.Requests;

namespace CompDesignBot.Channels.Telegram;

/// <summary>Единственный рендерер карточки заявки в чате отдела (HTML Telegram).</summary>
public static class RequestCard
{
    /// <summary>Жёсткий лимит Telegram на подпись к фото/альбому.</summary>
    public const int CaptionLimit = 1024;

    public static string Escape(string? text) => WebUtility.HtmlEncode(text ?? "");

    /// <summary>
    /// Карточка заявки. Весь пользовательский текст экранируется.
    /// <paramref name="maxLen"/> — для подписи к фото (карточки старых заявок):
    /// обрезается только описание, чтобы не разрезать HTML-теги в шапке и хвосте.
    /// </summary>
    public static string Render(RequestRecord request, string status = ChatStatus.New, int? maxLen = null, string? actorLine = null) =>
        Render(request.TaskId, request.CaseTitle, request.Description, request.SourcePath, request.Author, status, maxLen, actorLine, request.Expected);

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
            var fixedLen = RequestText.CodePoints(string.Join('\n', head)) + RequestText.CodePoints(string.Join('\n', tail)) + 2;
            var budget = Math.Max(limit - fixedLen, 10);
            if (RequestText.CodePoints(desc) > budget)
            {
                desc = RequestText.Truncate(desc, budget - 1).TrimEnd() + "…";
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
}
