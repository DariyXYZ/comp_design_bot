using CompDesignBot.Features.Notifications;
using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Channels.Telegram.Handlers;

/// <summary>
/// Кнопки статусов под заявкой в чате отдела. Смену статуса и уведомления
/// делает <see cref="RequestService"/>; здесь — только разбор кнопки, проверка
/// чата, перерисовка карточки и ожидание текста (причина, вопрос).
/// </summary>
public sealed class DeptHandler
{
    private static readonly string[] ActorPrefixes = ["Принял: ", "Завершил: "];

    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly KeyedAsyncLock _reqLocks;
    private readonly RequestService _requests;
    private readonly DeptChat _dept;
    private readonly ILogger<DeptHandler> _log;

    public DeptHandler(ITelegramBotClient bot, StateStore states, KeyedAsyncLock reqLocks, RequestService requests,
        DeptChat dept, ILogger<DeptHandler> log)
    {
        _bot = bot;
        _states = states;
        _reqLocks = reqLocks;
        _requests = requests;
        _dept = dept;
        _log = log;
    }

    private static string[] CardLines(Message message) => (message.Text ?? message.Caption ?? "").Split('\n');

    /// <summary>Текущий статус кнопки — по строке статуса на карточке.</summary>
    internal static string? StatusFromCard(Message message) =>
        CardLines(message).Select(line => ChatStatus.KeyByLabel(line.Trim())).FirstOrDefault(key => key is not null);

    /// <summary>Строка «Принял: …» с карточки — чтобы не потерять её при перерисовке.</summary>
    internal static string? ActorFromCard(Message message) =>
        CardLines(message).FirstOrDefault(line => ActorPrefixes.Any(prefix => line.StartsWith(prefix, StringComparison.Ordinal)));

    /// <summary>aiogram <c>User.full_name</c>: имя и фамилия через пробел.</summary>
    public static string FullName(User user) =>
        string.IsNullOrEmpty(user.LastName) ? user.FirstName : $"{user.FirstName} {user.LastName}";

    public async Task ChangeStatusAsync(CallbackQuery callback, CancellationToken ct)
    {
        var message = callback.Message!;
        // Кнопки работают только в чате отдела: пересланная карточка не должна
        // давать право менять статус кому угодно.
        if (_dept.ChatId is not { } deptChatId || message.Chat.Id != deptChatId)
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Статусы меняются только в чате отдела", showAlert: true, cancellationToken: ct);
            return;
        }

        var parts = (callback.Data ?? "").Split(':', 3);
        if (parts.Length != 3 || !long.TryParse(parts[1], out var reqId))
        {
            // Битый/устаревший callback_data — кнопка не должна повиснуть без ответа.
            await _bot.AnswerCallbackQuery(callback.Id, "Ошибка", showAlert: true, cancellationToken: ct);
            return;
        }

        var newStatus = parts[2];
        if (!ChatStatus.IsKnown(newStatus))
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Неизвестный статус", cancellationToken: ct);
            return;
        }

        using (await _reqLocks.LockAsync(reqId, ct))
        {
            if (StatusFromCard(message) == newStatus)
            {
                await _bot.AnswerCallbackQuery(callback.Id, "Уже в этом статусе", cancellationToken: ct);
                return;
            }

            // Telegram сам говорит боту, кто нажал кнопку — серверные данные.
            var actor = new Actor(callback.From.Id, FullName(callback.From), callback.From.Username);
            var result = await _requests.ChangeStatusAsync(reqId, newStatus, actor, ActorFromCard(message), ct);
            switch (result)
            {
                case StatusChangeResult.NotFound:
                    await _bot.AnswerCallbackQuery(callback.Id, "Заявка не найдена в Pyrus", showAlert: true, cancellationToken: ct);
                    return;
                case StatusChangeResult.StorageRefused:
                    // Не записалось — кнопка честно говорит об этом, карточка не трогается.
                    await _bot.AnswerCallbackQuery(callback.Id, "Pyrus не ответил, статус не изменён", showAlert: true, cancellationToken: ct);
                    return;
                case StatusChangeResult.Changed changed:
                    await _bot.AnswerCallbackQuery(callback.Id, $"Статус: {ChatStatus.Label(newStatus)}", cancellationToken: ct);
                    if (newStatus == ChatStatus.Rejected)
                    {
                        await AskFollowupAsync(callback, reqId, BotState.DeptReason, Texts.AskRejectionReason(reqId), ct);
                    }
                    else if (newStatus == ChatStatus.Clarify)
                    {
                        await AskFollowupAsync(callback, reqId, BotState.DeptQuestion, Texts.AskClarifyQuestion(reqId), ct);
                    }

                    await RedrawCardAsync(message, changed, ct);
                    return;
            }
        }
    }

    /// <summary>
    /// Перерисовка тем же рендерером, что и при создании. Способ зависит от того,
    /// каким сообщением ушла заявка: текст / подпись к фото / строка под альбомом
    /// (два последних — карточки, созданные прежним ботом).
    /// </summary>
    private async Task RedrawCardAsync(Message message, StatusChangeResult.Changed changed, CancellationToken ct)
    {
        var markup = Keyboards.DeptStatusButtons(changed.Request.TaskId);
        try
        {
            if (message.ReplyToMessage is not null)
            {
                var text = RequestCard.ShortLine(changed.Request.TaskId, changed.Request.CaseTitle, changed.NewStatus, changed.ActorLine);
                await _bot.EditMessageText(message.Chat.Id, message.MessageId, text, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
            }
            else if (message.Photo is not null)
            {
                var caption = RequestCard.Render(changed.Request, changed.NewStatus, RequestCard.CaptionLimit, changed.ActorLine);
                await _bot.EditMessageCaption(message.Chat.Id, message.MessageId, caption, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
            }
            else
            {
                var text = RequestCard.Render(changed.Request, changed.NewStatus, actorLine: changed.ActorLine);
                await _bot.EditMessageText(message.Chat.Id, message.MessageId, text, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
            }
        }
        catch (ApiRequestException e)
        {
            // Карточка старше 48ч и её нельзя редактировать: в Pyrus статус уже сменён.
            _log.LogWarning("Заявка №{ReqId}: не удалось обновить карточку: {Error}", changed.Request.TaskId, e.Message);
        }
    }

    /// <summary>
    /// Статус, которому нужен текст, — просим его обычным сообщением. Если у
    /// этого же человека уже открыт вопрос по другой заявке, не перезаписываем.
    /// </summary>
    private async Task AskFollowupAsync(CallbackQuery callback, long reqId, BotState target, string prompt, CancellationToken ct)
    {
        var entry = _states.Entry(callback.Message!.Chat.Id, callback.From.Id);
        if (entry.State != BotState.None)
        {
            _log.LogInformation("Заявка №{ReqId}: не спросили текст у {User} — уже открыт вопрос по другой заявке", reqId, callback.From.Id);
            return;
        }

        entry.State = target;
        entry.ReqId = reqId;
        await _bot.SendMessage(callback.Message.Chat.Id, prompt, parseMode: ParseMode.Html,
            messageThreadId: ThreadOf(callback.Message), cancellationToken: ct);
    }

    public async Task CaptureRejectionReasonAsync(Message message, CancellationToken ct)
    {
        var reqId = TakeAwaited(message);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        try
        {
            await _requests.AddRejectionReasonAsync(id, text, ct);
            await ReplyAsync(message, Texts.RejectionReasonSaved(id), ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{ReqId}: причина отказа не записана", id);
            await ReplyAsync(message, Texts.PyrusUnavailable, ct);
        }
    }

    public Task RejectionReasonWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.ReasonWrongType, messageThreadId: ThreadOf(message), cancellationToken: ct);

    public async Task CaptureClarifyQuestionAsync(Message message, CancellationToken ct)
    {
        var reqId = TakeAwaited(message);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        try
        {
            await _requests.AskQuestionAsync(id, text, ct);
            await ReplyAsync(message, Texts.ClarifyQuestionSaved(id), ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{ReqId}: вопрос не записан", id);
            await ReplyAsync(message, Texts.PyrusUnavailable, ct);
        }
    }

    public Task ClarifyQuestionWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.QuestionWrongType, messageThreadId: ThreadOf(message), cancellationToken: ct);

    /// <summary>Заявка, по которой ждали текст; ожидание снимается сразу.</summary>
    private long? TakeAwaited(Message message)
    {
        var reqId = _states.Entry(message.Chat.Id, message.From!.Id).ReqId;
        _states.Clear(message.Chat.Id, message.From.Id);
        return reqId;
    }

    /// <summary>Как aiogram <c>message.answer()</c>: ветка форума подставляется только у тем.</summary>
    private static int? ThreadOf(Message message) => message.IsTopicMessage ? message.MessageThreadId : null;

    private Task ReplyAsync(Message message, string text, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, text, parseMode: ParseMode.Html,
            replyParameters: new ReplyParameters { MessageId = message.MessageId },
            messageThreadId: ThreadOf(message), cancellationToken: ct);
}
