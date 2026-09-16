using CompDesignBot.Features.Requests;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Features.Bot.Handlers;

/// <summary>Старт, меню, инфо, мои заявки, /id.</summary>
public sealed class StartHandler
{
    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly Keyboards _keyboards;
    private readonly RequestStore _requests;
    private readonly ILogger<StartHandler> _log;

    /// <summary>Путь от сборки, а не от рабочей директории: службу запускают из другого места.</summary>
    private static readonly string WelcomeImage = Path.Combine(AppContext.BaseDirectory, "Assets", "welcome.jpg");

    /// <summary>
    /// После первой отправки Telegram возвращает file_id — дальше картинку можно
    /// не загружать. Кэш в памяти: после рестарта первый /start загрузит файл снова.
    /// </summary>
    private string? _welcomePhotoId;

    public StartHandler(ITelegramBotClient bot, StateStore states, Keyboards keyboards, RequestStore requests, ILogger<StartHandler> log)
    {
        _bot = bot;
        _states = states;
        _keyboards = keyboards;
        _requests = requests;
        _log = log;
    }

    public async Task CmdStartAsync(Message message, CancellationToken ct)
    {
        var user = message.From!;
        // /start посреди заявки сбрасывает черновик, а не молча ест текст.
        _states.Clear(message.Chat.Id, user.Id);

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
                    replyMarkup: _keyboards.MainMenu(user), cancellationToken: ct);
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

        await _bot.SendMessage(message.Chat.Id, Texts.Welcome, parseMode: ParseMode.Html, replyMarkup: _keyboards.MainMenu(user), cancellationToken: ct);
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

    /// <summary>
    /// Свежая кнопка, открывающая Mini App: адрес и код входа живут внутри кнопки,
    /// а Telegram обновляет меню только сообщением с разметкой.
    /// </summary>
    public Task OpenAppAsync(Message message, CancellationToken ct)
    {
        _states.Clear(message.Chat.Id, message.From!.Id);
        return _bot.SendMessage(message.Chat.Id, Texts.OpenApp, parseMode: ParseMode.Html, replyMarkup: _keyboards.AppButton(message.From), cancellationToken: ct);
    }

    public Task ShowInfoAsync(Message message, CancellationToken ct)
    {
        _states.Clear(message.Chat.Id, message.From!.Id);
        return _bot.SendMessage(message.Chat.Id, Texts.Info, parseMode: ParseMode.Html, replyMarkup: _keyboards.MainMenu(message.From), cancellationToken: ct);
    }

    /// <summary>Список заявок человека одним текстом.</summary>
    public async Task<string> RenderUserRequestsAsync(long userId, CancellationToken ct)
    {
        var requests = await _requests.ListUserRequestsAsync(userId, ct);
        if (requests.Count == 0)
        {
            return Texts.NoRequests;
        }

        var blocks = requests.Select(r =>
        {
            var head = $"№{r.TaskId} · {RequestCard.Escape(r.CaseTitle)}";
            var status = ChatStatus.LabelForBoard(r.BoardStatus, r.Closed);
            var created = r.Created ?? "";
            var tail = $"{status} · {(created.Length > 10 ? created[..10] : created)}";
            var excerpt = RequestCard.Escape(RequestCard.Excerpt(r.Description));
            return excerpt.Length > 0 ? $"{head}\n{excerpt}\n{tail}" : $"{head}\n{tail}";
        });
        return string.Join("\n\n", blocks);
    }

    public async Task MyRequestsAsync(Message message, CancellationToken ct)
    {
        var user = message.From!;
        _states.Clear(message.Chat.Id, user.Id);
        // Клавиатура пересылается с ответом: в кнопке Mini App лежит код входа, а
        // Telegram обновляет клавиатуру только сообщением с разметкой.
        await _bot.SendMessage(message.Chat.Id, await RenderUserRequestsAsync(user.Id, ct), parseMode: ParseMode.Html,
            replyMarkup: _keyboards.MainMenu(user), cancellationToken: ct);
    }
}
