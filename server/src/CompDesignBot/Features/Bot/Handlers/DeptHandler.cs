using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Telegram;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Features.Bot.Handlers;

/// <summary>
/// Кнопки статусов под заявкой в чате отдела. Состояние заявки живёт в Pyrus:
/// кнопка переводит колонку доски, кто нажал и причина — комментарии к задаче.
/// Текущий статус карточки читается с самой карточки.
/// </summary>
public sealed class DeptHandler
{
    private static readonly string[] ActorPrefixes = ["Принял: ", "Завершил: "];

    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly KeyedAsyncLock _reqLocks;
    private readonly RequestStore _requests;
    private readonly DeptChat _dept;
    private readonly Keyboards _keyboards;
    private readonly ILogger<DeptHandler> _log;

    public DeptHandler(ITelegramBotClient bot, StateStore states, BotLocks locks, RequestStore requests,
        DeptChat dept, Keyboards keyboards, ILogger<DeptHandler> log)
    {
        _bot = bot;
        _states = states;
        _reqLocks = locks.Requests;
        _requests = requests;
        _dept = dept;
        _keyboards = keyboards;
        _log = log;
    }

    /// <summary>
    /// Как назвать человека в HTML-сообщении: @ник, а без ника — ссылка на
    /// профиль по id. Контакт текстом больше не спрашивается.
    /// </summary>
    public static string Mention(User user) =>
        !string.IsNullOrEmpty(user.Username)
            ? $"@{user.Username}"
            : $"<a href=\"tg://user?id={user.Id}\">{RequestCard.Escape(Keyboards.FullName(user))}</a>";

    private static string[] CardLines(Message message) => (message.Text ?? message.Caption ?? "").Split('\n');

    /// <summary>Текущий статус кнопки — по строке статуса на карточке.</summary>
    internal static string? StatusFromCard(Message message) =>
        CardLines(message).Select(line => ChatStatus.KeyByLabel(line.Trim())).FirstOrDefault(key => key is not null);

    /// <summary>Строка «Принял: …» с карточки — чтобы не потерять её при перерисовке.</summary>
    internal static string? ActorFromCard(Message message) =>
        CardLines(message).FirstOrDefault(line => ActorPrefixes.Any(prefix => line.StartsWith(prefix, StringComparison.Ordinal)));

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

            var req = await _requests.GetRequestAsync(reqId, ct);
            if (req is null)
            {
                await _bot.AnswerCallbackQuery(callback.Id, "Заявка не найдена в Pyrus", showAlert: true, cancellationToken: ct);
                return;
            }

            // Telegram сам говорит боту, кто нажал кнопку — серверные данные.
            var actor = callback.From;
            var actorName = Keyboards.FullName(actor);
            var who = actorName + (string.IsNullOrEmpty(actor.Username) ? "" : $" (@{actor.Username})");
            string? actorLine;
            string note;
            switch (newStatus)
            {
                case ChatStatus.Accepted:
                    actorLine = $"Принял: {actorName}";
                    note = $"Принял в работу: {who}";
                    break;
                case ChatStatus.Done:
                    actorLine = $"Завершил: {actorName}";
                    note = $"Готово. Завершил: {who}";
                    break;
                case ChatStatus.Rejected:
                    actorLine = ActorFromCard(message);
                    note = $"Отклонена в чате отдела: {who}";
                    break;
                case ChatStatus.Clarify:
                    actorLine = ActorFromCard(message);
                    note = $"Требуется уточнение у заявителя — спрашивает {who}";
                    break;
                default:
                    actorLine = ActorFromCard(message);
                    note = $"Статус в чате: {ChatStatus.Label(newStatus)} — {who}";
                    break;
            }

            // Сначала Pyrus — это и есть смена статуса. Не записалось — кнопка
            // честно говорит об этом, карточка не трогается.
            if (!await _requests.SetStatusAsync(reqId, newStatus, note, req.Closed, ct))
            {
                await _bot.AnswerCallbackQuery(callback.Id, "Pyrus не ответил, статус не изменён", showAlert: true, cancellationToken: ct);
                return;
            }

            await _bot.AnswerCallbackQuery(callback.Id, $"Статус: {ChatStatus.Label(newStatus)}", cancellationToken: ct);

            if (newStatus == ChatStatus.Rejected)
            {
                await AskFollowupAsync(callback, reqId, BotState.DeptReason, Texts.AskRejectionReason(reqId), ct);
            }
            else if (newStatus == ChatStatus.Clarify)
            {
                await AskFollowupAsync(callback, reqId, BotState.DeptQuestion, Texts.AskClarifyQuestion(reqId), ct);
            }

            // Перерисовываем тем же рендерером. Способ зависит от того, каким
            // сообщением ушла заявка: текст / подпись к фото / строка под альбомом.
            var markup = Keyboards.DeptStatusButtons(reqId);
            var caseTitle = req.CaseTitle;
            try
            {
                if (message.ReplyToMessage is not null)
                {
                    await _bot.EditMessageText(message.Chat.Id, message.MessageId, RequestCard.ShortLine(reqId, caseTitle, newStatus, actorLine),
                        parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
                }
                else if (message.Photo is not null)
                {
                    var caption = RequestCard.Render(reqId, caseTitle, req.Description, req.SourcePath, req.Author, newStatus,
                        maxLen: RequestCard.CaptionLimit, actorLine: actorLine, expected: req.Expected);
                    await _bot.EditMessageCaption(message.Chat.Id, message.MessageId, caption, parseMode: ParseMode.Html,
                        replyMarkup: markup, cancellationToken: ct);
                }
                else
                {
                    var text = RequestCard.Render(reqId, caseTitle, req.Description, req.SourcePath, req.Author, newStatus,
                        actorLine: actorLine, expected: req.Expected);
                    await _bot.EditMessageText(message.Chat.Id, message.MessageId, text, parseMode: ParseMode.Html,
                        replyMarkup: markup, cancellationToken: ct);
                }
            }
            catch (ApiRequestException e)
            {
                // Карточка старше 48ч и её нельзя редактировать: в Pyrus статус уже сменён.
                _log.LogWarning("Заявка №{ReqId}: не удалось обновить карточку: {Error}", reqId, e.Message);
            }

            // Подписчики из ленты Mini App: то же уведомление, без строк про контакт.
            var watchNote = Texts.WatcherStatusNotify(reqId, RequestCard.Escape(caseTitle), ChatStatus.Label(newStatus));
            foreach (var watcher in req.Watchers)
            {
                if (watcher == req.UserId)
                {
                    continue;
                }

                try
                {
                    await _bot.SendMessage(watcher, watchNote, parseMode: ParseMode.Html, cancellationToken: ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    _log.LogInformation("Заявка №{ReqId}: подписчику {Watcher} не доставлено: {Error}", reqId, watcher, e.Message);
                }
            }

            if (req.UserId is not { } authorId)
            {
                return;
            }

            var notify = Texts.StatusChangedNotify(reqId, RequestCard.Escape(caseTitle), ChatStatus.Label(newStatus));
            notify += newStatus switch
            {
                ChatStatus.Accepted => Texts.AcceptedContactLine(Mention(actor)),
                ChatStatus.Done => Texts.DoneContactLine(Mention(actor)),
                ChatStatus.Clarify => Texts.ClarifyStatusLine,
                _ => "",
            };
            // Оценку просим только у «Готово».
            var feedback = newStatus == ChatStatus.Done ? Keyboards.FeedbackButtons(reqId) : null;
            try
            {
                await _bot.SendMessage(authorId, notify, parseMode: ParseMode.Html, replyMarkup: feedback, cancellationToken: ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogInformation("Заявка №{ReqId}: автору не доставлено уведомление (закрыл личку?): {Error}", reqId, e.Message);
            }
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
        entry.Data.ReqId = reqId;
        await _bot.SendMessage(callback.Message.Chat.Id, prompt, parseMode: ParseMode.Html,
            messageThreadId: ThreadOf(callback.Message), cancellationToken: ct);
    }

    public async Task CaptureRejectionReasonAsync(Message message, CancellationToken ct)
    {
        var entry = _states.Entry(message.Chat.Id, message.From!.Id);
        var reqId = entry.Data.ReqId;
        _states.Clear(message.Chat.Id, message.From.Id);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        await _requests.AddCommentAsync(id, $"Причина отклонения: {text}", ct);
        await ReplyAsync(message, Texts.RejectionReasonSaved(id), ct);
        var req = await _requests.GetRequestAsync(id, ct);
        if (req?.UserId is { } authorId)
        {
            try
            {
                await _bot.SendMessage(authorId, Texts.RejectionReasonNotify(id, RequestCard.Escape(text)), parseMode: ParseMode.Html, cancellationToken: ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogInformation("Заявка №{ReqId}: причина отказа не доставлена автору: {Error}", id, e.Message);
            }
        }
    }

    public Task RejectionReasonWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.ReasonWrongType, messageThreadId: ThreadOf(message), cancellationToken: ct);

    public async Task CaptureClarifyQuestionAsync(Message message, CancellationToken ct)
    {
        var entry = _states.Entry(message.Chat.Id, message.From!.Id);
        var reqId = entry.Data.ReqId;
        _states.Clear(message.Chat.Id, message.From.Id);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        // Префикс — договорённость с кабинетом: он показывает последний такой комментарий как вопрос отдела.
        await _requests.AddCommentAsync(id, $"{RequestParser.QuestionPrefix} {text}", ct);
        await ReplyAsync(message, Texts.ClarifyQuestionSaved(id), ct);
        var req = await _requests.GetRequestAsync(id, ct);
        if (req?.UserId is { } authorId)
        {
            try
            {
                // Кнопка с кодом входа: имя берём из поля «Telegram» задачи — объекта User здесь нет.
                var author = new User { Id = authorId, FirstName = req.Author };
                await _bot.SendMessage(authorId, Texts.ClarifyQuestionNotify(id, RequestCard.Escape(text)), parseMode: ParseMode.Html,
                    replyMarkup: _keyboards.AppButton(author), cancellationToken: ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                _log.LogInformation("Заявка №{ReqId}: вопрос не доставлен автору: {Error}", id, e.Message);
            }
        }
    }

    public Task ClarifyQuestionWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.QuestionWrongType, messageThreadId: ThreadOf(message), cancellationToken: ct);

    /// <summary>Как aiogram <c>message.answer()</c>: ветка форума подставляется только у тем.</summary>
    private static int? ThreadOf(Message message) => message.IsTopicMessage ? message.MessageThreadId : null;

    private Task ReplyAsync(Message message, string text, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, text, parseMode: ParseMode.Html,
            replyParameters: new ReplyParameters { MessageId = message.MessageId },
            messageThreadId: ThreadOf(message), cancellationToken: ct);
}
