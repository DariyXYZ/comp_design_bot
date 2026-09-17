using System.Text.Json;
using CompDesignBot.Channels.Telegram;
using CompDesignBot.Features.Requests;
using CompDesignBot.Tests.Fakes;
using Microsoft.Extensions.DependencyInjection;
using Telegram.Bot;
using Telegram.Bot.Requests;
using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Tests;

/// <summary>Сквозные сценарии бота: обновление → диспетчер → обработчики → сервис заявок → фейковые Telegram и Pyrus.</summary>
public sealed class BotFlowTests : IDisposable
{
    private const long UserId = 77;
    private const long DeptUserId = 1001;
    private static int _updateId = 1;

    private readonly AppFactory _app = new();

    public BotFlowTests()
    {
        // Поднимаем хост (иначе DI не создан), но сам HTTP здесь не нужен.
        _ = _app.Server;
        _app.Bot.Requests.Clear();
    }

    public void Dispose() => _app.Dispose();

    private static Update Parse(string json) => JsonSerializer.Deserialize<Update>(json, JsonBotAPI.Options)!;

    private static string UserJson(long id, string first, string? username) =>
        $$$$"""{"id":{{{{id}}}},"is_bot":false,"first_name":"{{{{first}}}}","last_name":"Петров"{{{{(username is null ? "" : $",\"username\":\"{username}\"")}}}}}""";

    private static Update PrivateText(string text, long userId = UserId) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{userId}}}},"type":"private"},"from":{{{{UserJson(userId, "Иван", "ivan")}}}},"text":{{{{JsonSerializer.Serialize(text)}}}}}}
        """);

    private static Update Callback(string data, long chatId, string chatType, string messageText, long fromId = UserId, string? fromUsername = "ivan", bool photo = false, bool replyTo = false) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"callback_query":{"id":"cb{{{{_updateId}}}}","chat_instance":"1","from":{{{{UserJson(fromId, fromId == UserId ? "Иван" : "Пётр", fromUsername)}}}},"data":{{{{JsonSerializer.Serialize(data)}}}},
          "message":{"message_id":500,"date":0,"chat":{"id":{{{{chatId}}}},"type":"{{{{chatType}}}}"},
            {{{{(photo ? "\"caption\"" : "\"text\"")}}}}:{{{{JsonSerializer.Serialize(messageText)}}}}
            {{{{(photo ? ",\"photo\":[{\"file_id\":\"p\",\"file_unique_id\":\"p\",\"width\":1,\"height\":1}]" : "")}}}}
            {{{{(replyTo ? ReplyStub(chatId) : "")}}}}
          }}}
        """);

    private static string ReplyStub(long chatId) =>
        ",\"reply_to_message\":{\"message_id\":499,\"date\":0,\"chat\":{\"id\":" + chatId + ",\"type\":\"supergroup\"}}";

    private static Update DeptText(string text, long fromId = DeptUserId) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{AppFactory.DeptChatId}}}},"type":"supergroup"},"from":{{{{UserJson(fromId, "Пётр", "petr")}}}},"text":{{{{JsonSerializer.Serialize(text)}}}},"message_thread_id":{{{{AppFactory.DeptThreadId}}}},"is_topic_message":true}}
        """);

    private SendMessageRequest LastMessage() => _app.Bot.Sent<SendMessageRequest>().Last();

    private BotState State(long chatId = UserId, long userId = UserId) =>
        _app.Services.GetRequiredService<StateStore>().GetState(chatId, userId);

    private FakePyrusClient.FakeTask SeedRequest(string status = BoardStatus.New) => _app.Pyrus.Seed(t =>
    {
        t[Field.TelegramId] = UserId.ToString();
        t[Field.Topic] = "Тема";
        t[Field.Description] = "Суть";
        t[Field.Author] = "Иван Петров (@ivan)";
        t[Field.Status] = status;
    });

    [Fact]
    public async Task Start_sends_welcome_photo_with_app_button()
    {
        await _app.DeliverAsync(PrivateText("/start"));

        var photo = Assert.Single(_app.Bot.Sent<SendPhotoRequest>());
        Assert.Equal(Texts.Welcome, photo.Caption);
        var markup = Assert.IsType<InlineKeyboardMarkup>(photo.ReplyMarkup);
        var button = markup.InlineKeyboard.First().First();
        Assert.Equal(Keyboards.BtnApp, button.Text);
        // В адресе нет ни кода входа, ни имени: вход по initData.
        Assert.Equal("https://bot.example.test/", button.WebApp!.Url);

        // Второй /start шлёт по file_id, а не файлом.
        await _app.DeliverAsync(PrivateText("/start"));
        Assert.Equal("welcome-file-id", Assert.IsType<InputFileId>(_app.Bot.Sent<SendPhotoRequest>().Last().Photo).Id);
    }

    [Fact]
    public async Task Any_private_text_points_to_the_app()
    {
        await _app.DeliverAsync(PrivateText("☰ Мои заявки"));
        Assert.Equal(Texts.UseApp, LastMessage().Text);
        Assert.IsType<InlineKeyboardMarkup>(LastMessage().ReplyMarkup);
        Assert.Empty(_app.Pyrus.Tasks);
    }

    [Fact]
    public async Task Stale_dialog_button_points_to_the_app()
    {
        await _app.DeliverAsync(Callback("photos:done", UserId, "private", "старое"));
        Assert.Equal(Texts.StaleButton, LastMessage().Text);
    }

    [Fact]
    public async Task Status_buttons_move_board_and_notify_author_and_watchers()
    {
        var task = SeedRequest();
        task.Comments.Add(new() { Text = "Подписка: tg:555 Наблюдатель" });
        var cardText = RequestCard.Render(task.Id, "Тема", "Суть", null, "Иван Петров (@ivan)");

        // Не из чата отдела — отказ.
        await _app.DeliverAsync(Callback($"st:{task.Id}:accepted", 12345, "supergroup", cardText));
        Assert.Contains(_app.Bot.Sent<AnswerCallbackQueryRequest>(), a => a.Text == "Статусы меняются только в чате отдела");
        Assert.Empty(_app.Pyrus.Comments);

        await _app.DeliverAsync(Callback($"st:{task.Id}:accepted", AppFactory.DeptChatId, "supergroup", cardText, fromId: DeptUserId, fromUsername: null));
        Assert.Equal(BoardStatus.Work, task[Field.Status]);
        Assert.False(task.Closed);
        Assert.Equal("Принял в работу: Пётр Петров", _app.Pyrus.Comments.Last().Request.Text);

        var edited = Assert.Single(_app.Bot.Sent<EditMessageTextRequest>());
        Assert.Contains("👀 Принята\nПринял: Пётр Петров", edited.Text);

        var toAuthor = _app.Bot.Sent<SendMessageRequest>().Single(m => m.ChatId.Identifier == UserId);
        Assert.Contains("👀 Принята", toAuthor.Text);
        Assert.Contains("<a href=\"tg://user?id=1001\">Пётр Петров</a>", toAuthor.Text);
        var toWatcher = _app.Bot.Sent<SendMessageRequest>().Single(m => m.ChatId.Identifier == 555);
        Assert.StartsWith($"Задача №{task.Id} («Тема»), за которой вы следите:", toWatcher.Text);

        // «Готово» закрывает и просит оценку.
        _app.Bot.Requests.Clear();
        await _app.DeliverAsync(Callback($"st:{task.Id}:done", AppFactory.DeptChatId, "supergroup", edited.Text!, fromId: DeptUserId, fromUsername: "petr"));
        Assert.True(task.Closed);
        Assert.Equal(BoardStatus.Done, task[Field.Status]);
        var done = _app.Bot.Sent<SendMessageRequest>().Single(m => m.ChatId.Identifier == UserId);
        Assert.Contains("Для связи и передачи решения: @petr", done.Text);
        var feedback = Assert.IsType<InlineKeyboardMarkup>(done.ReplyMarkup);
        Assert.Equal($"fb:{task.Id}:up", feedback.InlineKeyboard.First().First().CallbackData);

        // Оценка от автора уходит в задачу и в чат отдела.
        _app.Bot.Requests.Clear();
        await _app.DeliverAsync(Callback($"fb:{task.Id}:down", UserId, "private", done.Text));
        Assert.Equal("Оценка заявителя: 👎", _app.Pyrus.Comments.Last().Request.Text);
        Assert.Equal(BotState.FeedbackText, State());
        Assert.Contains(_app.Bot.Sent<SendMessageRequest>(), m => m.ChatId.Identifier == AppFactory.DeptChatId && m.Text.Contains("Обратная связь: 👎"));
        await _app.DeliverAsync(PrivateText("Долго"));
        Assert.Equal("Отзыв заявителя: Долго", _app.Pyrus.Comments.Last().Request.Text);
        Assert.Equal(BotState.None, State());

        // Чужой не может оценить.
        var before = _app.Pyrus.Comments.Count;
        await _app.DeliverAsync(Callback($"fb:{task.Id}:up", 999, "private", done.Text, fromId: 999));
        Assert.Equal(before, _app.Pyrus.Comments.Count);

        // Повторный клик по тому же статусу не трогает Pyrus.
        await _app.DeliverAsync(Callback($"st:{task.Id}:done", AppFactory.DeptChatId, "supergroup", "…\n✅ Готово", fromId: DeptUserId));
        Assert.Equal(before, _app.Pyrus.Comments.Count);
    }

    [Fact]
    public async Task Rejection_asks_reason_and_forwards_it()
    {
        var task = SeedRequest(BoardStatus.Work);
        await _app.DeliverAsync(Callback($"st:{task.Id}:rejected", AppFactory.DeptChatId, "supergroup", "…\n⚙️ В работе", fromId: DeptUserId));
        Assert.True(task.Closed);
        Assert.Equal(BoardStatus.Rejected, task[Field.Status]);
        Assert.Equal(BotState.DeptReason, State(AppFactory.DeptChatId, DeptUserId));
        Assert.Contains(_app.Bot.Sent<SendMessageRequest>(), m => m.Text == Texts.AskRejectionReason(task.Id));

        await _app.DeliverAsync(DeptText("Нет исходников"));
        Assert.Equal("Причина отклонения: Нет исходников", _app.Pyrus.Comments.Last().Request.Text);
        Assert.Equal(BotState.None, State(AppFactory.DeptChatId, DeptUserId));
        var toAuthor = _app.Bot.Sent<SendMessageRequest>().Last(m => m.ChatId.Identifier == UserId);
        Assert.Equal($"Причина отклонения заявки №{task.Id}:\nНет исходников", toAuthor.Text);
    }

    [Fact]
    public async Task Clarify_asks_question_and_sends_app_button()
    {
        var task = SeedRequest(BoardStatus.Work);
        await _app.DeliverAsync(Callback($"st:{task.Id}:clarify", AppFactory.DeptChatId, "supergroup", "…\n⚙️ В работе", fromId: DeptUserId));
        Assert.Equal(BoardStatus.Clarify, task[Field.Status]);
        Assert.Equal(BotState.DeptQuestion, State(AppFactory.DeptChatId, DeptUserId));

        await _app.DeliverAsync(DeptText("Какой файл?"));
        Assert.Equal("Вопрос заявителю: Какой файл?", _app.Pyrus.Comments.Last().Request.Text);
        var toAuthor = _app.Bot.Sent<SendMessageRequest>().Last(m => m.ChatId.Identifier == UserId);
        Assert.Contains("Какой файл?", toAuthor.Text);
        var markup = Assert.IsType<InlineKeyboardMarkup>(toAuthor.ReplyMarkup);
        Assert.Equal(Keyboards.BtnApp, markup.InlineKeyboard.First().First().Text);
    }

    [Fact]
    public async Task Legacy_album_card_edits_short_line_under_album()
    {
        var task = SeedRequest();
        var shortLine = RequestCard.ShortLine(task.Id, "Тема", ChatStatus.New);
        await _app.DeliverAsync(Callback($"st:{task.Id}:in_progress", AppFactory.DeptChatId, "supergroup", shortLine, fromId: DeptUserId, replyTo: true));
        var edited = Assert.Single(_app.Bot.Sent<EditMessageTextRequest>());
        Assert.Equal($"Заявка №{task.Id} · Тема\n⚙️ В работе", edited.Text);
    }

    [Fact]
    public async Task Legacy_photo_card_edits_caption()
    {
        var task = SeedRequest();
        await _app.DeliverAsync(Callback($"st:{task.Id}:in_progress", AppFactory.DeptChatId, "supergroup", "…\n⏸️ На паузе", fromId: DeptUserId, photo: true));
        var edited = Assert.Single(_app.Bot.Sent<EditMessageCaptionRequest>());
        Assert.Contains("⚙️ В работе", edited.Caption);
    }
}
