using System.Security.Cryptography;
using System.Text;
using CompDesignBot.Features.Identity;

namespace CompDesignBot.Tests;

public sealed class SessionTokensTests
{
    private const string Secret = "session-secret";
    private const string BotToken = "111:bot-token";

    private sealed class FakeTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Подписывает так же, как прежний TS <c>issueToken</c>.</summary>
    private static string SignLikeOthers(string payloadJson)
    {
        var body = Base64Url(Encoding.UTF8.GetBytes(payloadJson));
        var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.ASCII.GetBytes(body));
        return $"{body}.{Base64Url(signature)}";
    }

    [Fact]
    public void Token_round_trips_viewer()
    {
        var tokens = new SessionTokens(Secret, BotToken);
        var viewer = new Viewer(42, "Дарий Назаров", "@dariy");
        var token = tokens.IssueToken(viewer);
        Assert.Equal(viewer, tokens.ReadToken(token));
    }

    [Fact]
    public void Token_from_previous_ts_version_is_accepted()
    {
        var exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 3600;
        var token = SignLikeOthers($"{{\"id\":7,\"name\":\"Имя\",\"handle\":null,\"exp\":{exp}}}");
        var viewer = new SessionTokens(Secret, BotToken).ReadToken(token);
        Assert.Equal(new Viewer(7, "Имя", null), viewer);
    }

    [Fact]
    public void Tampered_signature_is_rejected()
    {
        var tokens = new SessionTokens(Secret, BotToken);
        var token = tokens.IssueToken(new Viewer(1, "a", null));
        var other = new SessionTokens("other", BotToken).IssueToken(new Viewer(1, "a", null));
        Assert.Throws<AuthException>(() => tokens.ReadToken(other));
        Assert.Throws<AuthException>(() => tokens.ReadToken(token + "x"));
        Assert.Throws<AuthException>(() => tokens.ReadToken("garbage"));
    }

    [Fact]
    public void Expired_token_is_rejected_and_not_renewed()
    {
        var clock = new FakeTime(new DateTimeOffset(2026, 9, 16, 12, 0, 0, TimeSpan.Zero));
        var tokens = new SessionTokens(Secret, BotToken, clock);
        var token = tokens.IssueToken(new Viewer(1, "a", null));
        clock.Now = clock.Now.AddDays(31);
        Assert.Throws<AuthException>(() => tokens.ReadToken(token));
        Assert.Null(tokens.RenewedToken(token));
    }

    [Fact]
    public void Token_is_renewed_only_when_less_than_a_week_left()
    {
        var clock = new FakeTime(new DateTimeOffset(2026, 9, 16, 12, 0, 0, TimeSpan.Zero));
        var tokens = new SessionTokens(Secret, BotToken, clock);
        var token = tokens.IssueToken(new Viewer(1, "a", null));
        Assert.Null(tokens.RenewedToken(token));
        clock.Now = clock.Now.AddDays(24);
        var renewed = tokens.RenewedToken(token);
        Assert.NotNull(renewed);
        clock.Now = clock.Now.AddDays(20);
        Assert.Equal(1, tokens.ReadToken(renewed).Id);
    }

    [Fact]
    public void Init_data_signature_is_verified()
    {
        var authDate = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var user = "{\"id\":77,\"first_name\":\"Иван\",\"last_name\":\"Петров\",\"username\":\"ivan\"}";
        var pairs = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["auth_date"] = authDate.ToString(),
            ["query_id"] = "AAH",
            ["user"] = user,
        };
        var checkString = string.Join('\n', pairs.Select(p => $"{p.Key}={p.Value}"));
        var secretKey = HMACSHA256.HashData(Encoding.UTF8.GetBytes("WebAppData"), Encoding.UTF8.GetBytes(BotToken));
        var hash = Convert.ToHexString(HMACSHA256.HashData(secretKey, Encoding.UTF8.GetBytes(checkString))).ToLowerInvariant();
        var initData = $"query_id=AAH&user={Uri.EscapeDataString(user)}&auth_date={authDate}&hash={hash}";

        var viewer = new SessionTokens(Secret, BotToken).VerifyInitData(initData);
        Assert.Equal(new Viewer(77, "Иван Петров", "@ivan"), viewer);

        Assert.Throws<AuthException>(() => new SessionTokens(Secret, BotToken).VerifyInitData(initData.Replace("ivan", "eve")));
        Assert.Throws<AuthException>(() => new SessionTokens(Secret, BotToken).VerifyInitData(""));
    }

    [Fact]
    public void Bearer_header_is_parsed()
    {
        Assert.Equal("abc", SessionTokens.Bearer("Bearer abc"));
        Assert.Equal("abc", SessionTokens.Bearer(" bearer abc "));
        Assert.Throws<AuthException>(() => SessionTokens.Bearer(null));
        Assert.Throws<AuthException>(() => SessionTokens.Bearer("Basic abc"));
    }
}
