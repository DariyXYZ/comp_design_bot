using System.Net;
using CompDesignBot.Features.Notifications;
using Telegram.Bot;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Уведомления сотруднику в личку Telegram. Бот может писать человеку только
/// после /start или разрешения из Mini App (<c>requestWriteAccess</c>); отказ —
/// не ошибка, а «не доставлено».
/// </summary>
public sealed class TelegramNotifier : INotifier
{
    private readonly ITelegramBotClient _bot;
    private readonly Keyboards _keyboards;
    private readonly ILogger<TelegramNotifier> _log;

    public TelegramNotifier(ITelegramBotClient bot, Keyboards keyboards, ILogger<TelegramNotifier> log)
    {
        _bot = bot;
        _keyboards = keyboards;
        _log = log;
    }

    /// <summary>
    /// Как назвать человека: @ник, а без ника — ссылка на профиль по id.
    /// Контакт текстом больше не спрашивается.
    /// </summary>
    public static string Mention(Actor actor) =>
        !string.IsNullOrEmpty(actor.Username)
            ? $"@{actor.Username}"
            : $"<a href=\"tg://user?id={actor.Id}\">{WebUtility.HtmlEncode(actor.Name)}</a>";

    public async Task<bool> NotifyAsync(long userId, Notification notification, CancellationToken ct = default)
    {
        var text = notification.Text;
        if (notification.Contact is { } contact && notification.ContactLine is { } line)
        {
            text += line.Replace("{contact}", Mention(contact));
        }

        InlineKeyboardMarkup? markup = notification.Kind switch
        {
            NotificationKind.AskFeedback when notification.TaskId is { } taskId => Keyboards.FeedbackButtons(taskId),
            NotificationKind.OpenApp => _keyboards.AppButton(),
            _ => null,
        };

        try
        {
            await _bot.SendMessage(userId, text, parseMode: ParseMode.Html, replyMarkup: markup, cancellationToken: ct);
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogInformation("Уведомление {UserId} не доставлено: {Error}", userId, e.Message);
            return false;
        }
    }
}
