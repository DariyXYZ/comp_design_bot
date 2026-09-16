using CompDesignBot.Config;
using CompDesignBot.Endpoints;
using CompDesignBot.Features.Auth;
using CompDesignBot.Features.Bot;
using CompDesignBot.Features.Bot.Handlers;
using CompDesignBot.Features.Feed;
using CompDesignBot.Features.Requests;
using CompDesignBot.Features.Topics;
using CompDesignBot.Infrastructure.Pyrus;
using CompDesignBot.Infrastructure.Telegram;
using Serilog;
using Telegram.Bot;

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
    var options = AppOptions.Load(builder.Configuration);
    builder.Services.AddSingleton(options);
    builder.Services.AddSingleton(TimeProvider.System);

    builder.Services.AddHttpClient<IPyrusClient, PyrusClient>(client => client.Timeout = TimeSpan.FromSeconds(20));
    builder.Services.AddHttpClient("telegram")
        .AddTypedClient<ITelegramBotClient>(http => new TelegramBotClient(options.TelegramToken, http));

    builder.Services.AddSingleton(new SessionTokens(options.TelegramToken));
    builder.Services.AddSingleton<RequestStore>();
    builder.Services.AddSingleton<FeedService>();
    builder.Services.AddSingleton<ProjectCatalog>();
    builder.Services.AddSingleton<DeptChat>();

    builder.Services.AddSingleton<StateStore>();
    builder.Services.AddSingleton<BotLocks>();
    builder.Services.AddSingleton<Keyboards>();
    builder.Services.AddSingleton<StartHandler>();
    builder.Services.AddSingleton<CreateHandler>();
    builder.Services.AddSingleton<DeptHandler>();
    builder.Services.AddSingleton<FeedbackHandler>();
    builder.Services.AddSingleton<UpdateDispatcher>();
    builder.Services.AddSingleton<UpdateQueue>();
    builder.Services.AddHostedService<UpdateWorker>();
    builder.Services.AddHostedService<BotSetupService>();

    builder.Services.AddScoped<ApiErrorFilter>();

    var app = builder.Build();

    app.UseSerilogRequestLogging();

    // Mini App — статический экспорт Next.js из wwwroot. Экспорт со слэшем на конце
    // (`feed/index.html`), а клиент иногда открывает `/feed` — переводим на слэш,
    // как делал бы сам Next.
    app.Use(async (context, next) =>
    {
        var path = context.Request.Path.Value ?? "/";
        if (context.Request.Method == HttpMethods.Get
            && !path.EndsWith('/')
            && !path.StartsWith("/api", StringComparison.Ordinal)
            && !Path.HasExtension(path)
            && File.Exists(Path.Combine(app.Environment.WebRootPath ?? "", path.TrimStart('/'), "index.html")))
        {
            context.Response.Redirect(path + "/" + context.Request.QueryString, permanent: true);
            return;
        }

        await next();
    });
    app.UseDefaultFiles();
    app.UseStaticFiles();

    // Маршрутизация — после статики: иначе fallback-эндпоинт ниже совпадает первым,
    // и middleware статических файлов уступает ему любой путь.
    app.UseRouting();

    app.MapGet("/health", () => Results.Ok(new { ok = true }));
    app.MapTelegram();

    var api = app.MapGroup("/api").AddEndpointFilter<ApiErrorFilter>();
    api.MapAuth();
    api.MapRequests();
    api.MapFeed();
    api.MapCatalogs();

    // Всё, что не нашлось, — страница 404 экспорта, если она есть.
    app.MapFallback(async (HttpContext context) =>
    {
        var notFound = Path.Combine(app.Environment.WebRootPath ?? "", "404.html");
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        if (File.Exists(notFound))
        {
            context.Response.ContentType = "text/html; charset=utf-8";
            await context.Response.SendFileAsync(notFound);
        }
    });

    app.Run();
}

/// <summary>Точка входа видна тестам через WebApplicationFactory.</summary>
public partial class Program;
