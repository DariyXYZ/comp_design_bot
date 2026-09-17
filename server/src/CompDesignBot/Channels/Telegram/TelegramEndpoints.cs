using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CompDesignBot.Hosting;
using Telegram.Bot;
using Telegram.Bot.Types;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Webhook Telegram. Обновление кладётся в очередь и сразу отвечается 200 —
/// иначе Telegram повторит его. Секрет из заголовка сверяется, если задан.
/// </summary>
public static class TelegramEndpoints
{
    private const string SecretHeader = "X-Telegram-Bot-Api-Secret-Token";

    public static IEndpointRouteBuilder MapTelegram(this IEndpointRouteBuilder app)
    {
        app.MapPost(BotSetupService.WebhookPath, async (HttpRequest request, AppOptions options, UpdateQueue queue,
            ILoggerFactory loggers, CancellationToken ct) =>
        {
            if (options.WebhookSecret.Length > 0 && !SecretMatches(request.Headers[SecretHeader].ToString(), options.WebhookSecret))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            Update? update;
            try
            {
                // Разбор тем же сериализатором, что у библиотеки: у Bot API snake_case,
                // а глобальные JSON-настройки приложения — camelCase для своего API.
                update = await JsonSerializer.DeserializeAsync<Update>(request.Body, JsonBotAPI.Options, ct);
            }
            catch (JsonException e)
            {
                loggers.CreateLogger("Telegram").LogWarning("Webhook: тело не разобрано: {Error}", e.Message);
                return Results.BadRequest();
            }

            if (update is null)
            {
                return Results.BadRequest();
            }

            await queue.EnqueueAsync(update, ct);
            return Results.Ok();
        });

        return app;
    }

    private static bool SecretMatches(string actual, string expected) =>
        actual.Length > 0 && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(actual), Encoding.UTF8.GetBytes(expected));
}
