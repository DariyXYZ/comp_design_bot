using CompDesignBot.Channels.Telegram;
using CompDesignBot.Features.Catalog;
using CompDesignBot.Features.Feed;
using CompDesignBot.Features.Identity;
using CompDesignBot.Features.Requests;
using CompDesignBot.Hosting;
using Serilog;

// Логи — в файл рядом со сборкой (или LOG_DIR) и в консоль: службе консоль не
// видна, а файл читается без журнала событий. Bootstrap-логгер нужен, чтобы
// ошибка конфигурации на старте тоже попала в файл, а не только в stderr.
var logDir = Environment.GetEnvironmentVariable("LOG_DIR") is { Length: > 0 } dir ? dir : Path.Combine(AppContext.BaseDirectory, "logs");
var logFile = Path.Combine(logDir, "bot-.log");
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File(logFile, rollingInterval: RollingInterval.Day, retainedFileCountLimit: 30)
    .CreateBootstrapLogger();

try
{
    Run(args);
}
catch (Exception e)
{
    Log.Fatal(e, "Служба не запустилась");
    throw;
}
finally
{
    Log.CloseAndFlush();
}

void Run(string[] args)
{
    var builder = WebApplication.CreateBuilder(args);

    // preserveStaticLogger: у хоста свой логгер, bootstrap остаётся для ошибок
    // старта — и тесты могут поднимать несколько хостов в одном процессе.
    builder.Host.UseSerilog((context, logger) => logger
        .ReadFrom.Configuration(context.Configuration)
        .Enrich.FromLogContext()
        .WriteTo.Console()
        .WriteTo.File(logFile, rollingInterval: RollingInterval.Day, retainedFileCountLimit: 30), preserveStaticLogger: true);

    // Windows-служба: остановка по SCM, рабочий каталог — папка сборки.
    builder.Host.UseWindowsService(options => options.ServiceName = "CompDesignBot");

    // Конфиг читается один раз: нет обязательной переменной — служба не стартует.
    builder.Services.AddCompDesignBot(AppOptions.Load(builder.Configuration));

    var app = builder.Build();

    app.UseSerilogRequestLogging();
    app.UseStaticSite();
    app.UseRouting();

    app.MapGet("/health", () => Results.Ok(new { ok = true }));
    app.MapTelegram();

    var api = app.MapGroup("/api").AddEndpointFilter<ApiErrorFilter>();
    api.MapIdentity();
    api.MapRequests();
    api.MapFeed();
    api.MapCatalog();

    app.MapNotFoundPage();
    app.Run();
}

/// <summary>Точка входа видна тестам через WebApplicationFactory.</summary>
public partial class Program;
