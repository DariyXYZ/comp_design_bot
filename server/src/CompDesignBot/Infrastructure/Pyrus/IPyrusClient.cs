namespace CompDesignBot.Infrastructure.Pyrus;

/// <summary>
/// Минимальный клиент Pyrus: авторизация, схема формы, задачи, файлы, справочники.
/// Сетевые и HTTP-сбои превращаются в <see cref="PyrusException"/>; «нет такой
/// задачи» — <c>null</c>. Предметных знаний (названий полей, статусов) здесь нет —
/// их передают параметрами из <c>Features</c>.
/// </summary>
public interface IPyrusClient
{
    /// <summary>Интеграция настроена (логин и ключ). Иначе каждый метод — no-op.</summary>
    bool Enabled { get; }

    /// <summary>Схема формы: поля по названию, типы, варианты выбора. Кэш по форме на время жизни процесса.</summary>
    Task<PyrusFormSchema?> SchemaAsync(long formId, CancellationToken ct = default);

    /// <summary>Создаёт задачу по форме. <paramref name="values"/> — {название поля: значение}. Возвращает id задачи.</summary>
    Task<long?> CreateFormTaskAsync(long formId, IReadOnlyDictionary<string, object?> values, CancellationToken ct = default);

    /// <summary>
    /// Комментарий к задаче — единственный способ её изменить: текст, вложения по guid,
    /// <c>field_updates</c> по названиям полей, <c>action</c> (<c>finished</c>/<c>reopened</c>).
    /// </summary>
    Task<bool> CommentAsync(long taskId, PyrusCommentRequest request, CancellationToken ct = default);

    Task<PyrusTask?> GetTaskAsync(long taskId, CancellationToken ct = default);

    /// <summary>Весь реестр формы, включая закрытые задачи. Реестр не отдаёт вложений и комментариев.</summary>
    Task<IReadOnlyList<PyrusTask>> RegisterAsync(long formId, CancellationToken ct = default);

    /// <summary>Загружает файл; возвращает guid, который можно приложить к задаче один раз.</summary>
    Task<string?> UploadFileAsync(string fileName, Stream content, string contentType, CancellationToken ct = default);

    /// <summary>Файл вложения под ключом сервера — потоком, не в память.</summary>
    Task<HttpResponseMessage?> DownloadAsync(string url, CancellationToken ct = default);

    /// <summary>Позиции справочника: id и первая колонка как название.</summary>
    Task<IReadOnlyList<CatalogItem>> CatalogItemsAsync(long catalogId, CancellationToken ct = default);
}

public sealed record PyrusCommentRequest
{
    public string Text { get; init; } = "";
    /// <summary>Поля задачи по названию; форма нужна, чтобы найти их id и варианты.</summary>
    public IReadOnlyDictionary<string, object?>? SetFields { get; init; }
    public long? FormId { get; init; }
    public string? Action { get; init; }
    public IReadOnlyList<string>? AttachmentGuids { get; init; }
}

public sealed class PyrusException(string message, Exception? inner = null) : Exception(message, inner);
