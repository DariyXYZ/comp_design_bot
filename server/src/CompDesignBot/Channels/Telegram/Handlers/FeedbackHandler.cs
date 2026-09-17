using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;

namespace CompDesignBot.Channels.Telegram.Handlers;

/// <summary>Оценка результата от заявителя после «Готово» — в личке с ботом.</summary>
public sealed class FeedbackHandler
{
    private static readonly Dictionary<string, string> Labels = new(StringComparer.Ordinal) { ["up"] = "👍", ["down"] = "👎" };

    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly RequestService _requests;
    private readonly ILogger<FeedbackHandler> _log;

    public FeedbackHandler(ITelegramBotClient bot, StateStore states, RequestService requests, ILogger<FeedbackHandler> log)
    {
        _bot = bot;
        _states = states;
        _requests = requests;
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

        if (value == "review")
        {
            // Отзыв не привязан к 👍/👎 — можно оставить независимо от оценки.
            if (!await _requests.IsAuthorAsync(reqId, callback.From.Id, ct))
            {
                await _bot.AnswerCallbackQuery(callback.Id, "Не удалось сохранить", showAlert: true, cancellationToken: ct);
                return;
            }

            await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
            if (entry.State != BotState.None)
            {
                // Уже открыт вопрос по другой заявке — перезапись потеряла бы его молча.
                return;
            }

            entry.State = BotState.FeedbackText;
            entry.ReqId = reqId;
            await _bot.SendMessage(chatId, Texts.FeedbackAskReview, cancellationToken: ct);
            return;
        }

        if (!Labels.TryGetValue(value, out var label))
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Неизвестная оценка", cancellationToken: ct);
            return;
        }

        bool saved;
        try
        {
            // Кнопки уходят персонально автору — но чужому from_user вслепую не доверяем.
            saved = await _requests.RateAsync(reqId, callback.From.Id, label, ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{ReqId}: оценка не записана", reqId);
            saved = false;
        }

        if (!saved)
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Не удалось сохранить", showAlert: true, cancellationToken: ct);
            return;
        }

        try
        {
            // 👍/👎 больше не нажать (уже сохранено), но «Оставить отзыв» остаётся.
            await _bot.EditMessageReplyMarkup(chatId, callback.Message.MessageId,
                replyMarkup: Keyboards.FeedbackReviewOnlyButton(reqId), cancellationToken: ct);
        }
        catch (ApiRequestException)
        {
            // Сообщение уже без кнопок — не критично.
        }

        await _bot.AnswerCallbackQuery(callback.Id, "Спасибо за оценку!", cancellationToken: ct);

        if (value == "down" && entry.State == BotState.None)
        {
            entry.State = BotState.FeedbackText;
            entry.ReqId = reqId;
            await _bot.SendMessage(chatId, Texts.FeedbackAskComment, cancellationToken: ct);
        }
    }

    public async Task CaptureFeedbackCommentAsync(Message message, CancellationToken ct)
    {
        var entry = _states.Entry(message.Chat.Id, message.From!.Id);
        var reqId = entry.ReqId;
        _states.Clear(message.Chat.Id, message.From.Id);
        var text = message.Text!.Trim();
        if (reqId is not { } id || text.Length == 0)
        {
            return;
        }

        try
        {
            await _requests.ReviewAsync(id, text, ct);
            await _bot.SendMessage(message.Chat.Id, Texts.FeedbackCommentThanks, cancellationToken: ct);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "Заявка №{ReqId}: отзыв не записан", id);
            await _bot.SendMessage(message.Chat.Id, Texts.PyrusUnavailable, cancellationToken: ct);
        }
    }

    public Task FeedbackCommentWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.FeedbackWrongType, cancellationToken: ct);
}
