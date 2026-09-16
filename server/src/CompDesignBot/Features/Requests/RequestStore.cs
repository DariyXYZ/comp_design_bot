using CompDesignBot.Infrastructure.Pyrus;

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
/// Заявки поверх Pyrus. Два режима на одну и ту же операцию:
/// методы для бота никогда не бросают (в чате статус уже сменён, заявка уже
/// создана — падать поздно, ошибка идёт в лог), методы для API с суффиксом
/// <c>OrThrow</c> отдают <see cref="PyrusException"/> наверх — там её
/// превращают в 502.
/// </summary>
public sealed class RequestStore
{
    private readonly IPyrusClient _pyrus;
    private readonly ILogger<RequestStore> _log;

    public RequestStore(IPyrusClient pyrus, ILogger<RequestStore> log)
    {
        _pyrus = pyrus;
        _log = log;
    }

    public bool Enabled => _pyrus.Enabled;

    /// <summary>Создаёт заявку на доске. Возвращает id задачи — он же номер заявки — или null.</summary>
    public async Task<long?> SendRequestAsync(NewRequest request, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        try
        {
            return await _pyrus.CreateFormTaskAsync(new Dictionary<string, object?>
            {
                [Field.Topic] = request.CaseTitle,
                // «Проект» бывает текстом (уходит название) и справочником (нужен
                // id позиции из подсказки Mini App; без него поле пустое, название
                // всё равно есть в шапке описания).
                [Field.Project] = new CatalogValue(request.Project, request.ProjectId),
                [Field.Description] = request.Description,
                [Field.Expected] = request.Expected,
                [Field.Origin] = request.Origin,
                [Field.Source] = request.SourcePath,
                [Field.OriginPath] = request.OriginPath,
                [Field.Deadline] = request.Deadline,
                [Field.Author] = request.Author,
                [Field.TelegramId] = request.TgUserId,
                [Field.Status] = BoardStatus.New,
            }, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось создать задачу для заявки от {Author}", request.Author);
            return null;
        }
    }

    /// <summary>Заявка по номеру. Нет задачи или Pyrus лёг — null.</summary>
    public async Task<RequestRecord?> GetRequestAsync(long taskId, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0)
        {
            return null;
        }

        try
        {
            var task = await _pyrus.GetTaskAsync(taskId, ct);
            return task is null ? null : RequestParser.FromTask(task);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось прочитать задачу {TaskId}", taskId);
            return null;
        }
    }

    /// <summary>Заявки человека, свежие сверху. Никогда не бросает.</summary>
    public async Task<IReadOnlyList<RequestRecord>> ListUserRequestsAsync(long tgUserId, CancellationToken ct = default)
    {
        try
        {
            return await ListUserRequestsOrThrowAsync(tgUserId, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось получить заявки для {UserId}", tgUserId);
            return [];
        }
    }

    /// <summary>
    /// Заявки одного человека из реестра формы. Фильтрация на нашей стороне:
    /// <c>filters</c> в <c>forms/{id}/register</c> Pyrus молча игнорирует.
    /// </summary>
    public async Task<IReadOnlyList<RequestRecord>> ListUserRequestsOrThrowAsync(long tgUserId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return [];
        }

        var schema = await _pyrus.SchemaAsync(ct);
        if (schema is null || !schema.FieldIds.ContainsKey(Field.TelegramId))
        {
            _log.LogWarning("Pyrus: в форме нет поля «{Field}» — список заявок недоступен", Field.TelegramId);
            return [];
        }

        var tasks = await _pyrus.RegisterAsync(ct);
        return tasks
            .Select(RequestParser.FromTask)
            .Where(r => r.UserId == tgUserId)
            // Свежие сверху: человек ищет последнюю заявку, а не первую.
            .OrderByDescending(r => r.Created ?? "", StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Одна заявка, если она этого человека. Проверка владельца здесь, а не в
    /// маршрутах: забыть её в одном из них значило бы отдать чужие заявки.
    /// </summary>
    public async Task<RequestRecord?> UserRequestOrThrowAsync(long taskId, long tgUserId, CancellationToken ct = default)
    {
        var task = await _pyrus.GetTaskAsync(taskId, ct);
        if (task is null)
        {
            return null;
        }

        var record = RequestParser.FromTask(task);
        return record.UserId == tgUserId ? record : null;
    }

    /// <summary>Запоминает в задаче карточку в чате отдела — по ней её перерисовывают.</summary>
    public async Task<bool> SetChatMessageAsync(long taskId, long messageId, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0)
        {
            return false;
        }

        try
        {
            return await _pyrus.CommentAsync(taskId, new PyrusCommentRequest
            {
                SetFields = new Dictionary<string, object?> { [Field.ChatMessage] = messageId },
            }, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось записать карточку чата в задачу {TaskId}", taskId);
            return false;
        }
    }

    /// <summary>
    /// Переводит задачу в колонку по статусу кнопки в чате. «Готово»/«Отклонена»
    /// закрывают; любой другой статус у закрытой задачи переоткрывает её, открытую
    /// <c>reopened</c> не трогает.
    /// </summary>
    public async Task<bool> SetStatusAsync(long taskId, string chatStatus, string note, bool closed, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0 || ChatStatus.ToBoard(chatStatus) is not { } target)
        {
            return false;
        }

        var action = target.Action == "reopened" && !closed ? null : target.Action;
        try
        {
            var ok = await _pyrus.CommentAsync(taskId, new PyrusCommentRequest
            {
                Text = note,
                SetFields = new Dictionary<string, object?> { [Field.Status] = target.Board },
                Action = action,
            }, ct);
            if (!ok)
            {
                _log.LogWarning("Pyrus: задача {TaskId} не переведена в «{Board}»", taskId, target.Board);
                return false;
            }

            _log.LogInformation("Pyrus: задача {TaskId} → «{Board}» {Action}", taskId, target.Board, action ?? "");
            return true;
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось сменить статус задачи {TaskId}", taskId);
            return false;
        }
    }

    /// <summary>Запись в историю задачи (кто принял, причина отказа, оценка). Никогда не бросает.</summary>
    public async Task<bool> AddCommentAsync(long taskId, string text, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0 || text.Length == 0)
        {
            return false;
        }

        try
        {
            return await _pyrus.CommentAsync(taskId, new PyrusCommentRequest { Text = text }, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось добавить комментарий к задаче {TaskId}", taskId);
            return false;
        }
    }

    /// <summary>Комментарий с действием и колонкой — для действий из кабинета. Бросает.</summary>
    public async Task CommentOrThrowAsync(long taskId, string text, string? action, string? boardStatus, CancellationToken ct = default)
    {
        var request = new PyrusCommentRequest
        {
            Text = text,
            Action = action,
            SetFields = boardStatus is null ? null : new Dictionary<string, object?> { [Field.Status] = boardStatus },
        };
        await _pyrus.CommentAsync(taskId, request, ct);
    }

    /// <summary>
    /// Прикладывает картинки к задаче: сначала <c>files/upload</c> даёт guid, потом
    /// guid идут комментарием. Заявка уже создана, потеря картинки её не отменяет.
    /// </summary>
    public async Task<int> AttachPhotosAsync(long taskId, IReadOnlyList<(string Name, byte[] Data)> files, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0 || files.Count == 0)
        {
            return 0;
        }

        try
        {
            var guids = new List<string>();
            foreach (var (name, data) in files)
            {
                using var stream = new MemoryStream(data);
                var guid = await _pyrus.UploadFileAsync(name, stream, "image/jpeg", ct);
                if (guid is not null)
                {
                    guids.Add(guid);
                }
            }

            return await AttachGuidsAsync(taskId, guids, "Картинки из заявки (присланы боту в Telegram)", ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось приложить картинки к задаче {TaskId}", taskId);
            return 0;
        }
    }

    /// <summary>Привязывает к задаче картинки, уже загруженные из формы Mini App.</summary>
    public async Task<int> AttachUploadedAsync(long taskId, IReadOnlyList<string> guids, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0 || guids.Count == 0)
        {
            return 0;
        }

        try
        {
            return await AttachGuidsAsync(taskId, guids, "Картинки из заявки (приложены в Mini App)", ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Pyrus: не удалось привязать картинки к задаче {TaskId}", taskId);
            return 0;
        }
    }

    private async Task<int> AttachGuidsAsync(long taskId, IReadOnlyList<string> guids, string text, CancellationToken ct)
    {
        if (guids.Count == 0)
        {
            return 0;
        }

        var ok = await _pyrus.CommentAsync(taskId, new PyrusCommentRequest { Text = text, AttachmentGuids = guids }, ct);
        if (!ok)
        {
            _log.LogWarning("Pyrus: вложения загружены, но комментарий к {TaskId} не создан", taskId);
            return 0;
        }

        _log.LogInformation("Pyrus: к задаче {TaskId} приложено файлов: {Count}", taskId, guids.Count);
        return guids.Count;
    }
}
