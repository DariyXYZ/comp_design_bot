using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Channels.Telegram.Handlers;

/// <summary>Старт, кнопка приложения, /id. Заявок в чате нет — всё в Mini App.</summary>
public sealed class StartHandler
{
    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly Keyboards _keyboards;
    private readonly ILogger<StartHandler> _log;

    /// <summary>Путь от сборки, а не от рабочей директории: службу запускают из другого места.</summary>
    private static readonly string WelcomeImage = Path.Combine(AppContext.BaseDirectory, "Assets", "welcome.jpg");

    /// <summary>
    /// После первой отправки Telegram возвращает file_id — дальше картинку можно
    /// не загружать. Кэш в памяти: после рестарта первый /start загрузит файл снова.
    /// </summary>
    private string? _welcomePhotoId;

    public StartHandler(ITelegramBotClient bot, StateStore states, Keyboards keyboards, ILogger<StartHandler> log)
    {
        _bot = bot;
        _states = states;
        _keyboards = keyboards;
        _log = log;
    }

    public async Task CmdStartAsync(Message message, CancellationToken ct)
    {
        // /start посреди ожидания (отзыв) сбрасывает его, а не молча ест текст.
        _states.Clear(message.Chat.Id, message.From!.Id);

        InputFile? photo = _welcomePhotoId is { } cached ? InputFile.FromFileId(cached) : null;
        Stream? stream = null;
        if (photo is null && File.Exists(WelcomeImage))
        {
            stream = File.OpenRead(WelcomeImage);
            photo = InputFile.FromStream(stream, "welcome.jpg");
        }

        if (photo is not null)
        {
            try
            {
                var sent = await _bot.SendPhoto(message.Chat.Id, photo, caption: Texts.Welcome, parseMode: ParseMode.Html,
                    replyMarkup: _keyboards.AppButton(), cancellationToken: ct);
                if (_welcomePhotoId is null && sent.Photo is { Length: > 0 } sizes)
                {
                    _welcomePhotoId = sizes[^1].FileId;
                }

                return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // /start — вход в бота, он не имеет права упасть из-за картинки.
                _log.LogError(e, "Не удалось отправить welcome-картинку, отправляю текстом");
            }
            finally
            {
                stream?.Dispose();
            }
        }

        await _bot.SendMessage(message.Chat.Id, Texts.Welcome, parseMode: ParseMode.Html, replyMarkup: _keyboards.AppButton(), cancellationToken: ct);
    }

    /// <summary>Работает в любом чате: показывает chat_id и thread_id — для настройки окружения.</summary>
    public Task CmdIdAsync(Message message, CancellationToken ct)
    {
        var lines = new List<string> { $"chat_id: <code>{message.Chat.Id}</code>" };
        if (message.MessageThreadId is { } thread)
        {
            lines.Add($"thread_id: <code>{thread}</code>");
        }

        return _bot.SendMessage(message.Chat.Id, string.Join('\n', lines), parseMode: ParseMode.Html,
            replyParameters: new ReplyParameters { MessageId = message.MessageId }, cancellationToken: ct);
    }

    /// <summary>Свежая кнопка приложения — по /app и на любой текст в личке, кроме ожидаемых.</summary>
    public Task OpenAppAsync(long chatId, long userId, string text, CancellationToken ct)
    {
        _states.Clear(chatId, userId);
        return _bot.SendMessage(chatId, text, parseMode: ParseMode.Html, replyMarkup: _keyboards.AppButton(), cancellationToken: ct);
    }
}
