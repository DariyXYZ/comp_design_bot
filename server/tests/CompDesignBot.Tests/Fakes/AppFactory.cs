using CompDesignBot.Features.Auth;
using CompDesignBot.Features.Bot;
using CompDesignBot.Infrastructure.Pyrus;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Telegram.Bot;
using Telegram.Bot.Types;

namespace CompDesignBot.Tests.Fakes;

/// <summary>Приложение целиком с фейковыми Pyrus и Telegram; переменные окружения — через настройки хоста.</summary>
public sealed class AppFactory : WebApplicationFactory<Program>
{
    public const string BotToken = "123456:TEST-TOKEN";
    public const long DeptChatId = -1003204218879;
    public const int DeptThreadId = 5011;
    public const string WebhookSecret = "hook-secret";

    public FakePyrusClient Pyrus { get; } = new();

    public FakeBotClient Bot { get; } = new();

    public SessionTokens Tokens { get; } = new(BotToken);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("TELEGRAM_TOKEN", BotToken);
        builder.UseSetting("TELEGRAM_WEBHOOK_SECRET", WebhookSecret);
        builder.UseSetting("WEBAPP_URL", "https://bot.example.test/");
        builder.UseSetting("DEPT_CHAT_ID", DeptChatId.ToString());
        builder.UseSetting("DEPT_THREAD_ID", DeptThreadId.ToString());
        builder.UseSetting("PYRUS_LOGIN", "bot@example.test");
        builder.UseSetting("PYRUS_SECURITY_KEY", "key");
        builder.UseSetting("PYRUS_FORM_ID", "2457342");
        builder.UseSetting("LOG_DIR", Path.Combine(Path.GetTempPath(), "comp-design-bot-tests"));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IPyrusClient>();
            services.AddSingleton<IPyrusClient>(Pyrus);
            services.RemoveAll<ITelegramBotClient>();
            services.AddSingleton<ITelegramBotClient>(Bot);
        });
    }

    public string TokenFor(long id, string name = "Тест Тестов", string? handle = "@tester") => Tokens.IssueToken(new Viewer(id, name, handle));

    /// <summary>Отправляет обновление в webhook и ждёт, пока обработчики его переварят.</summary>
    public async Task DeliverAsync(Update update)
    {
        var dispatcher = Services.GetRequiredService<UpdateDispatcher>();
        await dispatcher.HandleAsync(update, CancellationToken.None);
    }
}
