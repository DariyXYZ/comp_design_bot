using CompDesignBot.Features.Requests;
using CompDesignBot.Hosting;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Чат отдела и ветка заявок — Telegram-реализация <see cref="IDeptChannel"/>.
/// Чат может быть не настроен (локальный запуск) — тогда сообщение не уходит,
/// а действие всё равно доводится до конца: запись в Pyrus остаётся.
/// </summary>
public sealed class DeptChat : IDeptChannel
{
    private readonly ITelegramBotClient _bot;
    private readonly AppOptions _options;
    private readonly ILogger<DeptChat> _log;

    public DeptChat(ITelegramBotClient bot, AppOptions options, ILogger<DeptChat> log)
    {
        _bot = bot;
        _options = options;
        _log = log;
    }

    public bool Configured => _options.DeptChatId is not null;

    public long? ChatId => _options.DeptChatId;

    /// <summary>Карточка заявки с кнопками статусов. Картинки живут в Pyrus, поэтому карточка всегда текстовая.</summary>
    public async Task<long> PostCardAsync(RequestRecord request, CancellationToken ct = default)
    {
        var message = await SendAsync(RequestCard.Render(request), Keyboards.DeptStatusButtons(request.TaskId), ct: ct);
        return message.MessageId;
    }

    /// <summary>Пишет в ветку заявок. Бросает: вызывающий решает, что значит недоставка.</summary>
    public Task<Message> SendAsync(string text, ReplyMarkup? markup = null, bool html = true, CancellationToken ct = default)
    {
        if (_options.DeptChatId is not { } chatId)
        {
            throw new InvalidOperationException("Чат отдела не настроен (DEPT_CHAT_ID)");
        }

        return _bot.SendMessage(
            chatId,
            text,
            parseMode: html ? ParseMode.Html : ParseMode.None,
            replyMarkup: markup,
            messageThreadId: _options.DeptThreadId,
            cancellationToken: ct);
    }

    /// <summary>Обычный текст без разметки: сообщения от людей не экранируются, поэтому HTML тут опасен.</summary>
    public async Task<bool> TryPostAsync(string text, CancellationToken ct = default)
    {
        if (!Configured)
        {
            return false;
        }

        try
        {
            await SendAsync(text, html: false, ct: ct);
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogWarning(e, "Telegram: сообщение в чат отдела не ушло");
            return false;
        }
    }
}
