using CompDesignBot.Channels.Telegram;
using CompDesignBot.Channels.Telegram.Handlers;
using CompDesignBot.Features.Catalog;
using CompDesignBot.Features.Feed;
using CompDesignBot.Features.Identity;
using CompDesignBot.Features.Notifications;
using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;
using Telegram.Bot;

namespace CompDesignBot.Hosting;

/// <summary>Состав приложения: какие реализации стоят за контрактами модулей.</summary>
public static class ServiceRegistration
{
    public static IServiceCollection AddCompDesignBot(this IServiceCollection services, AppOptions options)
    {
        services.AddSingleton(options);
        services.AddSingleton(TimeProvider.System);

        // Infrastructure
        services.AddHttpClient<IPyrusClient, PyrusClient>(client => client.Timeout = TimeSpan.FromSeconds(20));
        services.AddHttpClient("telegram")
            .AddTypedClient<ITelegramBotClient>(http => new TelegramBotClient(options.TelegramToken, http));
        services.AddSingleton<IRequestRegistry, PyrusRequestRegistry>();

        // Features
        services.AddSingleton(new SessionTokens(options.SessionSecret, options.TelegramToken));
        services.AddSingleton<RequestService>();
        services.AddSingleton<FeedService>();
        services.AddSingleton<ProjectCatalog>();

        // Channels/Telegram: чат отдела и уведомления — реализации контрактов модулей.
        services.AddSingleton<DeptChat>();
        services.AddSingleton<IDeptChannel>(sp => sp.GetRequiredService<DeptChat>());
        services.AddSingleton<INotifier, TelegramNotifier>();
        services.AddSingleton<Keyboards>();
        services.AddSingleton<StateStore>();
        services.AddSingleton<KeyedAsyncLock>();
        services.AddSingleton<StartHandler>();
        services.AddSingleton<DeptHandler>();
        services.AddSingleton<FeedbackHandler>();
        services.AddSingleton<UpdateDispatcher>();
        services.AddSingleton<UpdateQueue>();
        services.AddHostedService<UpdateWorker>();
        services.AddHostedService<BotSetupService>();

        services.AddScoped<ApiErrorFilter>();
        return services;
    }
}
