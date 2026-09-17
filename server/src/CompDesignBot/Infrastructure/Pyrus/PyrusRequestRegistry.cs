using CompDesignBot.Features.Requests;
using CompDesignBot.Hosting;

namespace CompDesignBot.Infrastructure.Pyrus;

/// <summary>
/// Реестр заявок поверх формы-доски отдела в Pyrus. Знает, в какие поля формы
/// ложится заявка и как колонка доски выражается через <c>field_updates</c>;
/// названия полей и колонок — в <c>Features/Requests/Board.cs</c>.
/// </summary>
public sealed class PyrusRequestRegistry : IRequestRegistry
{
    private readonly IPyrusClient _pyrus;
    private readonly long _formId;
    private readonly ILogger<PyrusRequestRegistry> _log;

    public PyrusRequestRegistry(IPyrusClient pyrus, AppOptions options, ILogger<PyrusRequestRegistry> log)
    {
        _pyrus = pyrus;
        _formId = options.PyrusFormId ?? 0;
        _log = log;
    }

    public bool Enabled => _pyrus.Enabled && _formId > 0;

    public async Task<long?> CreateAsync(NewRequest request, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        return await _pyrus.CreateFormTaskAsync(_formId, new Dictionary<string, object?>
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

    public async Task<RequestRecord?> GetAsync(long taskId, CancellationToken ct = default)
    {
        if (!Enabled || taskId <= 0)
        {
            return null;
        }

        var task = await _pyrus.GetTaskAsync(taskId, ct);
        return task is null ? null : RequestParser.FromTask(task);
    }

    /// <summary>
    /// Фильтрация на нашей стороне: <c>filters</c> в <c>forms/{id}/register</c>
    /// Pyrus молча игнорирует, и полагаться на него значит однажды показать
    /// человеку чужие заявки.
    /// </summary>
    public async Task<IReadOnlyList<RequestRecord>> ListByAuthorAsync(long tgUserId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return [];
        }

        var schema = await _pyrus.SchemaAsync(_formId, ct);
        if (schema is null || !schema.FieldIds.ContainsKey(Field.TelegramId))
        {
            _log.LogWarning("Pyrus: в форме нет поля «{Field}» — список заявок недоступен", Field.TelegramId);
            return [];
        }

        var tasks = await _pyrus.RegisterAsync(_formId, ct);
        return tasks
            .Select(RequestParser.FromTask)
            .Where(r => r.UserId == tgUserId)
            // Свежие сверху: человек ищет последнюю заявку, а не первую.
            .OrderByDescending(r => r.Created ?? "", StringComparer.Ordinal)
            .ToList();
    }

    public Task SetChatMessageAsync(long taskId, long messageId, CancellationToken ct = default) =>
        _pyrus.CommentAsync(taskId, new PyrusCommentRequest
        {
            FormId = _formId,
            SetFields = new Dictionary<string, object?> { [Field.ChatMessage] = messageId },
        }, ct);

    public async Task<bool> SetStatusAsync(long taskId, string boardStatus, string? action, string note, CancellationToken ct = default)
    {
        var ok = await _pyrus.CommentAsync(taskId, new PyrusCommentRequest
        {
            Text = note,
            FormId = _formId,
            SetFields = new Dictionary<string, object?> { [Field.Status] = boardStatus },
            Action = action,
        }, ct);
        if (ok)
        {
            _log.LogInformation("Pyrus: задача {TaskId} → «{Board}» {Action}", taskId, boardStatus, action ?? "");
        }
        else
        {
            _log.LogWarning("Pyrus: задача {TaskId} не переведена в «{Board}»", taskId, boardStatus);
        }

        return ok;
    }

    public Task AddCommentAsync(long taskId, string text, CancellationToken ct = default) =>
        _pyrus.CommentAsync(taskId, new PyrusCommentRequest { Text = text }, ct);

    public Task CommentAsync(long taskId, string text, string? action, string? boardStatus, CancellationToken ct = default) =>
        _pyrus.CommentAsync(taskId, new PyrusCommentRequest
        {
            Text = text,
            Action = action,
            FormId = _formId,
            SetFields = boardStatus is null ? null : new Dictionary<string, object?> { [Field.Status] = boardStatus },
        }, ct);

    /// <summary>guid из <c>files/upload</c> одноразовый: файл привязывается к задаче комментарием.</summary>
    public async Task<int> AttachUploadedAsync(long taskId, IReadOnlyList<string> guids, CancellationToken ct = default)
    {
        if (guids.Count == 0)
        {
            return 0;
        }

        var ok = await _pyrus.CommentAsync(taskId, new PyrusCommentRequest
        {
            Text = "Картинки из заявки (приложены в Mini App)",
            AttachmentGuids = guids,
        }, ct);
        if (!ok)
        {
            _log.LogWarning("Pyrus: файлы к задаче {TaskId} не привязаны", taskId);
            return 0;
        }

        _log.LogInformation("Pyrus: к задаче {TaskId} привязано файлов: {Count}", taskId, guids.Count);
        return guids.Count;
    }
}
