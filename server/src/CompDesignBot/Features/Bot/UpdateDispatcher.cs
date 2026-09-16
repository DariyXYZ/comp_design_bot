using CompDesignBot.Features.Bot.Handlers;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Features.Bot;

/// <summary>
/// Маршрутизация обновлений — явная цепочка условий в том же порядке, что
/// роутеры aiogram: start раньше create и feedback, чтобы /info, /my и кнопки
/// меню срабатывали всегда, а не попадали в текст-ловушку чужого состояния
/// (описание заявки, отзыв ловят ЛЮБОЙ текст в своём состоянии).
/// </summary>
public sealed class UpdateDispatcher
{
    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly StartHandler _start;
    private readonly CreateHandler _create;
    private readonly DeptHandler _dept;
    private readonly FeedbackHandler _feedback;
    private readonly ILogger<UpdateDispatcher> _log;

    public UpdateDispatcher(ITelegramBotClient bot, StateStore states, StartHandler start, CreateHandler create,
        DeptHandler dept, FeedbackHandler feedback, ILogger<UpdateDispatcher> log)
    {
        _bot = bot;
        _states = states;
        _start = start;
        _create = create;
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

    private static bool IsPrivate(Message message) => message.Chat.Type == ChatType.Private;

    private async Task HandleMessageAsync(Message message, CancellationToken ct)
    {
        if (message.From is null)
        {
            // Сервисные сообщения без автора не обрабатываем.
            return;
        }

        var isPrivate = IsPrivate(message);
        var state = _states.GetState(message.Chat.Id, message.From.Id);

        // --- start ---
        if (IsCommand(message, "start") && isPrivate) { await _start.CmdStartAsync(message, ct); return; }
        if (IsCommand(message, "id")) { await _start.CmdIdAsync(message, ct); return; }
        if (IsCommand(message, "app") && isPrivate) { await _start.OpenAppAsync(message, ct); return; }
        if ((IsCommand(message, "info") || message.Text == Keyboards.BtnInfo) && isPrivate) { await _start.ShowInfoAsync(message, ct); return; }
        if ((IsCommand(message, "my") || message.Text == Keyboards.BtnMy) && isPrivate) { await _start.MyRequestsAsync(message, ct); return; }

        // --- create ---
        if (message.Text == Keyboards.BtnCapabilities && isPrivate) { await _create.ChooseCaseAsync(message, ct); return; }
        if (message.WebAppData is not null && isPrivate) { await _create.FromWebAppAsync(message, ct); return; }

        switch (state)
        {
            case BotState.NewDescription:
                if (message.Text is not null) { await _create.GotDescriptionAsync(message, ct); }
                else { await _create.DescriptionWrongTypeAsync(message, ct); }
                return;
            case BotState.NewPhotos:
                if (message.Photo is not null) { await _create.GotPhotoAsync(message, ct); }
                else { await _create.PhotosWrongTypeAsync(message, ct); }
                return;
            case BotState.NewSource:
                if (message.Text is not null) { await _create.GotSourceAsync(message, ct); }
                else { await _create.SourceWrongTypeAsync(message, ct); }
                return;

            // --- feedback ---
            case BotState.FeedbackText:
                if (message.Text is not null) { await _feedback.CaptureFeedbackCommentAsync(message, ct); }
                else { await _feedback.FeedbackCommentWrongTypeAsync(message, ct); }
                return;

            // --- dept ---
            case BotState.DeptReason:
                if (message.Text is not null) { await _dept.CaptureRejectionReasonAsync(message, ct); }
                else { await _dept.RejectionReasonWrongTypeAsync(message, ct); }
                return;
            case BotState.DeptQuestion:
                if (message.Text is not null) { await _dept.CaptureClarifyQuestionAsync(message, ct); }
                else { await _dept.ClarifyQuestionWrongTypeAsync(message, ct); }
                return;
            default:
                // Ничего не подошло — бот молчит.
                return;
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
        var state = _states.GetState(callback.Message.Chat.Id, callback.From.Id);

        // --- create ---
        if (data.StartsWith("case:", StringComparison.Ordinal)) { await _create.CaseChosenAsync(callback, ct); return; }
        if (state == BotState.NewPhotos && data is "photos:done" or "photos:skip") { await _create.PhotosDoneAsync(callback, ct); return; }
        if (state == BotState.NewSource && data == "source:skip") { await _create.SourceSkippedAsync(callback, ct); return; }
        if (data == "req:cancel") { await _create.CancelRequestAsync(callback, ct); return; }
        if (state == BotState.NewPreview && data == "req:send") { await _create.SendRequestAsync(callback, ct); return; }

        // --- feedback ---
        if (data.StartsWith("fb:", StringComparison.Ordinal)) { await _feedback.RateRequestAsync(callback, ct); return; }

        // --- dept ---
        if (data.StartsWith("st:", StringComparison.Ordinal)) { await _dept.ChangeStatusAsync(callback, ct); return; }

        // Колбэк не совпал ни с одним обработчиком — в основном кнопки
        // «Дальше»/«Отправить» из черновиков, умерших при рестарте.
        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        await _bot.SendMessage(callback.Message.Chat.Id, Texts.SessionReset, cancellationToken: ct);
    }
}
