using CompDesignBot.Config;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Infrastructure.Telegram;

/// <summary>
/// Чат отдела и ветка заявок. Чат может быть не настроен (локальный запуск) —
/// тогда сообщение не уходит, а действие всё равно доводится до конца:
/// комментарий в задаче Pyrus остаётся.
/// </summary>
public sealed class DeptChat
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

    public int? ThreadId => _options.DeptThreadId;

    /// <summary>Пишет в ветку заявок. Бросает: вызывающий решает, что значит недоставка.</summary>
    public Task<Message> SendAsync(string text, ReplyMarkup? markup = null, int? replyTo = null, bool html = true, CancellationToken ct = default)
    {
        if (_options.DeptChatId is not { } chatId)
        {
            throw new InvalidOperationException("Чат отдела не настроен (DEPT_CHAT_ID)");
        }

        return _bot.SendMessage(
            chatId,
            text,
            parseMode: html ? ParseMode.Html : ParseMode.None,
            replyParameters: replyTo is { } id ? new ReplyParameters { MessageId = id } : null,
            replyMarkup: markup,
            messageThreadId: _options.DeptThreadId,
            cancellationToken: ct);
    }

    /// <summary>
    /// Пишет в ветку заявок; <c>false</c> — чат не настроен или Telegram отказал. Не
    /// бросает. <paramref name="html"/> = false для текста человека без экранирования.
    /// </summary>
    public async Task<bool> TrySendAsync(string text, bool html = true, CancellationToken ct = default)
    {
        if (!Configured)
        {
            return false;
        }

        try
        {
            await SendAsync(text, html: html, ct: ct);
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogWarning(e, "Telegram: сообщение в чат отдела не ушло");
            return false;
        }
    }
}
