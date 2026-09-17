using CompDesignBot.Features.Requests;
using CompDesignBot.Hosting;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Channels.Telegram;

/// <summary>Кнопки бота: приложение, статусы в чате отдела, оценка.</summary>
public sealed class Keyboards
{
    /// <summary>Название кнопки приложения — две причины, по которым туда заходят.</summary>
    public const string BtnApp = "✦ Решения и заявки";

    private readonly AppOptions _options;

    public Keyboards(AppOptions options)
    {
        _options = options;
    }

    /// <summary>
    /// Кнопка, открывающая Mini App. Вход в приложение — по подписанным данным
    /// запуска (initData), поэтому в адресе нет ни имени, ни кода входа.
    /// null — адрес приложения не настроен.
    /// </summary>
    public InlineKeyboardMarkup? AppButton() =>
        _options.WebAppUrl.Length == 0
            ? null
            : new InlineKeyboardMarkup(new[] { new[] { InlineKeyboardButton.WithWebApp(BtnApp, _options.WebAppUrl) } });

    /// <summary>Оценка результата — под уведомлением о «Готово» в личке заявителя.</summary>
    public static InlineKeyboardMarkup FeedbackButtons(long reqId) => new(new[]
    {
        new[]
        {
            InlineKeyboardButton.WithCallbackData("👍 Всё отлично", $"fb:{reqId}:up"),
            InlineKeyboardButton.WithCallbackData("👎 Есть замечания", $"fb:{reqId}:down"),
        },
        new[] { InlineKeyboardButton.WithCallbackData("📝 Оставить отзыв", $"fb:{reqId}:review") },
    });

    /// <summary>После оценки сама оценка недоступна, отзыв — по-прежнему.</summary>
    public static InlineKeyboardMarkup FeedbackReviewOnlyButton(long reqId) => new(new[]
    {
        new[] { InlineKeyboardButton.WithCallbackData("📝 Оставить отзыв", $"fb:{reqId}:review") },
    });

    /// <summary>Кнопки смены статуса под заявкой в чате отдела, по две в ряд.</summary>
    public static InlineKeyboardMarkup DeptStatusButtons(long reqId)
    {
        var rows = ChatStatus.Labels
            .Select(pair => InlineKeyboardButton.WithCallbackData(pair.Value, $"st:{reqId}:{pair.Key}"))
            .Chunk(2)
            .ToArray();
        return new InlineKeyboardMarkup(rows);
    }
}
