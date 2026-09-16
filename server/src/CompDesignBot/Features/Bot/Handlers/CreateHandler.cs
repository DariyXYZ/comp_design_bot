using System.Text.Json;
using CompDesignBot.Features.Requests;
using CompDesignBot.Features.Topics;
using CompDesignBot.Infrastructure.Telegram;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Features.Bot.Handlers;

/// <summary>FSM создания заявки: тема → описание → фото → исходники → превью → отправка.</summary>
public sealed class CreateHandler
{
    public const int MaxDescription = 3000;
    public const int MaxSource = 500;
    /// <summary>Проект, срок, название основы — короткие строки.</summary>
    public const int MaxMiniAppField = 200;
    /// <summary>Ожидаемый результат — абзац, не описание целиком.</summary>
    public const int MaxExpected = 1500;

    private readonly ITelegramBotClient _bot;
    private readonly StateStore _states;
    private readonly KeyedAsyncLock _userLocks;
    private readonly RequestStore _requests;
    private readonly DeptChat _dept;
    private readonly StartHandler _start;
    private readonly ILogger<CreateHandler> _log;

    public CreateHandler(ITelegramBotClient bot, StateStore states, BotLocks locks, RequestStore requests,
        DeptChat dept, StartHandler start, ILogger<CreateHandler> log)
    {
        _bot = bot;
        _states = states;
        _userLocks = locks.Users;
        _requests = requests;
        _dept = dept;
        _start = start;
        _log = log;
    }

    /// <summary>Единая точка входа — из кнопки меню, из Mini App, из deep link.</summary>
    private async Task StartRequestAsync(long chatId, long userId, string caseKey, CancellationToken ct)
    {
        _states.Clear(chatId, userId);
        var entry = _states.Entry(chatId, userId);
        entry.Data.CaseKey = caseKey;
        entry.State = BotState.NewDescription;
        var text = Texts.AskDescription(Cases.Find(caseKey)!.Title) + Texts.ClarifyingBlock(caseKey);
        await _bot.SendMessage(chatId, text, parseMode: ParseMode.Html, cancellationToken: ct);
    }

    /// <summary>
    /// Единственный вход в чат-версию заявки — на случай, когда WEBAPP_URL не
    /// настроен и кнопка «Решения и заявки» приходит обычным текстом.
    /// </summary>
    public Task ChooseCaseAsync(Message message, CancellationToken ct)
    {
        _states.Clear(message.Chat.Id, message.From!.Id);
        return _bot.SendMessage(message.Chat.Id, Texts.ChooseCase, replyMarkup: Keyboards.CasePicker(), cancellationToken: ct);
    }

    private static string? StringField(JsonElement data, string key, int limit)
    {
        if (!data.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = (value.GetString() ?? "").Trim();
        if (text.Length > limit)
        {
            text = text[..limit];
        }

        return text.Length > 0 ? text : null;
    }

    /// <summary>Целое из payload Mini App; мусор и пусто — null.</summary>
    private static long? IntField(JsonElement data, string key)
    {
        if (!data.TryGetProperty(key, out var value))
        {
            return null;
        }

        var raw = (value.ValueKind == JsonValueKind.Number ? value.GetRawText() : value.GetString() ?? "").Trim();
        return raw.Length > 0 && raw.All(char.IsAsciiDigit) && long.TryParse(raw, out var parsed) ? parsed : null;
    }

    /// <summary>
    /// guid картинок, загруженных прямо в форме Mini App. Шесть — столько же,
    /// сколько разрешает форма; лишнее отбрасывается, чтобы чужой payload не
    /// заставил бота слать десятки запросов.
    /// </summary>
    internal static List<string> WebAppPhotoGuids(JsonElement data)
    {
        var raw = StringField(data, "photos", 1000) ?? "";
        return raw.Split(',').Select(part => part.Trim()).Where(part => part.Length > 0).Take(6).ToList();
    }

    /// <summary>
    /// Описание заявки из полей формы Mini App. Проект, основа и срок
    /// дописываются в шапку описания: карточка в чате отдела рендерится из
    /// описания, и при смене статуса эти строки должны остаться на месте.
    /// </summary>
    internal static string? WebAppDescription(JsonElement data)
    {
        var description = StringField(data, "description", MaxDescription);
        if (description is null)
        {
            return null;
        }

        var head = new List<string>();
        if (StringField(data, "project", MaxMiniAppField) is { } project)
        {
            head.Add($"Проект: {project}");
        }

        if (StringField(data, "origin", MaxMiniAppField) is { } origin)
        {
            head.Add($"Основа: {origin}");
        }

        if (StringField(data, "deadline", MaxMiniAppField) is { } deadline)
        {
            head.Add($"Срок: {deadline}");
        }

        var photos = WebAppPhotoGuids(data);
        if (photos.Count > 0)
        {
            head.Add($"Картинки: {photos.Count} — приложены в задаче Pyrus");
        }

        if (head.Count == 0)
        {
            return description;
        }

        var full = string.Join('\n', head) + "\n\n" + description;
        return full.Length > MaxDescription ? full[..MaxDescription] : full;
    }

    /// <summary>
    /// Данные из Mini App. Два вида полезной нагрузки: <c>{case}</c> — выбрана
    /// только тема, дальше опрос в чате; <c>{case, description, …}</c> — форма
    /// заполнена, остаются картинки (файлы через sendData не проходят).
    /// </summary>
    public async Task FromWebAppAsync(Message message, CancellationToken ct)
    {
        JsonElement data;
        try
        {
            using var doc = JsonDocument.Parse(message.WebAppData!.Data);
            data = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }

        if (data.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var user = message.From!;
        var chatId = message.Chat.Id;
        if (data.TryGetProperty("action", out var action) && action.ValueKind == JsonValueKind.String && action.GetString() == "my_requests")
        {
            await _bot.SendMessage(chatId, await _start.RenderUserRequestsAsync(user.Id, ct), parseMode: ParseMode.Html, cancellationToken: ct);
            return;
        }

        var caseKey = data.TryGetProperty("case", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
        if (!Cases.Exists(caseKey))
        {
            return;
        }

        var description = WebAppDescription(data);
        List<string> guids;
        using (await _userLocks.LockAsync(user.Id, ct))
        {
            var entry = _states.Entry(chatId, user.Id);
            // Дубль sendData от двойного тапа в Mini App: та же заявка уже идёт.
            if (entry.State is BotState.NewDescription or BotState.NewPhotos
                && entry.Data.CaseKey == caseKey
                && entry.Data.Description == description)
            {
                return;
            }

            if (description is null)
            {
                await StartRequestAsync(chatId, user.Id, caseKey!, ct);
                return;
            }

            // Путь к исходникам: сначала то, что указал человек, иначе папка решения.
            var source = StringField(data, "source", MaxSource) ?? StringField(data, "origin_path", MaxSource);
            guids = WebAppPhotoGuids(data);
            _states.Clear(chatId, user.Id);
            entry = _states.Entry(chatId, user.Id);
            entry.Data.CaseKey = caseKey;
            entry.Data.Description = description;
            entry.Data.PyrusPhotoGuids = guids;
            entry.Data.SourcePath = source;
            entry.Data.FromWebApp = true;
            // Те же значения, что уже в шапке описания, но по отдельности: карточке
            // нужен связный текст, а форме Pyrus — поля.
            entry.Data.Project = StringField(data, "project", MaxMiniAppField);
            entry.Data.ProjectId = IntField(data, "project_id");
            entry.Data.Origin = StringField(data, "origin", MaxMiniAppField);
            entry.Data.OriginPath = StringField(data, "origin_path", MaxSource);
            entry.Data.Deadline = StringField(data, "deadline", MaxMiniAppField);
            entry.Data.Expected = StringField(data, "expected", MaxExpected);
            // Картинки уже приложены в приложении — спрашивать их снова незачем.
            entry.State = guids.Count > 0 ? BotState.NewPreview : BotState.NewPhotos;
        }

        if (guids.Count > 0)
        {
            await ShowPreviewAsync(chatId, user, ct);
        }
        else
        {
            await _bot.SendMessage(chatId, Texts.AskPhotosFromWebApp, parseMode: ParseMode.Html, replyMarkup: Keyboards.PhotosStep(), cancellationToken: ct);
        }
    }

    public async Task CaseChosenAsync(CallbackQuery callback, CancellationToken ct)
    {
        var caseKey = callback.Data!["case:".Length..];
        if (!Cases.Exists(caseKey))
        {
            await _bot.AnswerCallbackQuery(callback.Id, "Неизвестная задача", cancellationToken: ct);
            return;
        }

        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        await ClearMarkupAsync(callback, ct);
        await StartRequestAsync(callback.Message!.Chat.Id, callback.From.Id, caseKey, ct);
    }

    public async Task GotDescriptionAsync(Message message, CancellationToken ct)
    {
        var text = message.Text!.Trim();
        if (text.Length == 0)
        {
            await _bot.SendMessage(message.Chat.Id, Texts.DescriptionEmpty, cancellationToken: ct);
            return;
        }

        if (text.Length > MaxDescription)
        {
            await _bot.SendMessage(message.Chat.Id, Texts.DescriptionTooLong(text.Length, MaxDescription), cancellationToken: ct);
            return;
        }

        var entry = _states.Entry(message.Chat.Id, message.From!.Id);
        entry.Data.Description = text;
        entry.State = BotState.NewPhotos;
        await _bot.SendMessage(message.Chat.Id, Texts.AskPhotos, parseMode: ParseMode.Html, replyMarkup: Keyboards.PhotosStep(), cancellationToken: ct);
    }

    public Task DescriptionWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.DescriptionWrongType, cancellationToken: ct);

    public async Task GotPhotoAsync(Message message, CancellationToken ct)
    {
        bool first;
        // Альбом приходит серией почти одновременных сообщений — без лока
        // конкурентные чтение/запись теряют часть фото.
        using (await _userLocks.LockAsync(message.From!.Id, ct))
        {
            var photos = _states.Entry(message.Chat.Id, message.From.Id).Data.Photos;
            photos.Add(message.Photo![^1].FileId);
            first = photos.Count == 1;
        }

        if (first)
        {
            await _bot.SendMessage(message.Chat.Id, Texts.PhotoAccepted, replyMarkup: Keyboards.PhotosStep(), cancellationToken: ct);
        }
    }

    public Task PhotosWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.PhotosWrongType, cancellationToken: ct);

    public async Task PhotosDoneAsync(CallbackQuery callback, CancellationToken ct)
    {
        var chatId = callback.Message!.Chat.Id;
        var entry = _states.Entry(chatId, callback.From.Id);
        if (callback.Data == "photos:skip")
        {
            entry.Data.Photos.Clear();
        }

        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        // Заявка из формы Mini App: про исходники там уже спрашивали.
        if (entry.Data.FromWebApp)
        {
            await ShowPreviewAsync(chatId, callback.From, ct);
            return;
        }

        entry.State = BotState.NewSource;
        await _bot.SendMessage(chatId, Texts.AskSource, parseMode: ParseMode.Html, replyMarkup: Keyboards.SourceStep(), cancellationToken: ct);
    }

    public async Task GotSourceAsync(Message message, CancellationToken ct)
    {
        var text = message.Text!.Trim();
        if (text.Length > MaxSource)
        {
            text = text[..MaxSource];
        }

        _states.Entry(message.Chat.Id, message.From!.Id).Data.SourcePath = text.Length > 0 ? text : null;
        await ShowPreviewAsync(message.Chat.Id, message.From, ct);
    }

    public Task SourceWrongTypeAsync(Message message, CancellationToken ct) =>
        _bot.SendMessage(message.Chat.Id, Texts.SourceWrongType, cancellationToken: ct);

    public async Task SourceSkippedAsync(CallbackQuery callback, CancellationToken ct)
    {
        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        var chatId = callback.Message!.Chat.Id;
        _states.Entry(chatId, callback.From.Id).Data.SourcePath = null;
        await ShowPreviewAsync(chatId, callback.From, ct);
    }

    private async Task ShowPreviewAsync(long chatId, User user, CancellationToken ct)
    {
        var entry = _states.Entry(chatId, user.Id);
        entry.State = BotState.NewPreview;
        var draft = entry.Data;
        var card = RequestCard.Render(null, CaseTitle(draft.CaseKey), draft.Description ?? "", draft.SourcePath, AuthorLine(user));
        var total = draft.Photos.Count + draft.PyrusPhotoGuids.Count;
        var note = total > 0 ? $"\n\n🖼 Картинок: {total}" : "";
        await _bot.SendMessage(chatId, $"{Texts.PreviewHeader}\n\n{card}{note}", parseMode: ParseMode.Html,
            replyMarkup: Keyboards.PreviewStep(), cancellationToken: ct);
    }

    public async Task CancelRequestAsync(CallbackQuery callback, CancellationToken ct)
    {
        var chatId = callback.Message!.Chat.Id;
        _states.Clear(chatId, callback.From.Id);
        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        await ClearMarkupAsync(callback, ct);
        await _bot.SendMessage(chatId, Texts.Canceled, cancellationToken: ct);
    }

    /// <summary>Качает картинки заявки из Telegram и прикладывает их к задаче Pyrus.</summary>
    private async Task AttachPhotosToPyrusAsync(long taskId, IReadOnlyList<string> fileIds, CancellationToken ct)
    {
        if (fileIds.Count == 0)
        {
            return;
        }

        var files = new List<(string Name, byte[] Data)>();
        var number = 0;
        foreach (var fileId in fileIds)
        {
            number++;
            try
            {
                var file = await _bot.GetFile(fileId, cancellationToken: ct);
                if (file.FilePath is null)
                {
                    continue;
                }

                using var buffer = new MemoryStream();
                await _bot.DownloadFile(file.FilePath, buffer, ct);
                files.Add(($"photo-{number}.jpg", buffer.ToArray()));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Одна битая картинка — не повод падать.
                _log.LogError(e, "Не удалось скачать фото {FileId} для Pyrus", fileId);
            }
        }

        await _requests.AttachPhotosAsync(taskId, files, ct);
    }

    public async Task SendRequestAsync(CallbackQuery callback, CancellationToken ct)
    {
        var user = callback.From;
        var chatId = callback.Message!.Chat.Id;
        var author = AuthorLine(user);
        Draft draft;
        long reqId;
        string caseTitle;
        // Лок на весь путь до задачи в Pyrus: двойной тап по «Отправить» не
        // создаст дубль — второй колбэк видит уже очищенное состояние.
        using (await _userLocks.LockAsync(user.Id, ct))
        {
            draft = _states.Entry(chatId, user.Id).Data;
            if (draft.CaseKey is null)
            {
                await _bot.AnswerCallbackQuery(callback.Id, "Заявка уже отправлена", cancellationToken: ct);
                return;
            }

            caseTitle = CaseTitle(draft.CaseKey);
            // Pyrus — единственное хранилище: пока задачи нет, заявки нет. Не
            // создалась — состояние не трогаем, человек нажмёт «Отправить» ещё раз.
            var created = await _requests.SendRequestAsync(new NewRequest
            {
                CaseTitle = caseTitle,
                Description = draft.Description ?? "",
                Author = author,
                SourcePath = draft.SourcePath,
                TgUserId = user.Id,
                Project = draft.Project,
                ProjectId = draft.ProjectId,
                Origin = draft.Origin,
                OriginPath = draft.OriginPath,
                Deadline = draft.Deadline,
                Expected = draft.Expected,
            }, ct);
            if (created is not { } id)
            {
                await _bot.AnswerCallbackQuery(callback.Id, Texts.SentPyrusFailed, showAlert: true, cancellationToken: ct);
                return;
            }

            reqId = id;
            _states.Clear(chatId, user.Id);
        }

        await _bot.AnswerCallbackQuery(callback.Id, cancellationToken: ct);
        await ClearMarkupAsync(callback, ct);

        // Картинки — отдельным шагом: заявка уже создана, сбой загрузки её не рушит.
        await AttachPhotosToPyrusAsync(reqId, draft.Photos, ct);
        await _requests.AttachUploadedAsync(reqId, draft.PyrusPhotoGuids, ct);

        if (!_dept.Configured)
        {
            await _bot.SendMessage(chatId, Texts.SentNoDept(reqId), cancellationToken: ct);
            return;
        }

        var photos = draft.Photos;
        var description = draft.Description ?? "";
        var buttons = Keyboards.DeptStatusButtons(reqId);
        Message deptMessage;
        try
        {
            if (photos.Count == 0)
            {
                // 0 фото: текст + кнопки в одном сообщении.
                var card = RequestCard.Render(reqId, caseTitle, description, draft.SourcePath, author, expected: draft.Expected);
                deptMessage = await _dept.SendAsync(card, buttons, ct: ct);
            }
            else if (photos.Count == 1)
            {
                // 1 фото: подпись к фото = вся карточка + кнопки — тоже одно сообщение.
                var caption = RequestCard.Render(reqId, caseTitle, description, draft.SourcePath, author,
                    maxLen: RequestCard.CaptionLimit, expected: draft.Expected);
                deptMessage = await _bot.SendPhoto(_dept.ChatId!.Value, InputFile.FromFileId(photos[0]), caption: caption,
                    parseMode: ParseMode.Html, replyMarkup: buttons, messageThreadId: _dept.ThreadId, cancellationToken: ct);
            }
            else
            {
                // 2+ фото: Telegram не разрешает кнопки на альбоме. Текст — подписью к
                // первому фото, кнопки — короткой строкой статуса следом.
                var caption = RequestCard.Render(reqId, caseTitle, description, draft.SourcePath, author,
                    maxLen: RequestCard.CaptionLimit, expected: draft.Expected);
                var media = new List<IAlbumInputMedia>
                {
                    new InputMediaPhoto(InputFile.FromFileId(photos[0])) { Caption = caption, ParseMode = ParseMode.Html },
                };
                media.AddRange(photos.Skip(1).Take(9).Select(fid => new InputMediaPhoto(InputFile.FromFileId(fid))));
                var album = await _bot.SendMediaGroup(_dept.ChatId!.Value, media, messageThreadId: _dept.ThreadId, cancellationToken: ct);
                deptMessage = await _dept.SendAsync(RequestCard.ShortLine(reqId, caseTitle, ChatStatus.New), buttons, album[0].MessageId, ct: ct);
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Заявка уже в Pyrus — не теряем её молча, а честно говорим пользователю.
            _log.LogError(e, "Заявка №{ReqId} создана, но не доставлена в чат отдела", reqId);
            await _bot.SendMessage(chatId, Texts.SentDeptFailed(reqId), cancellationToken: ct);
            return;
        }

        // Карточка в чат уже ушла и рабочая — если этот вспомогательный write в
        // Pyrus упадёт, заявителю нельзя врать про SentDeptFailed.
        await _requests.SetChatMessageAsync(reqId, deptMessage.MessageId, ct);
        await _bot.SendMessage(chatId, Texts.SentOk(reqId), cancellationToken: ct);
    }

    private async Task ClearMarkupAsync(CallbackQuery callback, CancellationToken ct)
    {
        try
        {
            await _bot.EditMessageReplyMarkup(callback.Message!.Chat.Id, callback.Message.MessageId, replyMarkup: null, cancellationToken: ct);
        }
        catch (ApiRequestException)
        {
            // Двойной тап или старое сообщение — не критично.
        }
    }

    private static string CaseTitle(string? caseKey) => Cases.Find(caseKey)?.Title ?? caseKey ?? "";

    public static string AuthorLine(User user) => RequestCard.AuthorLine(Keyboards.FullName(user), user.Username);
}
