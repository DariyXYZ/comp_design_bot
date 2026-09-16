using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Telegram;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;

namespace CompDesignBot.Features.Bot.Handlers;

/// <summary>Оценка результата от заявителя после «Готово» — в личке с ботом.</summary>
public sealed class FeedbackHandler
{
    private static readonly Dictionary<string, string> Labels = new(StringComparer.Ordinal) { ["up"] = "👍", ["down"] = "👎" };

    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly RequestStore _requests;
    private readonly DeptChat _dept;
    private readonly ILogger<FeedbackHandler> _log;

    public FeedbackHandler(ITelegramBotClient bot, StateStore states, RequestStore requests, DeptChat dept, ILogger<FeedbackHandler> log)
    {
        _bot = bot;
        _states = states;
        _requests = requests;
        _dept = dept;
        _log = log;
    }

    public async Task RateRequestAsync(CallbackQuery callback, CancellationToken ct)
    {
        var parts = (callback.Data ?? "").Split(':', 3);
        if (parts.Length != 3 || !long.TryParse(parts[1], out var reqId))
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Ошибка", showAlert: true, cancellationToken: ct);
            return;
        }

        var value = parts[2];
        var chatId = callback.Message!.Chat.Id;
        var entry = _states.Entry(chatId, callback.From.Id);

        var req = await _requests.GetRequestAsync(reqId, ct);
        // Кнопки уходят персонально автору — но чужому from_user вслепую не доверяем.
        if (req is null || callback.From.Id != req.UserId)
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Не удалось сохранить", showAlert: true, cancellationToken: ct);
            return;
        }

        if (value == "review")
        {
            // Отзыв не привязан к 👍/👎 — можно оставить независимо от оценки.
            await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
            if (entry.State != BotState.None)
            {
                // Уже открыт вопрос по другой заявке — перезапись потеряла бы его молча.
                return;
            }

            entry.State = BotState.FeedbackText;
            entry.Data.ReqId = reqId;
            await _bot.SendMessage(chatId, Texts.FeedbackAskReview, cancellationToken: ct);
            return;
        }

        if (!Labels.TryGetValue(value, out var label))
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Неизвестная оценка", cancellationToken: ct);
            return;
        }

        // Повторная оценка не проверяется: после первой кнопки 👍/👎 исчезают, а
        // вторая запись в истории задачи не вредит.
        await _requests.AddCommentAsync(reqId, $"Оценка заявителя: {label}", ct);
        try
        {
            await _bot.EditMessageReplyMarkup(chatId, callback.Message.MessageId,
                replyMarkup: Keyboards.FeedbackReviewOnlyButton(reqId), cancellationToken: ct);
        }
        catch (ApiRequestException)
        {
            // Сообщение уже без кнопок — не критично.
        }

        await _bot.AnswerCallbackQuery(callback.Id, "Спасибо за оценку!", cancellationToken: ct);

        if (_dept.Configured)
        {
            await _dept.TrySendAsync(Texts.FeedbackDeptNote(reqId, req.CaseTitle, label), ct: ct);
        }

        if (value == "down" && entry.State == BotState.None)
        {
            entry.State = BotState.FeedbackText;
            entry.Data.ReqId = reqId;
            await _bot.SendMessage(chatId, Texts.FeedbackAskComment, cancellationToken: ct);
        }
    }

    public async Task CaptureFeedbackCommentAsync(Message message, CancellationToken ct)
    {
        var entry = _states.Entry(message.Chat.Id, message.From!.Id);
        var reqId = entry.Data.ReqId;
        _states.Clear(message.Chat.Id, message.From.Id);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        await _requests.AddCommentAsync(id, $"Отзыв заявителя: {text}", ct);
        await _bot.SendMessage(message.Chat.Id, Texts.FeedbackCommentThanks, cancellationToken: ct);

        if (_dept.Configured && !await _dept.TrySendAsync(Texts.FeedbackDeptComment(id, text), ct: ct))
        {
            _log.LogInformation("Заявка №{ReqId}: отзыв не доставлен в чат отдела", id);
        }
    }

    public Task FeedbackCommentWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.FeedbackWrongType, cancellationToken: ct);
}
