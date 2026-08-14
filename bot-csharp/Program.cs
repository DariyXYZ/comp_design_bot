using CompDesignBot;
using CompDesignBot.Handlers;
using Telegram.Bot;
using Telegram.Bot.Polling;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

// Порт main.py: инициализация, регистрация команд, long polling.
// Порядок проверок в HandleMessageAsync/HandleCallbackAsync — точная копия
// порядка роутеров/хендлеров aiogram (see handlers/__init__.py register_all):
// start раньше create/feedback/dept, иначе кнопки меню посреди
// заявки/отзыва улетают в текст-ловушку чужого FSM-состояния.

Config.Load(Directory.GetCurrentDirectory());
await Db.InitDbAsync();

var bot = new TelegramBotClient(Config.Instance.Token);
await bot.SetMyCommands(
    new[]
    {
        new BotCommand { Command = "start", Description = "Главное меню" },
        new BotCommand { Command = "new", Description = "Создать заявку" },
        new BotCommand { Command = "my", Description = "Мои заявки" },
        new BotCommand { Command = "info", Description = "Как это работает" },
    },
    scope: new BotCommandScopeAllPrivateChats());

var ctx = new BotContext(bot, new StateStore(), new KeyedAsyncLock(), new KeyedAsyncLock());

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

Log.Info("comp_design_bot (C#) запущен (polling)");
try
{
    await bot.ReceiveAsync(
        updateHandler: (client, update, token) => HandleUpdateAsync(update, ctx),
        errorHandler: (client, ex, token) =>
        {
            Log.Error($"Ошибка polling: {ex}");
            return Task.CompletedTask;
        },
        receiverOptions: new ReceiverOptions
        {
            AllowedUpdates = new[] { UpdateType.Message, UpdateType.CallbackQuery },
        },
        cancellationToken: cts.Token);
}
catch (OperationCanceledException)
{
    Log.Info("comp_design_bot (C#) остановлен");
}

static bool IsCommand(Message m, string cmd)
{
    var text = m.Text;
    if (string.IsNullOrEmpty(text) || text[0] != '/') return false;
    var firstToken = text.Split(new[] { ' ', '\n' }, 2)[0][1..];
    var atIdx = firstToken.IndexOf('@');
    if (atIdx >= 0) firstToken = firstToken[..atIdx];
    return string.Equals(firstToken, cmd, StringComparison.Ordinal);
}

static bool IsPrivate(Message m) => m.Chat.Type == ChatType.Private;

async Task HandleUpdateAsync(Update update, BotContext ctx)
{
    try
    {
        if (update.Message is { } message)
            await HandleMessageAsync(message, ctx);
        else if (update.CallbackQuery is { } callback)
            await HandleCallbackAsync(callback, ctx);
    }
    catch (Exception ex)
    {
        // main.py: @dp.errors() — необработанная ошибка в хендлере логируется,
        // но не убивает обработку следующих обновлений.
        Log.Error($"Необработанная ошибка в хендлере: {ex}");
    }
}

async Task HandleMessageAsync(Message message, BotContext ctx)
{
    if (message.From is null) return; // сервисные сообщения без автора не обрабатываем
    var chatId = message.Chat.Id;
    var userId = message.From.Id;
    var state = ctx.States.GetState(chatId, userId);

    // --- start.py ---
    if (IsCommand(message, "start") && IsPrivate(message)) { await StartHandler.CmdStart(message, ctx); return; }
    if (IsCommand(message, "id")) { await StartHandler.CmdId(message, ctx); return; }
    if ((IsCommand(message, "info") || message.Text == Keyboards.BtnInfo) && IsPrivate(message))
    { await StartHandler.ShowInfo(message, ctx); return; }
    if ((IsCommand(message, "my") || message.Text == Keyboards.BtnMy) && IsPrivate(message))
    { await StartHandler.MyRequests(message, ctx); return; }

    // --- create.py ---
    if ((IsCommand(message, "new") || message.Text == Keyboards.BtnCreate || message.Text == Keyboards.BtnCapabilities) && IsPrivate(message))
    { await CreateHandler.ChooseCase(message, ctx); return; }
    if (message.WebAppData is not null && IsPrivate(message)) { await CreateHandler.FromWebApp(message, ctx); return; }

    if (state == BotState.NewDescription)
    {
        if (message.Text is not null) await CreateHandler.GotDescription(message, ctx);
        else await CreateHandler.DescriptionWrongType(message, ctx);
        return;
    }
    if (state == BotState.NewPhotos)
    {
        if (message.Photo is not null) await CreateHandler.GotPhoto(message, ctx);
        else await CreateHandler.PhotosWrongType(message, ctx);
        return;
    }
    if (state == BotState.NewSource)
    {
        if (message.Text is not null) await CreateHandler.GotSource(message, ctx);
        else await CreateHandler.SourceWrongType(message, ctx);
        return;
    }

    // --- feedback.py ---
    if (state == BotState.FeedbackText)
    {
        if (message.Text is not null) await FeedbackHandler.CaptureFeedbackComment(message, ctx);
        else await FeedbackHandler.FeedbackCommentWrongType(message, ctx);
        return;
    }

    // --- dept.py ---
    if (state == BotState.DeptContact)
    {
        if (message.Text is not null) await DeptHandler.CaptureActorContact(message, ctx);
        else await DeptHandler.ActorContactWrongType(message, ctx);
        return;
    }
    if (state == BotState.DeptReason)
    {
        if (message.Text is not null) await DeptHandler.CaptureRejectionReason(message, ctx);
        else await DeptHandler.RejectionReasonWrongType(message, ctx);
        return;
    }

    // Ничего не подошло — как и в Python-версии, бот молчит.
}

async Task HandleCallbackAsync(CallbackQuery callback, BotContext ctx)
{
    if (callback.Message is null)
    {
        await ctx.Bot.AnswerCallbackQuery(callback.Id);
        return;
    }
    var data = callback.Data ?? "";
    var chatId = callback.Message.Chat.Id;
    var userId = callback.From.Id;
    var state = ctx.States.GetState(chatId, userId);

    // --- create.py ---
    if (data.StartsWith("case:", StringComparison.Ordinal)) { await CreateHandler.CaseChosen(callback, ctx); return; }
    if (state == BotState.NewPhotos && (data == "photos:done" || data == "photos:skip"))
    { await CreateHandler.PhotosDone(callback, ctx); return; }
    if (state == BotState.NewSource && data == "source:skip") { await CreateHandler.SourceSkipped(callback, ctx); return; }
    if (data == "req:cancel") { await CreateHandler.CancelRequest(callback, ctx); return; }
    if (state == BotState.NewPreview && data == "req:send") { await CreateHandler.SendRequest(callback, ctx); return; }

    // --- feedback.py ---
    if (data.StartsWith("fb:", StringComparison.Ordinal)) { await FeedbackHandler.RateRequest(callback, ctx); return; }

    // --- dept.py ---
    if (data.StartsWith("st:", StringComparison.Ordinal)) { await DeptHandler.ChangeStatus(callback, ctx); return; }

    // main.py fallback: колбэк не совпал ни с одним хендлером — в основном
    // кнопки «Дальше»/«Отправить» из черновиков, умерших при рестарте бота.
    await ctx.Bot.AnswerCallbackQuery(callback.Id);
    await ctx.Bot.SendMessage(chatId, Texts.SessionReset);
}
