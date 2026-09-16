using System.Text.Json;
using CompDesignBot.Features.Bot.Handlers;
using CompDesignBot.Features.Feed;
using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Tests;

public sealed class RequestCardTests
{
    [Fact]
    public void Card_escapes_user_text_and_links_to_pyrus()
    {
        var card = RequestCard.Render(379185559, "Форма здания криволинейная", "Нужен <фасад> & панели", @"X:\Exchange\proj", "Иван (@ivan)",
            expected: "Скрипт");
        Assert.Contains("<a href=\"https://pyrus.com/t#id379185559\">Заявка №379185559</a> · Форма здания криволинейная", card);
        Assert.Contains("Ориентир по срокам: 2 – 3 дня", card);
        Assert.Contains("Нужен &lt;фасад&gt; &amp; панели", card);
        Assert.Contains("🎯 Ожидаемый результат: Скрипт", card);
        Assert.Contains("📁 Исходники: <code>X:\\Exchange\\proj</code>", card);
        Assert.EndsWith("⏸️ На паузе", card);
    }

    [Fact]
    public void Caption_budget_trims_only_description()
    {
        var description = string.Concat(Enumerable.Repeat("слово ", 400));
        var card = RequestCard.Render(1, "Нетиповая или разовая задача", description, "path", "Автор",
            status: ChatStatus.Done, maxLen: RequestCard.CaptionLimit, actorLine: "Завершил: Кто-то");
        Assert.True(card.EnumerateRunes().Count() <= RequestCard.CaptionLimit);
        Assert.Contains("…", card);
        Assert.Contains("📁 Исходники: <code>path</code>", card);
        Assert.EndsWith("✅ Готово\nЗавершил: Кто-то", card);
    }

    [Fact]
    public void Excerpt_skips_mini_app_header_lines()
    {
        var description = "Проект: 1-19-2026\nОснова: модуль\nСрок: 2026-10-01\n\nСделать раскладку панелей по фасаду с учётом кривизны и стыков";
        Assert.Equal("Сделать раскладку панелей по фасаду с учётом кривизны и стыков", RequestCard.Excerpt(description));
        Assert.Equal("", RequestCard.Excerpt("Проект: x"));
        var longText = new string('а', 100);
        Assert.Equal(70, RequestCard.Excerpt(longText).Length);
        Assert.EndsWith("…", RequestCard.Excerpt(longText));
    }

    [Fact]
    public void Author_line_has_handle_when_known()
    {
        Assert.Equal("Иван Петров (@ivan)", RequestCard.AuthorLine("Иван Петров", "ivan"));
        Assert.Equal("—", RequestCard.AuthorLine("", null));
    }
}

public sealed class ChatStatusTests
{
    [Theory]
    [InlineData(BoardStatus.Rejected, false, "❌ Отклонена")]
    [InlineData(BoardStatus.Done, false, "✅ Готово")]
    [InlineData(BoardStatus.Work, true, "✅ Готово")]
    [InlineData(BoardStatus.Clarify, false, "❓ Требуется уточнение")]
    [InlineData(BoardStatus.Work, false, "⚙️ В работе")]
    [InlineData(BoardStatus.New, false, "⏸️ На паузе")]
    [InlineData("", false, "⏸️ На паузе")]
    public void Board_column_maps_to_chat_label(string board, bool closed, string label) =>
        Assert.Equal(label, ChatStatus.LabelForBoard(board, closed));

    [Fact]
    public void Chat_status_maps_to_board_and_action()
    {
        Assert.Equal((BoardStatus.Done, "finished"), ChatStatus.ToBoard(ChatStatus.Done));
        Assert.Equal((BoardStatus.Work, "reopened"), ChatStatus.ToBoard(ChatStatus.Accepted));
        Assert.Null(ChatStatus.ToBoard("nope"));
        Assert.Equal(ChatStatus.Clarify, ChatStatus.KeyByLabel("❓ Требуется уточнение"));
    }
}

public sealed class RequestActionsTests
{
    private static readonly RequestActions.Ref Ref = new(379185559, "Тема", "Иван @ivan");

    [Fact]
    public void Text_actions_require_text()
    {
        Assert.Null(RequestActions.Build("note", Ref, "  "));
        Assert.Null(RequestActions.Build("rework", Ref, ""));
        Assert.NotNull(RequestActions.Build("cancel", Ref, ""));
        Assert.NotNull(RequestActions.Build("accept", Ref, ""));
    }

    [Fact]
    public void Plans_match_previous_ts_version()
    {
        var answer = RequestActions.Build("answer", Ref, "Готово, файл в папке")!;
        Assert.Equal("Ответ заявителя:\nГотово, файл в папке", answer.Comment);
        Assert.Equal("Заявка №379185559 · Тема\nОтвет от заявителя (Иван @ivan):\nГотово, файл в папке", answer.Chat);
        Assert.Equal(BoardStatus.Work, answer.Status);
        Assert.Null(answer.Action);

        var cancel = RequestActions.Build("cancel", Ref, "")!;
        Assert.Equal("Отменена от заявителя (Иван @ivan)", cancel.Comment);
        Assert.Equal("finished", cancel.Action);
        Assert.Equal(BoardStatus.Rejected, cancel.Status);

        var rework = RequestActions.Build("rework", Ref, "не то")!;
        Assert.Equal("reopened", rework.Action);
        Assert.Equal(BoardStatus.Work, rework.Status);
    }

    [Fact]
    public void Message_is_cut_to_limit()
    {
        var plan = RequestActions.Build("note", Ref, new string('x', 2000))!;
        Assert.Equal(RequestActions.MessageLimit, plan.Comment.Length - "Сообщение от заявителя (Иван @ivan):\n".Length);
    }
}

public sealed class RequestParserTests
{
    private const string TaskJson = """
        {
          "id": 379185559,
          "create_date": "2026-09-15T10:00:00Z",
          "is_closed": false,
          "fields": [
            { "id": 1, "name": "Инфо", "type": "title", "value": { "fields": [ { "id": 2, "name": "Telegram", "value": "Иван (@ivan)" } ] } },
            { "id": 10, "name": "Задача", "type": "title", "value": { "fields": [
              { "id": 11, "name": "Тема", "value": { "choice_names": ["Форма здания криволинейная"] } },
              { "id": 12, "name": "Описание задачи", "value": "Проект: X\n\nСуть" },
              { "id": 13, "name": "Telegram ID", "value": 77 },
              { "id": 14, "name": "Статус", "value": { "choice_names": ["Требуется уточнение"] } },
              { "id": 15, "name": "ID сообщения в чате", "value": 555 },
              { "id": 16, "name": "Путь к проекту", "value": "X:\\proj" }
            ] } }
          ],
          "attachments": [ { "id": 1, "name": "a.png", "url": "https://files/a", "mime_type": "image/png" } ],
          "comments": [
            { "text": "Подписка: tg:5 Кто-то" },
            { "text": "Подписка: tg:6 Другой" },
            { "text": "Вопрос заявителю: первый?" },
            { "text": "Отписка: tg:5 Кто-то" },
            { "text": "Вопрос заявителю: какой файл?" }
          ]
        }
        """;

    [Fact]
    public void Task_with_nested_sections_becomes_request()
    {
        var task = JsonSerializer.Deserialize<PyrusTask>(TaskJson)!;
        var request = RequestParser.FromTask(task);
        Assert.Equal(379185559, request.TaskId);
        Assert.Equal(77, request.UserId);
        Assert.Equal("Иван (@ivan)", request.Author);
        Assert.Equal("Форма здания криволинейная", request.CaseTitle);
        Assert.Equal("Проект: X\n\nСуть", request.Description);
        Assert.Equal(BoardStatus.Clarify, request.BoardStatus);
        Assert.Equal(555, request.ChatMessageId);
        Assert.Equal(1, request.Photos);
        Assert.Equal([6], request.Watchers);
        Assert.Equal("какой файл?", request.Question);
        Assert.Equal(379185559, request.Number);
        Assert.False(request.Closed);
    }

    [Fact]
    public void Feed_task_hides_author_and_finds_cover()
    {
        var task = JsonSerializer.Deserialize<PyrusTask>(TaskJson)!;
        var feed = FeedService.ToFeedTask(task);
        Assert.Equal("Суть", feed.Excerpt);
        Assert.True(feed.HasCover);
        Assert.Equal("X:\\proj", feed.Source);
        Assert.Equal([6], feed.Watchers);
    }
}

public sealed class WebAppPayloadTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void Description_gets_header_from_form_fields()
    {
        var data = Parse("""{"case":"curved","description":" Суть ","project":"1-19-2026 БЦ","origin":"Модуль","deadline":"2026-10-01","photos":"a,b"}""");
        Assert.Equal("Проект: 1-19-2026 БЦ\nОснова: Модуль\nСрок: 2026-10-01\nКартинки: 2 — приложены в задаче Pyrus\n\nСуть", CreateHandler.WebAppDescription(data));
        Assert.Equal(["a", "b"], CreateHandler.WebAppPhotoGuids(data));
    }

    [Fact]
    public void Missing_description_means_chat_dialog()
    {
        Assert.Null(CreateHandler.WebAppDescription(Parse("""{"case":"curved"}""")));
        Assert.Null(CreateHandler.WebAppDescription(Parse("""{"case":"curved","description":123}""")));
    }

    [Fact]
    public void Photo_guids_are_capped_at_six()
    {
        var data = Parse("""{"photos":"1,2,3,4,5,6,7,8"}""");
        Assert.Equal(6, CreateHandler.WebAppPhotoGuids(data).Count);
    }
}
