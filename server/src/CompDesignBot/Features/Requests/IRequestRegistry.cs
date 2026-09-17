namespace CompDesignBot.Features.Requests;

/// <summary>Что нужно, чтобы создать заявку на доске отдела.</summary>
public sealed record NewRequest
{
    public required string CaseTitle { get; init; }
    public required string Description { get; init; }
    public required string Author { get; init; }
    public long? TgUserId { get; init; }
    public string? SourcePath { get; init; }
    public string? Expected { get; init; }
    public string? Project { get; init; }
    public long? ProjectId { get; init; }
    public string? Origin { get; init; }
    public string? OriginPath { get; init; }
    public string? Deadline { get; init; }
}

/// <summary>
/// Реестр заявок — контракт модуля заявок к хранилищу. Реализация сейчас одна,
/// Pyrus (<c>Infrastructure/Pyrus/PyrusRequestRegistry</c>). Все методы бросают
/// <see cref="Infrastructure.Pyrus.PyrusException"/>, если хранилище не ответило:
/// что с этим делать, решает вызывающий (API — 502, канал — сообщение человеку).
/// </summary>
public interface IRequestRegistry
{
    /// <summary>Интеграция настроена. Иначе заявки не создаются, списки пустые.</summary>
    bool Enabled { get; }

    /// <summary>Создаёт заявку. Возвращает id задачи — он же номер заявки везде дальше.</summary>
    Task<long?> CreateAsync(NewRequest request, CancellationToken ct = default);

    /// <summary>Заявка по номеру; null — нет такой.</summary>
    Task<RequestRecord?> GetAsync(long taskId, CancellationToken ct = default);

    /// <summary>Заявки одного человека, свежие сверху.</summary>
    Task<IReadOnlyList<RequestRecord>> ListByAuthorAsync(long tgUserId, CancellationToken ct = default);

    /// <summary>Запоминает в заявке карточку в чате отдела — по ней её перерисовывают.</summary>
    Task SetChatMessageAsync(long taskId, long messageId, CancellationToken ct = default);

    /// <summary>Переводит заявку в колонку доски; <paramref name="action"/> — закрыть/переоткрыть или null.</summary>
    Task<bool> SetStatusAsync(long taskId, string boardStatus, string? action, string note, CancellationToken ct = default);

    /// <summary>Запись в историю заявки (кто принял, причина отказа, оценка, подписка).</summary>
    Task AddCommentAsync(long taskId, string text, CancellationToken ct = default);

    /// <summary>Комментарий с изменением состояния — для действий из кабинета.</summary>
    Task CommentAsync(long taskId, string text, string? action, string? boardStatus, CancellationToken ct = default);

    /// <summary>Привязывает к заявке файлы, уже загруженные в хранилище. Возвращает число привязанных.</summary>
    Task<int> AttachUploadedAsync(long taskId, IReadOnlyList<string> guids, CancellationToken ct = default);
}

/// <summary>
/// Чат отдела — куда уходит карточка заявки и служебные сообщения. Реализация —
/// <c>Channels/Telegram/DeptChat</c>; модуль заявок не знает про Telegram.
/// </summary>
public interface IDeptChannel
{
    bool Configured { get; }

    /// <summary>Публикует карточку заявки с кнопками статусов; возвращает id сообщения. Бросает при отказе.</summary>
    Task<long> PostCardAsync(RequestRecord request, CancellationToken ct = default);

    /// <summary>Пишет в чат отдела обычным текстом; false — чат не настроен или отказ. Не бросает.</summary>
    Task<bool> TryPostAsync(string text, CancellationToken ct = default);
}
