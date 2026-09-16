using System.Text.RegularExpressions;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Requests;

/// <summary>
/// Заявка как её видят бот и кабинет: поля формы под своими именами плюс
/// служебное из задачи Pyrus. Единственное хранилище — сама задача.
/// </summary>
public sealed record RequestRecord
{
    public required long TaskId { get; init; }
    public long? UserId { get; init; }
    public string Author { get; init; } = "";
    public string CaseTitle { get; init; } = "";
    public string Description { get; init; } = "";
    public string? SourcePath { get; init; }
    public string? Project { get; init; }
    public string? Origin { get; init; }
    public string? Deadline { get; init; }
    public string? Expected { get; init; }
    public string BoardStatus { get; init; } = "";
    public long? ChatMessageId { get; init; }
    public int Photos { get; init; }
    public IReadOnlyList<long> Watchers { get; init; } = [];
    public string? Created { get; init; }
    public string? ClosedAt { get; init; }
    public bool Closed { get; init; }
    /// <summary>Поле «Номер заявки в боте» — осталось у старых задач; у новых номер = id задачи.</summary>
    public long? LegacyNumber { get; init; }
    /// <summary>Последний вопрос отдела, пока задача в колонке «Требуется уточнение».</summary>
    public string? Question { get; init; }

    public long Number => LegacyNumber ?? TaskId;
}

public static partial class RequestParser
{
    /// <summary>Договорённость с кабинетом: вопрос отдела уходит комментарием с этим началом.</summary>
    public const string QuestionPrefix = "Вопрос заявителю:";

    /// <summary>Подписка на задачу из Mini App — комментарий с этим началом; снимается «Отписка: …».</summary>
    public const string WatchPrefix = "Подписка:";
    public const string UnwatchPrefix = "Отписка:";

    [GeneratedRegex(@"^(Подписка|Отписка):\s*tg:(\d+)")]
    private static partial Regex WatchRegex();

    public static RequestRecord FromTask(PyrusTask task)
    {
        var values = task.ValuesByName();
        string? Get(string name) => values.TryGetValue(name, out var v) ? v : null;

        var status = Get(Field.Status) ?? "";
        return new RequestRecord
        {
            TaskId = task.Id,
            UserId = ParseLong(Get(Field.TelegramId)),
            Author = Get(Field.Author) ?? "",
            CaseTitle = Get(Field.Topic) ?? "",
            Description = Get(Field.Description) ?? "",
            SourcePath = Get(Field.Source),
            Project = Get(Field.Project),
            Origin = Get(Field.Origin),
            Deadline = Get(Field.Deadline),
            Expected = Get(Field.Expected),
            BoardStatus = status,
            ChatMessageId = ParseLong(Get(Field.ChatMessage)),
            Photos = task.Attachments.Count,
            Watchers = Watchers(task.Comments),
            Created = task.CreateDate,
            ClosedAt = task.CloseDate,
            Closed = task.Closed,
            LegacyNumber = ParseLong(Get(Field.RequestNo)),
            Question = status == Requests.BoardStatus.Clarify ? LastQuestion(task.Comments) : null,
        };
    }

    /// <summary>
    /// Кто подписался на задачу: комментарии «Подписка: tg:&lt;id&gt;», снятые
    /// последующей «Отписка: tg:&lt;id&gt;».
    /// </summary>
    public static IReadOnlyList<long> Watchers(IEnumerable<PyrusComment> comments)
    {
        var ids = new SortedSet<long>();
        foreach (var comment in comments)
        {
            var match = WatchRegex().Match((comment.Text ?? "").Trim());
            if (!match.Success)
            {
                continue;
            }

            var id = long.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
            if (match.Groups[1].Value == "Подписка")
            {
                ids.Add(id);
            }
            else
            {
                ids.Remove(id);
            }
        }

        return [.. ids];
    }

    public static string? LastQuestion(IEnumerable<PyrusComment> comments)
    {
        string? question = null;
        foreach (var comment in comments)
        {
            var text = (comment.Text ?? "").Trim();
            if (text.StartsWith(QuestionPrefix, StringComparison.Ordinal))
            {
                question = text[QuestionPrefix.Length..].Trim();
            }
        }

        return question;
    }

    private static long? ParseLong(string? raw) =>
        !string.IsNullOrEmpty(raw) && long.TryParse(raw, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
}
