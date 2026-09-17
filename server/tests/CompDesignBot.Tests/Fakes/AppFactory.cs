using CompDesignBot.Channels.Telegram;
using CompDesignBot.Features.Identity;
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
    public const string SessionSecret = "session-secret";
    public const long DeptChatId = -1003204218879;
    public const int DeptThreadId = 5011;
    public const string WebhookSecret = "hook-secret";

    public FakePyrusClient Pyrus { get; } = new();

    public FakeBotClient Bot { get; } = new();

    public SessionTokens Tokens { get; } = new(SessionSecret, BotToken);

    /// <summary>Заглушка статического экспорта: три файла, чтобы проверить раздачу.</summary>
    public string WebRoot { get; } = Path.Combine(Path.GetTempPath(), "comp-design-bot-wwwroot-" + Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(Path.Combine(WebRoot, "feed"));
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<title>Решения и заявки</title>");
        File.WriteAllText(Path.Combine(WebRoot, "feed", "index.html"), "<title>Поток</title>");
        File.WriteAllText(Path.Combine(WebRoot, "404.html"), "<title>Нет такой страницы</title>");
        builder.UseWebRoot(WebRoot);
        // Не Development: иначе SDK подмешивает настоящий wwwroot проекта (static web
        // assets), и заглушка выше проигрывает ему.
        builder.UseEnvironment("Testing");
        builder.UseSetting("TELEGRAM_TOKEN", BotToken);
        builder.UseSetting("SESSION_SECRET", SessionSecret);
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

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(WebRoot))
        {
            Directory.Delete(WebRoot, recursive: true);
        }
    }

    public string TokenFor(long id, string name = "Тест Тестов", string? handle = "@tester") => Tokens.IssueToken(new Viewer(id, name, handle));

    /// <summary>Отправляет обновление в webhook и ждёт, пока обработчики его переварят.</summary>
    public async Task DeliverAsync(Update update)
    {
        var dispatcher = Services.GetRequiredService<UpdateDispatcher>();
        await dispatcher.HandleAsync(update, CancellationToken.None);
    }
}
