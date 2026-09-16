using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CompDesignBot.Endpoints;
using CompDesignBot.Features.Requests;
using CompDesignBot.Tests.Fakes;
using Microsoft.AspNetCore.Mvc.Testing;
using Telegram.Bot.Requests;

namespace CompDesignBot.Tests;

public sealed class ApiTests : IDisposable
{
    private readonly AppFactory _app = new();
    private readonly HttpClient _client;

    public ApiTests()
    {
        // Без автоследования: тест на редирект должен видеть сам 301.
        _client = _app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public void Dispose()
    {
        _client.Dispose();
        _app.Dispose();
    }

    private HttpRequestMessage Authed(HttpMethod method, string path, long userId = 77, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _app.TokenFor(userId));
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return request;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    [Fact]
    public async Task Health_and_topics_are_public()
    {
        var health = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        var topics = await Json(await _client.GetAsync("/api/topics/"));
        var rows = topics.GetProperty("rows");
        Assert.Equal(8, rows.GetArrayLength());
        Assert.Equal("unique", rows[0].GetProperty("key").GetString());
        Assert.Equal("/topics/unique.jpg", rows[0].GetProperty("image_front").GetString());
    }

    [Fact]
    public async Task Static_export_is_served_with_slash_redirect_and_404_page()
    {
        var root = await _client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, root.StatusCode);
        Assert.Contains("Решения и заявки", await root.Content.ReadAsStringAsync());

        var noSlash = await _client.GetAsync("/feed?x=1");
        Assert.Equal(HttpStatusCode.MovedPermanently, noSlash.StatusCode);
        Assert.Equal("/feed/?x=1", noSlash.Headers.Location?.ToString());

        var feed = await _client.GetAsync("/feed/");
        Assert.Contains("Поток", await feed.Content.ReadAsStringAsync());

        var missing = await _client.GetAsync("/nope/");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Contains("Нет такой страницы", await missing.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Requests_need_a_session_token()
    {
        var response = await _client.GetAsync("/api/requests/");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("нужен токен сессии", (await Json(response)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Redeem_and_exchange_issue_tokens()
    {
        var code = _app.Tokens.IssueLoginCode(5, "Имя", "nick");
        var redeemed = await Json(await _client.PostAsJsonAsync("/api/auth/redeem/", new { code }));
        Assert.Equal(5, redeemed.GetProperty("user").GetProperty("id").GetInt64());
        Assert.Equal("@nick", redeemed.GetProperty("user").GetProperty("handle").GetString());
        Assert.Equal(5, _app.Tokens.ReadToken(redeemed.GetProperty("token").GetString()!).Id);

        var bad = await _client.PostAsJsonAsync("/api/auth/redeem/", new { code = "nope" });
        Assert.Equal(HttpStatusCode.Unauthorized, bad.StatusCode);

        var exchange = await _client.PostAsync("/api/auth/exchange/", null);
        Assert.Equal(HttpStatusCode.Unauthorized, exchange.StatusCode);
    }

    [Fact]
    public async Task Requests_are_filtered_by_telegram_id_and_sorted()
    {
        _app.Pyrus.Seed(t => { t[Field.TelegramId] = "77"; t[Field.Topic] = "Тема A"; t[Field.Status] = BoardStatus.New; t.CreateDate = "2026-09-01T00:00:00Z"; });
        var newer = _app.Pyrus.Seed(t => { t[Field.TelegramId] = "77"; t[Field.Topic] = "Тема B"; t[Field.Status] = BoardStatus.Work; t.CreateDate = "2026-09-10T00:00:00Z"; });
        _app.Pyrus.Seed(t => { t[Field.TelegramId] = "99"; t[Field.Topic] = "Чужая"; });

        var body = await Json(await _client.SendAsync(Authed(HttpMethod.Get, "/api/requests/")));
        var requests = body.GetProperty("requests");
        Assert.Equal("pyrus", body.GetProperty("source").GetString());
        Assert.Equal(2, requests.GetArrayLength());
        Assert.Equal(newer.Id, requests[0].GetProperty("taskId").GetInt64());
        Assert.Equal("Тема B", requests[0].GetProperty("topic").GetString());
        Assert.Equal(BoardStatus.Work, requests[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task Foreign_request_looks_missing()
    {
        var foreign = _app.Pyrus.Seed(t => { t[Field.TelegramId] = "99"; });
        var response = await _client.SendAsync(Authed(HttpMethod.Get, $"/api/requests/{foreign.Id}/"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Action_comments_pyrus_and_notifies_dept()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = "77"; t[Field.Topic] = "Тема"; t[Field.Status] = BoardStatus.Clarify; });
        var response = await _client.SendAsync(Authed(HttpMethod.Post, $"/api/requests/{task.Id}/", body: new { action = "answer", text = "Файл там" }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await Json(response);
        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.True(body.GetProperty("delivered").GetBoolean());

        var comment = Assert.Single(_app.Pyrus.Comments);
        Assert.Equal("Ответ заявителя:\nФайл там", comment.Request.Text);
        Assert.Equal(BoardStatus.Work, task[Field.Status]);

        var sent = Assert.Single(_app.Bot.Sent<SendMessageRequest>());
        Assert.Equal(AppFactory.DeptChatId, sent.ChatId.Identifier);
        Assert.Equal(AppFactory.DeptThreadId, sent.MessageThreadId);
        Assert.StartsWith($"Заявка №{task.Id} · Тема\nОтвет от заявителя (Тест Тестов @tester):", sent.Text);

        var empty = await _client.SendAsync(Authed(HttpMethod.Post, $"/api/requests/{task.Id}/", body: new { action = "note", text = "" }));
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        var unknown = await _client.SendAsync(Authed(HttpMethod.Post, $"/api/requests/{task.Id}/", body: new { action = "explode" }));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
    }

    [Fact]
    public async Task Feed_marks_watching_and_watch_toggles()
    {
        var task = _app.Pyrus.Seed(t => { t[Field.TelegramId] = "99"; t[Field.Topic] = "Тема"; t[Field.Description] = "Проект: X\n\nСуть дела"; t[Field.Status] = BoardStatus.Work; });
        _app.Pyrus.Seed(t => { t[Field.Status] = BoardStatus.Rejected; t.Closed = true; });

        var anonymous = await Json(await _client.GetAsync("/api/feed/"));
        var row = Assert.Single(anonymous.GetProperty("tasks").EnumerateArray());
        Assert.Equal("Суть дела", row.GetProperty("excerpt").GetString());
        Assert.False(row.GetProperty("watching").GetBoolean());
        Assert.False(row.TryGetProperty("watchers", out _));

        var toggled = await Json(await _client.SendAsync(Authed(HttpMethod.Post, $"/api/feed/{task.Id}/watch/")));
        Assert.True(toggled.GetProperty("watching").GetBoolean());
        Assert.Equal("Подписка: tg:77 Тест Тестов @tester", _app.Pyrus.Comments.Single().Request.Text);

        var mine = await Json(await _client.SendAsync(Authed(HttpMethod.Get, "/api/feed/")));
        Assert.True(mine.GetProperty("tasks")[0].GetProperty("watching").GetBoolean());

        var untoggled = await Json(await _client.SendAsync(Authed(HttpMethod.Post, $"/api/feed/{task.Id}/watch/")));
        Assert.False(untoggled.GetProperty("watching").GetBoolean());
        Assert.StartsWith("Отписка: tg:77", _app.Pyrus.Comments[^1].Request.Text);
    }

    [Fact]
    public async Task Cover_streams_first_image()
    {
        var task = _app.Pyrus.Seed(t =>
        {
            t[Field.Status] = BoardStatus.Work;
            t.Attachments.Add(new() { Name = "ref.jpg", Url = "https://files/1", MimeType = "image/jpeg" });
        });
        var response = await _client.GetAsync($"/api/feed/{task.Id}/cover/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/jpeg", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(_app.Pyrus.DownloadBytes, await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("max-age=86400", response.Headers.CacheControl?.ToString());

        var none = _app.Pyrus.Seed(t => { t[Field.Status] = BoardStatus.Work; });
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/feed/{none.Id}/cover/")).StatusCode);
    }

    [Fact]
    public async Task Projects_come_from_catalog()
    {
        var body = await Json(await _client.GetAsync("/api/projects/"));
        var projects = body.GetProperty("projects");
        Assert.Equal(2, projects.GetArrayLength());
        Assert.Equal("1-19-2026 MR Group АГК БЦ Верейская", projects[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Upload_requires_token_and_returns_guid()
    {
        using var anonymous = new MultipartFormDataContent { { new ByteArrayContent([1, 2]), "file", "a.jpg" } };
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsync("/api/uploads/", anonymous)).StatusCode);

        var image = new ByteArrayContent([1, 2, 3]);
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        using var form = new MultipartFormDataContent { { image, "file", "photo.jpg" } };
        var request = Authed(HttpMethod.Post, "/api/uploads/");
        request.Content = form;
        var body = await Json(await _client.SendAsync(request));
        Assert.Equal(32, body.GetProperty("guid").GetString()!.Length);
        Assert.Equal(["photo.jpg"], _app.Pyrus.Uploaded);

        var text = new ByteArrayContent([1]);
        text.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        using var wrong = new MultipartFormDataContent { { text, "file", "a.txt" } };
        var wrongRequest = Authed(HttpMethod.Post, "/api/uploads/");
        wrongRequest.Content = wrong;
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await _client.SendAsync(wrongRequest)).StatusCode);
    }

    [Fact]
    public async Task Expiring_token_is_renewed_in_header()
    {
        var soon = new CompDesignBot.Features.Auth.SessionTokens(AppFactory.BotToken, new ShiftedClock(TimeSpan.FromDays(-25)))
            .IssueToken(new CompDesignBot.Features.Auth.Viewer(77, "a", null));
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/requests/");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", soon);
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var renewed = response.Headers.GetValues(ApiSupport.SessionTokenHeader).Single();
        Assert.Equal(77, _app.Tokens.ReadToken(renewed).Id);
        Assert.Contains(ApiSupport.SessionTokenHeader, response.Headers.GetValues("Access-Control-Expose-Headers"));
    }

    [Fact]
    public async Task Webhook_checks_secret_and_queues_update()
    {
        var update = """{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":77,"type":"private"},"from":{"id":77,"is_bot":false,"first_name":"Иван"},"text":"/info"}}""";
        var forbidden = await _client.PostAsync("/telegram/webhook", new StringContent(update, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var request = new HttpRequestMessage(HttpMethod.Post, "/telegram/webhook")
        {
            Content = new StringContent(update, System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("X-Telegram-Bot-Api-Secret-Token", AppFactory.WebhookSecret);
        var ok = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!_app.Bot.Sent<SendMessageRequest>().Any() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        var sent = Assert.Single(_app.Bot.Sent<SendMessageRequest>());
        Assert.Equal(77, sent.ChatId.Identifier);
        Assert.StartsWith("Как это работает:", sent.Text);
    }

    private sealed class ShiftedClock(TimeSpan shift) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UtcNow + shift;
    }
}
