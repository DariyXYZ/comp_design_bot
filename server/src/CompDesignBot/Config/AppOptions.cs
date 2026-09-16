namespace CompDesignBot.Config;

/// <summary>
/// Настройки сервиса из переменных окружения. Читаются один раз на старте:
/// отсутствие обязательной переменной валит запуск с понятным сообщением,
/// а не первый запрос.
/// </summary>
public sealed record AppOptions
{
    /// <summary>Токен бота: им подписаны данные запуска Mini App, коды входа и токены сессии.</summary>
    public required string TelegramToken { get; init; }

    /// <summary>
    /// Секрет webhook: Telegram присылает его в заголовке
    /// <c>X-Telegram-Bot-Api-Secret-Token</c>. Пустой — заголовок не проверяется.
    /// </summary>
    public string WebhookSecret { get; init; } = "";

    /// <summary>
    /// Публичный адрес сервиса (<c>https://bot.ai.ind.studio</c>). Задан — на старте
    /// регистрируется webhook <c>{PublicUrl}/telegram/webhook</c>. Пустой — webhook не
    /// трогается: локальный запуск не должен отбирать обновления у рабочего бота.
    /// </summary>
    public string PublicUrl { get; init; } = "";

    /// <summary>Адрес Mini App для кнопки в чате. Только https, иначе кнопка отключена.</summary>
    public string WebAppUrl { get; init; } = "";

    public long? DeptChatId { get; init; }
    public int? DeptThreadId { get; init; }

    public string PyrusLogin { get; init; } = "";
    public string PyrusSecurityKey { get; init; } = "";
    public int? PyrusFormId { get; init; }

    /// <summary>Общий справочник бюро «Проект» — источник подсказки в поле «Проект».</summary>
    public int PyrusProjectCatalogId { get; init; } = 278856;

    /// <summary>Интеграция с Pyrus выключается пустыми логином/ключом — бот работает, заявки не создаются.</summary>
    public bool PyrusEnabled => PyrusLogin.Length > 0 && PyrusSecurityKey.Length > 0 && PyrusFormId is > 0;

    public static AppOptions Load(IConfiguration configuration, ILogger? logger = null)
    {
        string Get(string name) => configuration[name]?.Trim().Trim('\'', '"') ?? "";

        var token = Get("TELEGRAM_TOKEN");
        if (token.Length == 0)
        {
            throw new InvalidOperationException("TELEGRAM_TOKEN не задан в переменных окружения");
        }

        long? LongOrNull(string name)
        {
            var raw = Get(name);
            if (raw.Length == 0)
            {
                return null;
            }

            return long.TryParse(raw, out var value)
                ? value
                : throw new InvalidOperationException($"{name} должен быть числом, получено: {raw}");
        }

        var publicUrl = Get("PUBLIC_URL").TrimEnd('/');
        if (publicUrl.Length > 0 && !publicUrl.StartsWith("https://", StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"PUBLIC_URL должен начинаться с https:// — Telegram не примет webhook: {publicUrl}");
        }

        var webAppUrl = Get("WEBAPP_URL");
        if (webAppUrl.Length == 0)
        {
            // Mini App раздаётся этим же сервисом — по умолчанию его адрес и есть публичный.
            webAppUrl = publicUrl.Length > 0 ? publicUrl + "/" : "";
        }

        if (webAppUrl.Length > 0 && !webAppUrl.StartsWith("https://", StringComparison.Ordinal))
        {
            // Telegram принимает только https для web_app-кнопок; кривой URL ломает
            // /start целиком, поэтому лучше вообще без кнопки Mini App.
            logger?.LogWarning("WEBAPP_URL не https:// — кнопка Mini App отключена: {Url}", webAppUrl);
            webAppUrl = "";
        }

        var catalogId = LongOrNull("PYRUS_PROJECT_CATALOG_ID");

        return new AppOptions
        {
            TelegramToken = token,
            WebhookSecret = Get("TELEGRAM_WEBHOOK_SECRET"),
            PublicUrl = publicUrl,
            WebAppUrl = webAppUrl,
            DeptChatId = LongOrNull("DEPT_CHAT_ID"),
            DeptThreadId = (int?)LongOrNull("DEPT_THREAD_ID"),
            PyrusLogin = Get("PYRUS_LOGIN"),
            PyrusSecurityKey = Get("PYRUS_SECURITY_KEY"),
            PyrusFormId = (int?)LongOrNull("PYRUS_FORM_ID"),
            PyrusProjectCatalogId = catalogId is null ? 278856 : (int)catalogId.Value,
        };
    }
}
