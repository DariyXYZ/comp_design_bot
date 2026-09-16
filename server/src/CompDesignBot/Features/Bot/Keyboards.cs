using System.Web;
using CompDesignBot.Config;
using CompDesignBot.Features.Auth;
using CompDesignBot.Features.Requests;
using CompDesignBot.Features.Topics;
using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Features.Bot;

/// <summary>Клавиатуры: нижнее меню, выбор темы, шаги заявки, статусы, оценка.</summary>
public sealed class Keyboards
{
    /// <summary>Название кнопки приложения — две причины, по которым туда заходят.</summary>
    public const string BtnCapabilities = "✦ Решения и заявки";
    public const string BtnMy = "☰ Мои заявки";
    public const string BtnInfo = "🅘 Инфо";

    private readonly AppOptions _options;
    private readonly SessionTokens _tokens;

    public Keyboards(AppOptions options, SessionTokens tokens)
    {
        _options = options;
        _tokens = tokens;
    }

    /// <summary>
    /// Адрес Mini App с именем и подписанным кодом входа. Кнопку формирует бот,
    /// и в этот момент он точно знает, кто перед ним — а клиенты Telegram отдают
    /// initData непредсказуемо. <c>u</c>/<c>h</c> только для показа, <c>c</c> —
    /// код входа, который приложение сразу меняет на токен сессии.
    /// </summary>
    public string WebAppUrlFor(User? user)
    {
        if (_options.WebAppUrl.Length == 0 || user is null)
        {
            return _options.WebAppUrl;
        }

        var uri = new UriBuilder(_options.WebAppUrl);
        var query = HttpUtility.ParseQueryString(uri.Query);
        var fullName = FullName(user);
        query["u"] = fullName;
        if (!string.IsNullOrEmpty(user.Username))
        {
            query["h"] = user.Username;
        }

        query["c"] = _tokens.IssueLoginCode(user.Id, fullName, user.Username);
        uri.Query = query.ToString();
        return uri.Uri.ToString();
    }

    /// <summary>
    /// Нижнее меню: приложение, мои заявки, инфо. Кнопки «Создать заявку» нет
    /// намеренно: заявка оформляется в Mini App, где у неё есть контекст.
    /// </summary>
    public ReplyKeyboardMarkup MainMenu(User? user)
    {
        var url = WebAppUrlFor(user);
        var top = url.Length > 0
            ? new KeyboardButton(BtnCapabilities) { WebApp = new WebAppInfo { Url = url } }
            : new KeyboardButton(BtnCapabilities);
        return new ReplyKeyboardMarkup(new[]
        {
            new[] { top },
            new[] { new KeyboardButton(BtnMy), new KeyboardButton(BtnInfo) },
        })
        {
            ResizeKeyboard = true,
            IsPersistent = true,
        };
    }

    /// <summary>
    /// Кнопка запуска приложения прямо в сообщении: reply-клавиатуру в Desktop не
    /// видно. У Mini App из такой кнопки нет <c>sendData</c> — отправка заявки
    /// работает только из кнопки клавиатуры, форма об этом предупреждает.
    /// </summary>
    public InlineKeyboardMarkup? AppButton(User? user)
    {
        var url = WebAppUrlFor(user);
        if (url.Length == 0)
        {
            return null;
        }

        return new InlineKeyboardMarkup(new[]
        {
            new[] { InlineKeyboardButton.WithWebApp(BtnCapabilities, url) },
        });
    }

    public static InlineKeyboardMarkup CasePicker() =>
        new(Cases.All.Select(c => new[] { InlineKeyboardButton.WithCallbackData(c.Title, $"case:{c.Key}") }));

    private static InlineKeyboardButton[] CancelRow() => [InlineKeyboardButton.WithCallbackData("Отменить заявку", "req:cancel")];

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

    /// <summary>aiogram <c>User.full_name</c>: имя и фамилия через пробел.</summary>
    public static string FullName(User user)
    {
        var full = string.IsNullOrEmpty(user.LastName) ? user.FirstName : $"{user.FirstName} {user.LastName}";
        return full ?? "";
    }
}
