using CompDesignBot.Features.Catalog;
using CompDesignBot.Features.Identity;
using CompDesignBot.Features.Notifications;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Requests;

/// <summary>Заявка из формы Mini App — как её присылает клиент.</summary>
public sealed record SubmitRequest
{
    public required string CaseKey { get; init; }
    public required string Description { get; init; }
    public string? Expected { get; init; }
    public string? Project { get; init; }
    public long? ProjectId { get; init; }
    public string? Deadline { get; init; }
    public string? Origin { get; init; }
    public string? OriginPath { get; init; }
    public string? Source { get; init; }
    /// <summary>guid картинок, уже загруженных в хранилище через <c>POST /api/uploads</c>.</summary>
    public IReadOnlyList<string> PhotoGuids { get; init; } = [];
}

public sealed record SubmitResult(long TaskId, bool CardDelivered);

public sealed record ActionResult(bool Delivered);

/// <summary>Итог смены статуса из чата отдела.</summary>
public abstract record StatusChangeResult
{
    public sealed record Changed(RequestRecord Request, string NewStatus, string? ActorLine) : StatusChangeResult;
    public sealed record NotFound : StatusChangeResult;
    public sealed record StorageRefused : StatusChangeResult;
}

/// <summary>
/// Все операции с заявкой — одно место. HTTP-маршруты и Telegram-канал вызывают
/// этот сервис, а не хранилище и чат напрямую: цепочка «запись в Pyrus → карточка
/// в чат → уведомление автору» не должна существовать в двух копиях.
///
/// Порядок в каждой операции один: сначала запись в реестр (это и есть
/// изменение заявки), потом чат и уведомления. Сбой доставки не откатывает
/// запись — он попадает в лог и в результат.
/// </summary>
public sealed class RequestService
{
    private readonly IRequestRegistry _registry;
    private readonly IDeptChannel _dept;
    private readonly INotifier _notifier;
    private readonly ILogger<RequestService> _log;

    public RequestService(IRequestRegistry registry, IDeptChannel dept, INotifier notifier, ILogger<RequestService> log)
    {
        _registry = registry;
        _dept = dept;
        _notifier = notifier;
        _log = log;
    }

    public bool Enabled => _registry.Enabled;

    /// <summary>Создаёт заявку от имени вошедшего человека. Бросает <see cref="PyrusException"/>, если реестр не ответил.</summary>
    public async Task<SubmitResult> SubmitAsync(SubmitRequest form, Viewer author, CancellationToken ct = default)
    {
        var topic = Cases.Find(form.CaseKey) ?? throw new ArgumentException("Неизвестная тема", nameof(form));
        var description = RequestText.Clean(form.Description, RequestText.MaxDescription)
            ?? throw new ArgumentException("Описание пустое", nameof(form));
        var guids = form.PhotoGuids.Select(g => g.Trim()).Where(g => g.Length > 0).Take(RequestText.MaxPhotos).ToList();
        var project = RequestText.Clean(form.Project, RequestText.MaxShortField);
        var origin = RequestText.Clean(form.Origin, RequestText.MaxShortField);
        var deadline = RequestText.Clean(form.Deadline, RequestText.MaxShortField);

        var request = new NewRequest
        {
            CaseTitle = topic.Title,
            Description = RequestText.ComposeDescription(description, project, origin, deadline, guids.Count),
            Author = RequestText.AuthorLine(author.Name, author.Handle),
            TgUserId = author.Id,
            // Путь к исходникам: сначала то, что указал человек, иначе папка решения.
            SourcePath = RequestText.Clean(form.Source, RequestText.MaxSource) ?? RequestText.Clean(form.OriginPath, RequestText.MaxSource),
            Expected = RequestText.Clean(form.Expected, RequestText.MaxExpected),
            Project = project,
            ProjectId = form.ProjectId,
            Origin = origin,
            OriginPath = RequestText.Clean(form.OriginPath, RequestText.MaxSource),
            Deadline = deadline,
        };

        var taskId = await _registry.CreateAsync(request, ct) ?? throw new PyrusException("Pyrus: задача не создана");

        // Картинки — отдельным шагом: заявка уже создана, сбой привязки её не рушит.
        try
        {
            await _registry.AttachUploadedAsync(taskId, guids, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{TaskId}: картинки не привязаны", taskId);
        }

        var record = await TryGetAsync(taskId, ct) ?? new RequestRecord
        {
            TaskId = taskId,
            UserId = author.Id,
            Author = request.Author,
            CaseTitle = request.CaseTitle,
            Description = request.Description,
            SourcePath = request.SourcePath,
            Expected = request.Expected,
            BoardStatus = BoardStatus.New,
        };

        if (!_dept.Configured)
        {
            _log.LogWarning("Заявка №{TaskId} создана, чат отдела не настроен", taskId);
            return new SubmitResult(taskId, false);
        }

        try
        {
            var messageId = await _dept.PostCardAsync(record, ct);
            // Карточка ушла и рабочая; если этот вспомогательный write упадёт,
            // заявителю нельзя говорить, что заявка не доставлена.
            try
            {
                await _registry.SetChatMessageAsync(taskId, messageId, ct);
            }
            catch (PyrusException e)
            {
                _log.LogError(e, "Заявка №{TaskId}: id карточки в чате не записан", taskId);
            }

            return new SubmitResult(taskId, true);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Заявка №{TaskId} создана, но не доставлена в чат отдела", taskId);
            return new SubmitResult(taskId, false);
        }
    }

    public Task<IReadOnlyList<RequestRecord>> ListMineAsync(long viewerId, CancellationToken ct = default) =>
        _registry.ListByAuthorAsync(viewerId, ct);

    /// <summary>
    /// Одна заявка, если она этого человека. Проверка владельца здесь, а не в
    /// маршрутах: забыть её в одном из них значило бы отдать чужие заявки.
    /// </summary>
    public async Task<RequestRecord?> GetMineAsync(long taskId, long viewerId, CancellationToken ct = default)
    {
        var record = await _registry.GetAsync(taskId, ct);
        return record?.UserId == viewerId ? record : null;
    }

    /// <summary>Действие заявителя по своей заявке: сообщение, ответ, приёмка, доработка, отмена. null — заявка не его или нужен текст.</summary>
    public async Task<ActionResult?> ActAsync(long taskId, Viewer viewer, string action, string text, CancellationToken ct = default)
    {
        var found = await GetMineAsync(taskId, viewer.Id, ct);
        if (found is null)
        {
            return null;
        }

        var author = viewer.Handle is { } handle ? $"{viewer.Name} {handle}" : viewer.Name;
        var plan = RequestActions.Build(action, new RequestActions.Ref(found.Number, found.CaseTitle.Length > 0 ? found.CaseTitle : null, author), text);
        if (plan is null)
        {
            throw new ArgumentException("Нужен текст сообщения", nameof(text));
        }

        // Сначала реестр: если он откажет, отдел не получит сообщение о том, чего нет.
        await _registry.CommentAsync(taskId, plan.Comment, plan.Action, plan.Status, ct);
        return new ActionResult(await _dept.TryPostAsync(plan.Chat, ct));
    }

    /// <summary>
    /// Смена статуса кнопкой в чате отдела. Записывает колонку, уведомляет автора
    /// и подписчиков. Перерисовка карточки — дело канала, ему возвращается заявка.
    /// </summary>
    public async Task<StatusChangeResult> ChangeStatusAsync(long taskId, string newStatus, Actor actor, string? actorLineFromCard, CancellationToken ct = default)
    {
        var request = await TryGetAsync(taskId, ct);
        if (request is null)
        {
            return new StatusChangeResult.NotFound();
        }

        var who = actor.Name + (string.IsNullOrEmpty(actor.Username) ? "" : $" (@{actor.Username})");
        var (actorLine, note) = newStatus switch
        {
            ChatStatus.Accepted => ($"Принял: {actor.Name}", $"Принял в работу: {who}"),
            ChatStatus.Done => ($"Завершил: {actor.Name}", $"Готово. Завершил: {who}"),
            ChatStatus.Rejected => (actorLineFromCard, $"Отклонена в чате отдела: {who}"),
            ChatStatus.Clarify => (actorLineFromCard, $"Требуется уточнение у заявителя — спрашивает {who}"),
            _ => (actorLineFromCard, $"Статус в чате: {ChatStatus.Label(newStatus)} — {who}"),
        };

        if (ChatStatus.ToBoard(newStatus) is not { } target)
        {
            return new StatusChangeResult.StorageRefused();
        }

        // «Готово»/«Отклонена» закрывают; любой другой статус у закрытой задачи
        // переоткрывает её, открытую reopened не трогает.
        var action = target.Action == "reopened" && !request.Closed ? null : target.Action;
        bool ok;
        try
        {
            ok = await _registry.SetStatusAsync(taskId, target.Board, action, note, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{TaskId}: статус не записан", taskId);
            ok = false;
        }

        if (!ok)
        {
            return new StatusChangeResult.StorageRefused();
        }

        foreach (var watcher in request.Watchers.Where(w => w != request.UserId))
        {
            await _notifier.NotifyAsync(watcher, RequestNotifications.WatchedStatusChanged(request, newStatus), ct);
        }

        if (request.UserId is { } authorId)
        {
            await _notifier.NotifyAsync(authorId, RequestNotifications.StatusChanged(request, newStatus, actor), ct);
        }

        return new StatusChangeResult.Changed(request, newStatus, actorLine);
    }

    /// <summary>Причина отказа от отдела: в историю заявки и автору. Бросает, если реестр не ответил.</summary>
    public async Task AddRejectionReasonAsync(long taskId, string reason, CancellationToken ct = default)
    {
        await _registry.AddCommentAsync(taskId, $"Причина отклонения: {reason}", ct);
        if (await TryGetAsync(taskId, ct) is { UserId: { } authorId })
        {
            await _notifier.NotifyAsync(authorId, RequestNotifications.RejectionReason(taskId, reason), ct);
        }
    }

    /// <summary>Вопрос отдела заявителю: комментарий с договорённым префиксом (кабинет показывает его как вопрос) и уведомление.</summary>
    public async Task AskQuestionAsync(long taskId, string question, CancellationToken ct = default)
    {
        await _registry.AddCommentAsync(taskId, $"{RequestParser.QuestionPrefix} {question}", ct);
        if (await TryGetAsync(taskId, ct) is { UserId: { } authorId })
        {
            await _notifier.NotifyAsync(authorId, RequestNotifications.Question(taskId, question), ct);
        }
    }

    /// <summary>Оценка 👍/👎 от автора. false — заявка не его.</summary>
    public async Task<bool> RateAsync(long taskId, long userId, string label, CancellationToken ct = default)
    {
        var request = await TryGetAsync(taskId, ct);
        if (request is null || request.UserId != userId)
        {
            return false;
        }

        await _registry.AddCommentAsync(taskId, $"Оценка заявителя: {label}", ct);
        await _dept.TryPostAsync($"Заявка №{taskId} · {request.CaseTitle}\nОбратная связь: {label}", ct);
        return true;
    }

    /// <summary>Автор заявки — для проверки, что оценивает именно он.</summary>
    public async Task<bool> IsAuthorAsync(long taskId, long userId, CancellationToken ct = default) =>
        (await TryGetAsync(taskId, ct))?.UserId == userId;

    /// <summary>Отзыв текстом: в историю и в чат отдела.</summary>
    public async Task ReviewAsync(long taskId, string text, CancellationToken ct = default)
    {
        await _registry.AddCommentAsync(taskId, $"Отзыв заявителя: {text}", ct);
        await _dept.TryPostAsync($"Заявка №{taskId}: отзыв от заявителя — {text}", ct);
    }

    /// <summary>
    /// Подписка на чужую задачу. Пока хранится комментарием в задаче; со штатными
    /// подписчиками Pyrus заменяется, когда появится учётка сотрудника (EmployeeRef).
    /// null — задачи нет.
    /// </summary>
    public async Task<bool?> ToggleWatchAsync(long taskId, Viewer viewer, CancellationToken ct = default)
    {
        var request = await _registry.GetAsync(taskId, ct);
        if (request is null)
        {
            return null;
        }

        var watching = request.Watchers.Contains(viewer.Id);
        var who = viewer.Handle is { } handle ? $"{viewer.Name} {handle}" : viewer.Name;
        var prefix = watching ? RequestParser.UnwatchPrefix : RequestParser.WatchPrefix;
        await _registry.AddCommentAsync(taskId, $"{prefix} tg:{viewer.Id} {who}", ct);
        return !watching;
    }

    private async Task<RequestRecord?> TryGetAsync(long taskId, CancellationToken ct)
    {
        try
        {
            return await _registry.GetAsync(taskId, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{TaskId}: не прочитана", taskId);
            return null;
        }
    }
}
