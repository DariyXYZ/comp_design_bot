using System.Text.Json;
using CompDesignBot.Features.Bot;
using CompDesignBot.Features.Requests;
using CompDesignBot.Tests.Fakes;
using Microsoft.Extensions.DependencyInjection;
using Telegram.Bot;
using Telegram.Bot.Requests;
using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace CompDesignBot.Tests;

/// <summary>Сквозные сценарии бота: обновление → диспетчер → обработчики → фейковые Telegram и Pyrus.</summary>
public sealed class BotFlowTests : IDisposable
{
    private const long UserId = 77;
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

    private static string UserJson(long id = UserId, string first = "Иван", string? username = "ivan") =>
        $$$$"""{"id":{{{{id}}}},"is_bot":false,"first_name":"{{{{first}}}}","last_name":"Петров"{{{{(username is null ? "" : $",\"username\":\"{username}\"")}}}}}""";

    private static Update PrivateText(string text, long userId = UserId) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{userId}}}},"type":"private"},"from":{{{{UserJson(userId)}}}},"text":{{{{JsonSerializer.Serialize(text)}}}}}}
        """);

    private static Update PrivatePhoto(string fileId) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{UserId}}}},"type":"private"},"from":{{{{UserJson()}}}},"photo":[{"file_id":"small","file_unique_id":"s","width":1,"height":1},{"file_id":"{{{{fileId}}}}","file_unique_id":"b","width":2,"height":2}]}}
        """);

    private static Update WebAppData(object payload) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{UserId}}}},"type":"private"},"from":{{{{UserJson()}}}},"web_app_data":{"data":{{{{JsonSerializer.Serialize(JsonSerializer.Serialize(payload))}}}},"button_text":"✦"}}}
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

    private static Update DeptText(string text, long fromId = 1001) => Parse($$$$"""
        {"update_id":{{{{_updateId++}}}},"message":{"message_id":{{{{_updateId}}}},"date":0,"chat":{"id":{{{{AppFactory.DeptChatId}}}},"type":"supergroup"},"from":{{{{UserJson(fromId, "Пётр", "petr")}}}},"text":{{{{JsonSerializer.Serialize(text)}}}},"message_thread_id":{{{{AppFactory.DeptThreadId}}}},"is_topic_message":true}}
        """);

    private SendMessageRequest LastMessage() => _app.Bot.Sent<SendMessageRequest>().Last();

    private BotState State(long chatId = UserId, long userId = UserId) =>
        _app.Services.GetRequiredService<StateStore>().GetState(chatId, userId);

    [Fact]
    public async Task Start_sends_welcome_photo_with_login_button()
    {
        await _app.DeliverAsync(PrivateText("/start"));

        var photo = Assert.Single(_app.Bot.Sent<SendPhotoRequest>());
        Assert.Equal(Texts.Welcome, photo.Caption);
        var menu = Assert.IsType<ReplyKeyboardMarkup>(photo.ReplyMarkup);
        var button = menu.Keyboard.First().First();
        Assert.Equal(Keyboards.BtnCapabilities, button.Text);
        var url = new Uri(button.WebApp!.Url);
        var query = System.Web.HttpUtility.ParseQueryString(url.Query);
        Assert.Equal("Иван Петров", query["u"]);
        Assert.Equal("ivan", query["h"]);
        Assert.Equal(UserId, _app.Tokens.ReadLoginCode(query["c"]!).Id);

        // Второй /start шлёт по file_id, а не файлом.
        await _app.DeliverAsync(PrivateText("/start"));
        var second = _app.Bot.Sent<SendPhotoRequest>().Last();
        Assert.Equal("welcome-file-id", Assert.IsType<InputFileId>(second.Photo).Id);
    }

    [Fact]
    public async Task Mini_app_request_with_photos_goes_straight_to_preview_and_dept()
    {
        await _app.DeliverAsync(WebAppData(new
        {
            @case = "curved",
            description = "Фасад с кривизной",
            project = "1-19-2026 БЦ",
            project_id = "1",
            origin = "Модуль X",
            origin_path = @"X:\Library\x",
            deadline = "2026-10-01",
            expected = "Скрипт",
            photos = "g1,g2",
        }));

        Assert.Equal(BotState.NewPreview, State());
        var preview = LastMessage();
        Assert.StartsWith(Texts.PreviewHeader, preview.Text);
        Assert.Contains("Новая заявка · Форма здания криволинейная", preview.Text);
        Assert.Contains("🖼 Картинок: 2", preview.Text);

        await _app.DeliverAsync(Callback("req:send", UserId, "private", preview.Text!));

        var task = Assert.Single(_app.Pyrus.Tasks.Values);
        Assert.Equal("Форма здания криволинейная", task[Field.Topic]);
        Assert.Equal("Проект: 1-19-2026 БЦ\nОснова: Модуль X\nСрок: 2026-10-01\nКартинки: 2 — приложены в задаче Pyrus\n\nФасад с кривизной", task[Field.Description]);
        Assert.Equal("Скрипт", task[Field.Expected]);
        Assert.Equal(@"X:\Library\x", task[Field.Source]);
        Assert.Equal("77", task[Field.TelegramId]);
        Assert.Equal("Иван Петров (@ivan)", task[Field.Author]);
        Assert.Equal(BoardStatus.New, task[Field.Status]);

        var attach = _app.Pyrus.Comments.Single(c => c.Request.AttachmentGuids is not null);
        Assert.Equal(["g1", "g2"], attach.Request.AttachmentGuids!);

        var card = _app.Bot.Sent<SendMessageRequest>().Single(m => m.ChatId.Identifier == AppFactory.DeptChatId);
        Assert.Contains($"Заявка №{task.Id}</a> · Форма здания криволинейная", card.Text);
        Assert.Contains("🎯 Ожидаемый результат: Скрипт", card.Text);
        var buttons = Assert.IsType<InlineKeyboardMarkup>(card.ReplyMarkup);
        Assert.Equal($"st:{task.Id}:new", buttons.InlineKeyboard.First().First().CallbackData);
        Assert.Equal(AppFactory.DeptThreadId, card.MessageThreadId);

        Assert.NotNull(task[Field.ChatMessage]);
        Assert.Equal(Texts.SentOk(task.Id), LastMessage().Text);
        Assert.Equal(BotState.None, State());
    }

    [Fact]
    public async Task Chat_dialog_collects_description_photo_source_and_uploads_photo()
    {
        await _app.DeliverAsync(WebAppData(new { @case = "revit" }));
        Assert.Equal(BotState.NewDescription, State());
        Assert.Contains("Rhino/Grasshopper файл?", LastMessage().Text);

        await _app.DeliverAsync(PrivateText("Передать башню в Revit"));
        Assert.Equal(BotState.NewPhotos, State());
        Assert.Equal(Texts.AskPhotos, LastMessage().Text);

        await _app.DeliverAsync(PrivatePhoto("big-1"));
        Assert.Equal(Texts.PhotoAccepted, LastMessage().Text);

        await _app.DeliverAsync(Callback("photos:done", UserId, "private", Texts.AskPhotos));
        Assert.Equal(BotState.NewSource, State());

        await _app.DeliverAsync(PrivateText(@"X:\proj"));
        Assert.Equal(BotState.NewPreview, State());

        await _app.DeliverAsync(Callback("req:send", UserId, "private", LastMessage().Text!));

        var task = Assert.Single(_app.Pyrus.Tasks.Values);
        Assert.Equal("Передать башню в Revit", task[Field.Description]);
        Assert.Equal(@"X:\proj", task[Field.Source]);
        Assert.Equal(["photo-1.jpg"], _app.Pyrus.Uploaded);

        var photo = _app.Bot.Sent<SendPhotoRequest>().Single(p => p.ChatId.Identifier == AppFactory.DeptChatId);
        Assert.Equal("big-1", Assert.IsType<InputFileId>(photo.Photo).Id);
        Assert.Contains("📁 Исходники: <code>X:\\proj</code>", photo.Caption);
        Assert.IsType<InlineKeyboardMarkup>(photo.ReplyMarkup);
    }

    [Fact]
    public async Task Menu_button_interrupts_draft()
    {
        await _app.DeliverAsync(WebAppData(new { @case = "unique" }));
        await _app.DeliverAsync(PrivateText(Keyboards.BtnMy));
        Assert.Equal(BotState.None, State());
        Assert.Equal(Texts.NoRequests, LastMessage().Text);
        Assert.IsType<ReplyKeyboardMarkup>(LastMessage().ReplyMarkup);
    }

    [Fact]
    public async Task Stale_callback_explains_session_reset()
    {
        await _app.DeliverAsync(Callback("photos:done", UserId, "private", "старое"));
        Assert.Equal(Texts.SessionReset, LastMessage().Text);
    }

    [Fact]
    public async Task Status_buttons_move_board_and_notify_author_and_watchers()
    {
        var task = _app.Pyrus.Seed(t =>
        {
            t[Field.TelegramId] = UserId.ToString();
            t[Field.Topic] = "Тема";
            t[Field.Description] = "Суть";
            t[Field.Author] = "Иван Петров (@ivan)";
            t[Field.Status] = BoardStatus.New;
            t.Comments.Add(new() { Text = "Подписка: tg:555 Наблюдатель" });
        });
        var cardText = RequestCard.Render(task.Id, "Тема", "Суть", null, "Иван Петров (@ivan)");

        // Не из чата отдела — отказ.
        await _app.DeliverAsync(Callback($"st:{task.Id}:accepted", 12345, "supergroup", cardText));
        Assert.Contains(_app.Bot.Sent<AnswerCallbackQueryRequest>(), a => a.Text == "Статусы меняются только в чате отдела");
        Assert.Empty(_app.Pyrus.Comments);

        await _app.DeliverAsync(Callback($"st:{task.Id}:accepted", AppFactory.DeptChatId, "supergroup", cardText, fromId: 1001, fromUsername: null));
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
        await _app.DeliverAsync(Callback($"st:{task.Id}:done", AppFactory.DeptChatId, "supergroup", edited.Text!, fromId: 1001, fromUsername: "petr"));
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

        // Повторный клик по тому же статусу не трогает Pyrus.
        var before = _app.Pyrus.Comments.Count;
        await _app.DeliverAsync(Callback($"st:{task.Id}:done", AppFactory.DeptChatId, "supergroup", "…\n✅ Готово", fromId: 1001));
        Assert.Equal(before, _app.Pyrus.Comments.Count);
    }

    [Fact]
    public async Task Rejection_asks_reason_and_forwards_it()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = UserId.ToString(); t[Field.Topic] = "Тема"; t[Field.Status] = BoardStatus.Work; });
        await _app.DeliverAsync(Callback($"st:{task.Id}:rejected", AppFactory.DeptChatId, "supergroup", "…\n⚙️ В работе", fromId: 1001));
        Assert.True(task.Closed);
        Assert.Equal(BoardStatus.Rejected, task[Field.Status]);
        Assert.Equal(BotState.DeptReason, State(AppFactory.DeptChatId, 1001));
        Assert.Contains(_app.Bot.Sent<SendMessageRequest>(), m => m.Text == Texts.AskRejectionReason(task.Id));

        await _app.DeliverAsync(DeptText("Нет исходников"));
        Assert.Equal("Причина отклонения: Нет исходников", _app.Pyrus.Comments.Last().Request.Text);
        Assert.Equal(BotState.None, State(AppFactory.DeptChatId, 1001));
        var toAuthor = _app.Bot.Sent<SendMessageRequest>().Last(m => m.ChatId.Identifier == UserId);
        Assert.Equal(Texts.RejectionReasonNotify(task.Id, "Нет исходников"), toAuthor.Text);
    }

    [Fact]
    public async Task Clarify_asks_question_and_sends_app_button()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = UserId.ToString(); t[Field.Topic] = "Тема"; t[Field.Author] = "Иван"; t[Field.Status] = BoardStatus.Work; });
        await _app.DeliverAsync(Callback($"st:{task.Id}:clarify", AppFactory.DeptChatId, "supergroup", "…\n⚙️ В работе", fromId: 1001));
        Assert.Equal(BoardStatus.Clarify, task[Field.Status]);
        Assert.Equal(BotState.DeptQuestion, State(AppFactory.DeptChatId, 1001));

        await _app.DeliverAsync(DeptText("Какой файл?"));
        Assert.Equal("Вопрос заявителю: Какой файл?", _app.Pyrus.Comments.Last().Request.Text);
        var toAuthor = _app.Bot.Sent<SendMessageRequest>().Last(m => m.ChatId.Identifier == UserId);
        Assert.Contains("Какой файл?", toAuthor.Text);
        var markup = Assert.IsType<InlineKeyboardMarkup>(toAuthor.ReplyMarkup);
        Assert.Contains("c=", markup.InlineKeyboard.First().First().WebApp!.Url);
    }

    [Fact]
    public async Task Album_card_edits_short_line_under_album()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = UserId.ToString(); t[Field.Topic] = "Тема"; t[Field.Status] = BoardStatus.New; });
        var shortLine = RequestCard.ShortLine(task.Id, "Тема", ChatStatus.New);
        await _app.DeliverAsync(Callback($"st:{task.Id}:in_progress", AppFactory.DeptChatId, "supergroup", shortLine, fromId: 1001, replyTo: true));
        var edited = Assert.Single(_app.Bot.Sent<EditMessageTextRequest>());
        Assert.Equal($"Заявка №{task.Id} · Тема\n⚙️ В работе", edited.Text);
    }

    [Fact]
    public async Task Photo_card_edits_caption()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = UserId.ToString(); t[Field.Topic] = "Тема"; t[Field.Description] = "Суть"; t[Field.Status] = BoardStatus.New; });
        await _app.DeliverAsync(Callback($"st:{task.Id}:in_progress", AppFactory.DeptChatId, "supergroup", "…\n⏸️ На паузе", fromId: 1001, photo: true));
        var edited = Assert.Single(_app.Bot.Sent<EditMessageCaptionRequest>());
        Assert.Contains("⚙️ В работе", edited.Caption);
    }
}
