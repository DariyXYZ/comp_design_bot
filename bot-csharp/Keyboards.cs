using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot;

// Порт keyboards.py — нижнее меню, выбор кейса, шаги заявки, статусы.
public static class Keyboards
{
    public const string BtnCapabilities = "✦ Возможности отдела";
    public const string BtnMy = "☰ Мои заявки";
    public const string BtnCreate = "✚ Создать заявку";
    public const string BtnInfo = "🅘 Инфо";

    public static ReplyKeyboardMarkup MainMenu()
    {
        var top = Config.Instance.WebAppUrl.Length > 0
            ? new KeyboardButton(BtnCapabilities) { WebApp = new WebAppInfo { Url = Config.Instance.WebAppUrl } }
            : new KeyboardButton(BtnCapabilities);

        return new ReplyKeyboardMarkup(new[]
        {
            new[] { top },
            new[]
            {
                new KeyboardButton(BtnMy),
                new KeyboardButton(BtnCreate),
                new KeyboardButton(BtnInfo),
            },
        })
        {
            ResizeKeyboard = true,
            IsPersistent = true,
        };
    }

    public static InlineKeyboardMarkup CasePicker()
    {
        var rows = Texts.CaseOrder
            .Select(c => new[] { InlineKeyboardButton.WithCallbackData(c.Info.Title, $"case:{c.Key}") })
            .ToArray();
        return new InlineKeyboardMarkup(rows);
    }

    private static InlineKeyboardButton[] CancelRow() =>
        new[] { InlineKeyboardButton.WithCallbackData("Отменить заявку", "req:cancel") };

    public static InlineKeyboardMarkup PhotosStep() => new(new[]
    {
        new[]
        {
            InlineKeyboardButton.WithCallbackData("Отменить заявку", "req:cancel"),
            InlineKeyboardButton.WithCallbackData("Пропустить", "photos:skip"),
        },
        new[] { InlineKeyboardButton.WithCallbackData("Дальше →", "photos:done") },
    });

    public static InlineKeyboardMarkup SourceStep() => new(new[]
    {
        new[] { InlineKeyboardButton.WithCallbackData("Пропустить", "source:skip") },
        CancelRow(),
    });

    public static InlineKeyboardMarkup PreviewStep() => new(new[]
    {
        new[] { InlineKeyboardButton.WithCallbackData("→ Отправить в отдел", "req:send") },
        CancelRow(),
    });

    // Оценка результата — под уведомлением о «Готово» в личке заявителя.
    public static InlineKeyboardMarkup FeedbackButtons(long reqId) => new(new[]
    {
        new[]
        {
            InlineKeyboardButton.WithCallbackData("👍 Всё отлично", $"fb:{reqId}:up"),
            InlineKeyboardButton.WithCallbackData("👎 Есть замечания", $"fb:{reqId}:down"),
        },
        new[] { InlineKeyboardButton.WithCallbackData("📝 Оставить отзыв", $"fb:{reqId}:review") },
    });

    // После оценки 👍/👎 сама оценка больше недоступна (уже сохранена),
    // но написать отзыв можно и после — кнопка остаётся одна.
    public static InlineKeyboardMarkup FeedbackReviewOnlyButton(long reqId) => new(new[]
    {
        new[] { InlineKeyboardButton.WithCallbackData("📝 Оставить отзыв", $"fb:{reqId}:review") },
    });

    // Кнопки смены статуса под заявкой в чате отдела.
    public static InlineKeyboardMarkup DeptStatusButtons(long reqId)
    {
        var rows = new List<InlineKeyboardButton[]>();
        var row = new List<InlineKeyboardButton>();
        foreach (var (key, label) in Texts.StatusOrder)
        {
            row.Add(InlineKeyboardButton.WithCallbackData(label, $"st:{reqId}:{key}"));
            if (row.Count == 2)
            {
                rows.Add(row.ToArray());
                row = new List<InlineKeyboardButton>();
            }
        }
        if (row.Count > 0) rows.Add(row.ToArray());
        return new InlineKeyboardMarkup(rows);
    }
}
