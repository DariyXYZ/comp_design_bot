using CompDesignBot.Config;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Features.Bot;

/// <summary>
/// На старте: меню команд и, если задан PUBLIC_URL, регистрация webhook.
/// Без PUBLIC_URL webhook не трогается — локальный запуск не должен отбирать
/// обновления у рабочего бота (у Telegram один получатель на токен).
/// Ошибки Telegram на старте — в лог, службу не валят: сеть поднимется позже.
/// </summary>
public sealed class BotSetupService : IHostedService
{
    public const string WebhookPath = "/telegram/webhook";

    private static readonly BotCommand[] Commands =
    [
        new() { Command = "start", Description = "Главное меню" },
        new() { Command = "app", Description = "Приложение: решения и заявки" },
        new() { Command = "my", Description = "Мои заявки" },
        new() { Command = "info", Description = "Как это работает" },
    ];

    private readonly ITelegramBotClient _bot;
    private readonly AppOptions _options;
    private readonly ILogger<BotSetupService> _log;

    public BotSetupService(ITelegramBotClient bot, AppOptions options, ILogger<BotSetupService> log)
    {
        _bot = bot;
        _options = options;
        _log = log;
    }

    public async Task StartAsync(CancellationToken ct)
    {
        try
        {
            await _bot.SetMyCommands(Commands, scope: new BotCommandScopeAllPrivateChats(), cancellationToken: ct);
            if (_options.PublicUrl.Length == 0)
            {
                _log.LogWarning("PUBLIC_URL не задан — webhook не регистрируется, бот получает обновления только если он уже настроен снаружи");
                return;
            }

            var url = _options.PublicUrl + WebhookPath;
            await _bot.SetWebhook(
                url,
                allowedUpdates: [UpdateType.Message, UpdateType.CallbackQuery],
                secretToken: _options.WebhookSecret.Length > 0 ? _options.WebhookSecret : null,
                cancellationToken: ct);
            _log.LogInformation("comp_design_bot запущен, webhook {Url}", url);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogError(e, "Telegram: не удалось настроить бота на старте");
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
