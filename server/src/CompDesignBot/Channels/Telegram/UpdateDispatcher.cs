using CompDesignBot.Channels.Telegram.Handlers;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Маршрутизация обновлений. Команды идут раньше состояний: /start посреди
/// ожидания отзыва должен сработать, а не уйти в текст отзыва.
/// </summary>
public sealed class UpdateDispatcher
{
    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly StartHandler _start;
    private readonly DeptHandler _dept;
    private readonly FeedbackHandler _feedback;
    private readonly ILogger<UpdateDispatcher> _log;

    public UpdateDispatcher(ITelegramBotClient bot, StateStore states, StartHandler start, DeptHandler dept,
        FeedbackHandler feedback, ILogger<UpdateDispatcher> log)
    {
        _bot = bot;
        _states = states;
        _start = start;
        _dept = dept;
        _feedback = feedback;
        _log = log;
    }

    public async Task HandleAsync(Update update, CancellationToken ct)
    {
        try
        {
            if (update.Message is { } message)
            {
                await HandleMessageAsync(message, ct);
            }
            else if (update.CallbackQuery is { } callback)
            {
                await HandleCallbackAsync(callback, ct);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Необработанная ошибка логируется, но не мешает следующим обновлениям.
            _log.LogError(e, "Необработанная ошибка в обработчике обновления {UpdateId}", update.Id);
        }
    }

    private static bool IsCommand(Message message, string command)
    {
        var text = message.Text;
        if (string.IsNullOrEmpty(text) || text[0] != '/')
        {
            return false;
        }

        var first = text.Split([' ', '\n'], 2)[0][1..];
        var at = first.IndexOf('@');
        if (at >= 0)
        {
            first = first[..at];
        }

        return string.Equals(first, command, StringComparison.Ordinal);
    }

    private async Task HandleMessageAsync(Message message, CancellationToken ct)
    {
        if (message.From is null)
        {
            // Сервисные сообщения без автора не обрабатываем.
            return;
        }

        var isPrivate = message.Chat.Type == ChatType.Private;
        if (IsCommand(message, "start") && isPrivate) { await _start.CmdStartAsync(message, ct); return; }
        if (IsCommand(message, "id")) { await _start.CmdIdAsync(message, ct); return; }
        if (IsCommand(message, "app") && isPrivate) { await _start.OpenAppAsync(message.Chat.Id, message.From.Id, Texts.OpenApp, ct); return; }

        switch (_states.GetState(message.Chat.Id, message.From.Id))
        {
            case BotState.FeedbackText:
                if (message.Text is not null) { await _feedback.CaptureFeedbackCommentAsync(message, ct); }
                else { await _feedback.FeedbackCommentWrongTypeAsync(message, ct); }
                return;
            case BotState.DeptReason:
                if (message.Text is not null) { await _dept.CaptureRejectionReasonAsync(message, ct); }
                else { await _dept.RejectionReasonWrongTypeAsync(message, ct); }
                return;
            case BotState.DeptQuestion:
                if (message.Text is not null) { await _dept.CaptureClarifyQuestionAsync(message, ct); }
                else { await _dept.ClarifyQuestionWrongTypeAsync(message, ct); }
                return;
        }

        // Любой другой текст в личке (в том числе кнопки старого меню) — в приложение.
        if (isPrivate)
        {
            await _start.OpenAppAsync(message.Chat.Id, message.From.Id, Texts.UseApp, ct);
        }
    }

    private async Task HandleCallbackAsync(CallbackQuery callback, CancellationToken ct)
    {
        if (callback.Message is null)
        {
            await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
            return;
        }

        var data = callback.Data ?? "";
        if (data.StartsWith("fb:", StringComparison.Ordinal)) { await _feedback.RateRequestAsync(callback, ct); return; }
        if (data.StartsWith("st:", StringComparison.Ordinal)) { await _dept.ChangeStatusAsync(callback, ct); return; }

        // Кнопки прежнего диалога заявки («Дальше», «Отправить») и прочее устаревшее.
        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        if (callback.Message.Chat.Type == ChatType.Private)
        {
            await _start.OpenAppAsync(callback.Message.Chat.Id, callback.From.Id, Texts.StaleButton, ct);
        }
    }
}
