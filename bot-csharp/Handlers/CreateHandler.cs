using System.Net;
using System.Text;
using System.Text.Json;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Handlers;

// Порт handlers/create.py — FSM создания заявки:
// задача → описание → фото → исходники → превью → отправка.
public static class CreateHandler
{
    public const int MaxDescription = 3000;
    public const int MaxSource = 500;
    public const int CaptionLimit = 1024; // жёсткий лимит Telegram на подпись к фото/альбому

    // aiogram User.full_name: "First Last", либо просто "First" без фамилии.
    public static string FullName(User user)
    {
        var last = string.IsNullOrEmpty(user.LastName) ? "" : $" {user.LastName}";
        var full = $"{user.FirstName}{last}";
        return string.IsNullOrEmpty(full) ? "—" : full;
    }

    public static string AuthorLine(User user) =>
        FullName(user) + (string.IsNullOrEmpty(user.Username) ? "" : $" (@{user.Username})");

    // len()/срез строки в Python считают юникодные code points, а не UTF-16
    // code units — некоторые эмодзи в текстах (📁, 👀 и т.п.) вне BMP и
    // занимают 2 code unit в C#. Rune-счёт/срез воспроизводит именно
    // Python-арифметику бюджета подписи, не ломая суррогатные пары посередине.
    private static int CodePointLength(string s) => s.EnumerateRunes().Count();

    private static string TruncateByCodePoints(string s, int maxCodePoints)
    {
        var sb = new StringBuilder();
        var n = 0;
        foreach (var rune in s.EnumerateRunes())
        {
            if (n >= maxCodePoints) break;
            sb.Append(rune.ToString());
            n++;
        }
        return sb.ToString();
    }

    // Единственный рендерер карточки. Весь пользовательский текст экранируется.
    // maxLen — если задан (для caption к фото/альбому), обрезается только
    // описание, чтобы не разрезать HTML-теги в шапке/хвосте карточки.
    public static string RequestCard(
        long? reqId, string caseKey, string description, string? sourcePath,
        string author, string status = "new", int? maxLen = null, string? actorLine = null)
    {
        var caseInfo = Texts.Cases.TryGetValue(caseKey, out var c) ? c : new CaseInfo(caseKey, "", "—");
        var header = reqId is { } id ? $"Заявка №{id}" : "Новая заявка";
        var headLines = new List<string>
        {
            $"<b>{header} · {caseInfo.Title}</b>",
            $"Ориентир по срокам: {caseInfo.Eta}",
            $"От: {WebUtility.HtmlEncode(author)}",
            "",
        };
        var tailLines = new List<string>();
        if (!string.IsNullOrEmpty(sourcePath))
            tailLines.AddRange(new[] { "", $"📁 Исходники: <code>{WebUtility.HtmlEncode(sourcePath)}</code>" });
        tailLines.AddRange(new[] { "", Texts.Statuses.TryGetValue(status, out var st) ? st : status });
        if (!string.IsNullOrEmpty(actorLine))
            tailLines.Add(WebUtility.HtmlEncode(actorLine));

        var desc = WebUtility.HtmlEncode(description);
        if (maxLen is { } max)
        {
            // +2 — переносы строки между head/desc и между desc/tail.
            var fixedLen = CodePointLength(string.Join("\n", headLines)) + CodePointLength(string.Join("\n", tailLines)) + 2;
            var budget = Math.Max(max - fixedLen, 10);
            if (CodePointLength(desc) > budget)
                desc = TruncateByCodePoints(desc, budget - 1).TrimEnd() + "…";
        }

        return string.Join("\n", headLines.Append(desc).Concat(tailLines));
    }

    // Единая точка входа — из кнопки меню, из Mini App, из deep link.
    private static async Task StartRequestAsync(long chatId, long userId, ITelegramBotClient bot, StateStore states, string caseKey)
    {
        states.Clear(chatId, userId);
        states.UpdateData(chatId, userId, "case_key", caseKey);
        states.UpdateData(chatId, userId, "photos", new List<string>());
        states.SetState(chatId, userId, BotState.NewDescription);
        await bot.SendMessage(chatId, Texts.AskDescription(Texts.Cases[caseKey].Title), parseMode: ParseMode.Html);
    }

    // BTN_CAPABILITIES приходит текстом только когда WEBAPP_URL не настроен —
    // тогда показываем выбор задач кнопками, чтобы кнопка не была мёртвой.
    public static async Task ChooseCase(Message message, BotContext ctx)
    {
        ctx.States.Clear(message.Chat.Id, message.From!.Id);
        await ctx.Bot.SendMessage(message.Chat.Id, "Выберите тип задачи:", replyMarkup: Keyboards.CasePicker());
    }

    // Клик по карточке в Mini App: sendData -> {'case': key}.
    public static async Task FromWebApp(Message message, BotContext ctx)
    {
        string? caseKey;
        try
        {
            using var doc = JsonDocument.Parse(message.WebAppData!.Data);
            if (!doc.RootElement.TryGetProperty("case", out var caseProp)) return;
            caseKey = caseProp.GetString();
        }
        catch (JsonException)
        {
            return;
        }
        if (caseKey is null || !Texts.Cases.ContainsKey(caseKey)) return;

        var userId = message.From!.Id;
        using (await ctx.UserLocks.LockAsync(userId))
        {
            var current = ctx.States.GetState(message.Chat.Id, userId);
            var currentData = ctx.States.GetData(message.Chat.Id, userId);
            // Дубль sendData от двойного тапа в Mini App: тот же кейс уже запущен.
            if (current == BotState.NewDescription && currentData.TryGetValue("case_key", out var ck) && (string?)ck == caseKey)
                return;
            await StartRequestAsync(message.Chat.Id, userId, ctx.Bot, ctx.States, caseKey);
        }
    }

    public static async Task CaseChosen(CallbackQuery callback, BotContext ctx)
    {
        var caseKey = callback.Data!.Split(':', 2)[1];
        if (!Texts.Cases.ContainsKey(caseKey))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Неизвестная задача");
            return;
        }
        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        try
        {
            await ctx.Bot.EditMessageReplyMarkup(callback.Message!.Chat.Id, callback.Message.MessageId, replyMarkup: null);
        }
        catch (ApiRequestException) { /* двойной тап или старое сообщение — не критично */ }
        await StartRequestAsync(callback.Message!.Chat.Id, callback.From.Id, ctx.Bot, ctx.States, caseKey);
    }

    public static async Task GotDescription(Message message, BotContext ctx)
    {
        var text = (message.Text ?? "").Trim();
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        if (text.Length == 0)
        {
            await ctx.Bot.SendMessage(chatId, "Описание пустое — напишите пару предложений о задаче.");
            return;
        }
        if (CodePointLength(text) > MaxDescription)
        {
            await ctx.Bot.SendMessage(chatId,
                $"Описание слишком длинное ({CodePointLength(text)} символов, максимум {MaxDescription}). " +
                "Сократите, а детали можно будет добавить в чате с отделом.");
            return;
        }
        ctx.States.UpdateData(chatId, userId, "description", text);
        ctx.States.SetState(chatId, userId, BotState.NewPhotos);
        await ctx.Bot.SendMessage(chatId, Texts.AskPhotos, replyMarkup: Keyboards.PhotosStep());
    }

    public static async Task DescriptionWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Сначала опишите задачу текстом — картинки будут следующим шагом.");

    // Альбом приходит серией почти одновременных сообщений — без лока
    // конкурентные get/update теряют часть фото.
    public static async Task GotPhoto(Message message, BotContext ctx)
    {
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        bool first;
        using (await ctx.UserLocks.LockAsync(userId))
        {
            var data = ctx.States.GetData(chatId, userId);
            var photos = data.TryGetValue("photos", out var p) ? (List<string>)p! : new List<string>();
            photos.Add(message.Photo![^1].FileId);
            ctx.States.UpdateData(chatId, userId, "photos", photos);
            first = photos.Count == 1;
        }
        if (first)
            await ctx.Bot.SendMessage(chatId, "Картинка принята. Ещё — или жмите «Дальше».", replyMarkup: Keyboards.PhotosStep());
    }

    public static async Task PhotosWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Пришлите картинку (фото), или жмите «Дальше» / «Пропустить» под сообщением выше.");

    public static async Task PhotosDone(CallbackQuery callback, BotContext ctx)
    {
        var chatId = callback.Message!.Chat.Id;
        var userId = callback.From.Id;
        if (callback.Data == "photos:skip")
            ctx.States.UpdateData(chatId, userId, "photos", new List<string>());
        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        ctx.States.SetState(chatId, userId, BotState.NewSource);
        await ctx.Bot.SendMessage(chatId, Texts.AskSource, replyMarkup: Keyboards.SourceStep());
    }

    public static async Task GotSource(Message message, BotContext ctx)
    {
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        var text = TruncateByCodePoints((message.Text ?? "").Trim(), MaxSource);
        ctx.States.UpdateData(chatId, userId, "source_path", text.Length == 0 ? null : text);
        await ShowPreviewAsync(chatId, message.From!, ctx);
    }

    public static async Task SourceWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Пришлите путь текстом, или жмите «Пропустить» под сообщением выше.");

    public static async Task SourceSkipped(CallbackQuery callback, BotContext ctx)
    {
        var chatId = callback.Message!.Chat.Id;
        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        ctx.States.UpdateData(chatId, callback.From.Id, "source_path", null);
        await ShowPreviewAsync(chatId, callback.From, ctx);
    }

    private static async Task ShowPreviewAsync(long chatId, User user, BotContext ctx)
    {
        var data = ctx.States.GetData(chatId, user.Id);
        ctx.States.SetState(chatId, user.Id, BotState.NewPreview);
        var caseKey = (string)data["case_key"]!;
        var description = (string)data["description"]!;
        var sourcePath = data.TryGetValue("source_path", out var sp) ? (string?)sp : null;
        var card = RequestCard(null, caseKey, description, sourcePath, AuthorLine(user));
        var photos = data.TryGetValue("photos", out var p) ? (List<string>)p! : new List<string>();
        var note = photos.Count > 0 ? $"\n\n🖼 Картинок: {photos.Count}" : "";
        await ctx.Bot.SendMessage(chatId, $"{Texts.PreviewHeader}\n\n{card}{note}", parseMode: ParseMode.Html, replyMarkup: Keyboards.PreviewStep());
    }

    public static async Task CancelRequest(CallbackQuery callback, BotContext ctx)
    {
        var chatId = callback.Message!.Chat.Id;
        ctx.States.Clear(chatId, callback.From.Id);
        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        try
        {
            await ctx.Bot.EditMessageReplyMarkup(chatId, callback.Message.MessageId, replyMarkup: null);
        }
        catch (ApiRequestException) { }
        await ctx.Bot.SendMessage(chatId, Texts.Canceled);
    }

    public static async Task SendRequest(CallbackQuery callback, BotContext ctx)
    {
        var user = callback.From;
        var chatId = callback.Message!.Chat.Id;

        Dictionary<string, object?>? data = null;
        // Лок + очистка состояния внутри лока: двойной тап по «Отправить»
        // не создаст дубль — второй колбэк увидит пустые данные.
        using (await ctx.UserLocks.LockAsync(user.Id))
        {
            var current = ctx.States.GetData(chatId, user.Id);
            if (!current.ContainsKey("case_key"))
            {
                await ctx.Bot.AnswerCallbackQuery(callback.Id, "Заявка уже отправлена");
                return;
            }
            data = new Dictionary<string, object?>(current);
            ctx.States.Clear(chatId, user.Id);
        }

        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        try
        {
            await ctx.Bot.EditMessageReplyMarkup(chatId, callback.Message.MessageId, replyMarkup: null);
        }
        catch (ApiRequestException) { }

        var author = AuthorLine(user);
        var caseKey = (string)data["case_key"]!;
        var description = (string)data["description"]!;
        var sourcePath = data.TryGetValue("source_path", out var sp) ? (string?)sp : null;
        var photos = data.TryGetValue("photos", out var p) ? (List<string>)p! : new List<string>();

        var reqId = await Db.CreateRequestAsync(user.Id, user.Username, FullName(user), caseKey, description, photos, sourcePath);

        if (Config.Instance.DeptChatId is not { } deptChatId)
        {
            await ctx.Bot.SendMessage(chatId, Texts.SentNoDept(reqId));
            return;
        }

        var buttons = Keyboards.DeptStatusButtons(reqId);
        int? threadId = (int?)Config.Instance.DeptThreadId;

        Message dept_msg;
        try
        {
            if (photos.Count == 0)
            {
                var card = RequestCard(reqId, caseKey, description, sourcePath, author);
                dept_msg = await ctx.Bot.SendMessage(deptChatId, card, parseMode: ParseMode.Html, replyMarkup: buttons, messageThreadId: threadId);
            }
            else if (photos.Count == 1)
            {
                var caption = RequestCard(reqId, caseKey, description, sourcePath, author, maxLen: CaptionLimit);
                dept_msg = await ctx.Bot.SendPhoto(deptChatId, InputFile.FromFileId(photos[0]), caption: caption,
                    parseMode: ParseMode.Html, replyMarkup: buttons, messageThreadId: threadId);
            }
            else
            {
                // 2+ фото: Telegram не разрешает кнопки на альбоме. Текст — подписью
                // к первому фото альбома, кнопки — короткой строкой статуса следом.
                var caption = RequestCard(reqId, caseKey, description, sourcePath, author, maxLen: CaptionLimit);
                var media = new List<IAlbumInputMedia>
                {
                    new InputMediaPhoto(InputFile.FromFileId(photos[0])) { Caption = caption, ParseMode = ParseMode.Html },
                };
                foreach (var fid in photos.Skip(1).Take(9))
                    media.Add(new InputMediaPhoto(InputFile.FromFileId(fid)));

                var albumMsgs = await ctx.Bot.SendMediaGroup(deptChatId, media, messageThreadId: threadId);
                var caseTitle = Texts.Cases[caseKey].Title;
                var shortText = $"Заявка №{reqId} · {caseTitle}\n{Texts.Statuses["new"]}";
                dept_msg = await ctx.Bot.SendMessage(deptChatId, shortText, replyMarkup: buttons,
                    replyParameters: new ReplyParameters { MessageId = albumMsgs[0].MessageId },
                    messageThreadId: threadId);
            }
        }
        catch (Exception ex)
        {
            // Заявка уже в БД (reqId) — не теряем её молча, а честно говорим пользователю.
            Log.Error($"Заявка №{reqId} сохранена, но не доставлена в чат отдела: {ex}");
            await ctx.Bot.SendMessage(chatId, Texts.SentDeptFailed(reqId));
            return;
        }

        // Отдельно от отправки: карточка в чат отдела УЖЕ ушла и рабочая — если
        // этот чисто вспомогательный write в БД упадёт, заявителю нельзя врать
        // про SentDeptFailed (ложная тревога, дубль заявки).
        try
        {
            await Db.SetDeptMessageIdAsync(reqId, dept_msg.MessageId);
        }
        catch (Exception ex)
        {
            Log.Warning($"Заявка №{reqId}: карточка доставлена, но dept_message_id не сохранён: {ex}");
        }

        await ctx.Bot.SendMessage(chatId, Texts.SentOk(reqId));
    }
}
