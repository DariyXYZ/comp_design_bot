namespace CompDesignBot.Features.Requests;

/// <summary>
/// Названия полей формы доски «Вычислительное Проектирование задачи» (Pyrus 2457342).
/// Переименуют поле в Pyrus — значение перестанет заполняться, и это видно в
/// логе; ломать заявку такое расхождение не должно.
/// </summary>
public static class Field
{
    public const string Topic = "Тема";
    public const string Project = "Проект";
    public const string Description = "Описание задачи";
    public const string Expected = "Ожидаемый результат";
    public const string Origin = "Основа заявки";
    public const string Source = "Путь к проекту";
    public const string OriginPath = "Путь к решению-источнику";
    public const string Deadline = "Дата";
    public const string Author = "Telegram";
    public const string TelegramId = "Telegram ID";
    public const string RequestNo = "Номер заявки в боте";
    public const string Status = "Статус";
    public const string ChatMessage = "ID сообщения в чате";
}

/// <summary>Колонки канбан-доски отдела — варианты поля «Статус».</summary>
public static class BoardStatus
{
    public const string New = "Новая задача";
    public const string Work = "В работе";
    public const string Clarify = "Требуется уточнение";
    public const string Done = "Выполнено";
    public const string Rejected = "Отклонена";
}

/// <summary>
/// Статусы кнопок в чате отдела. Кнопок больше, чем колонок («принята» и «в
/// работе» — одна колонка): колонка говорит отделу, где задача, а кто её
/// принял — в комментарии и на карточке.
/// </summary>
public static class ChatStatus
{
    public const string New = "new";
    public const string Accepted = "accepted";
    public const string InProgress = "in_progress";
    public const string Clarify = "clarify";
    public const string Done = "done";
    public const string Rejected = "rejected";

    /// <summary>Порядок — порядок кнопок под карточкой.</summary>
    public static readonly IReadOnlyList<KeyValuePair<string, string>> Labels =
    [
        new(New, "⏸️ На паузе"),
        new(Accepted, "👀 Принята"),
        new(InProgress, "⚙️ В работе"),
        new(Clarify, "❓ Требуется уточнение"),
        new(Done, "✅ Готово"),
        new(Rejected, "❌ Отклонена"),
    ];

    private static readonly Dictionary<string, string> ByKey = Labels.ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ByLabel = Labels.ToDictionary(p => p.Value, p => p.Key, StringComparer.Ordinal);

    public static bool IsKnown(string key) => ByKey.ContainsKey(key);

    public static string Label(string key) => ByKey.TryGetValue(key, out var label) ? label : key;

    public static string? KeyByLabel(string label) => ByLabel.TryGetValue(label, out var key) ? key : null;

    /// <summary>
    /// Статус кнопки → колонка доски и действие с задачей: «Готово»/«Отклонена»
    /// закрывают, остальное переоткрывает закрытую.
    /// </summary>
    public static (string Board, string? Action)? ToBoard(string key) => key switch
    {
        New => (BoardStatus.New, "reopened"),
        Accepted => (BoardStatus.Work, "reopened"),
        InProgress => (BoardStatus.Work, "reopened"),
        Clarify => (BoardStatus.Clarify, "reopened"),
        Done => (BoardStatus.Done, "finished"),
        Rejected => (BoardStatus.Rejected, "finished"),
        _ => null,
    };

    /// <summary>Колонка доски → подпись статуса, как на кнопках в чате.</summary>
    public static string LabelForBoard(string? boardStatus, bool closed)
    {
        if (boardStatus == BoardStatus.Rejected)
        {
            return Label(Rejected);
        }

        if (closed || boardStatus == BoardStatus.Done)
        {
            return Label(Done);
        }

        if (boardStatus == BoardStatus.Clarify)
        {
            return Label(Clarify);
        }

        if (boardStatus == BoardStatus.Work)
        {
            return Label(InProgress);
        }

        return Label(New);
    }
}
