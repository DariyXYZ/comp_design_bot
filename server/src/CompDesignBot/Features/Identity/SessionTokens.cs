using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Web;

namespace CompDesignBot.Features.Identity;

/// <summary>Кто открыл Mini App. В JSON — <c>{id, name, handle}</c>, как ждёт клиент.</summary>
public sealed record Viewer(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("handle")] string? Handle);

public sealed class AuthException(string message) : Exception(message);

/// <summary>
/// Вход в Mini App: проверка данных запуска Telegram (<c>initData</c>, подписан
/// токеном бота) и свои токены сессии — подписанный HMAC-SHA256 payload без
/// состояния на сервере, секрет — <c>SESSION_SECRET</c>. Формат
/// <c>base64url(payload).base64url(signature)</c> общий с прежними версиями.
/// Второй способ входа (Plancy, вне Telegram) — отдельный этап, см. docs/ARCHITECTURE.md §5.
/// </summary>
public sealed class SessionTokens
{
    /// <summary>Месяц: человек не логинится каждый день, но потерянный токен не вечен.</summary>
    public const int TokenTtlSeconds = 30 * 24 * 3600;

    /// <summary>
    /// За сколько до конца срока выдавать новый токен. Иначе месяц — жёсткая стена:
    /// клиент Telegram отдаёт пустой initData, кнопка в чате остыла — войти негде.
    /// </summary>
    public const int RenewBeforeSeconds = 7 * 24 * 3600;

    private const int InitDataMaxAgeSeconds = 24 * 3600;

    private static readonly JsonSerializerOptions Json = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly byte[] _secret;
    private readonly byte[] _botToken;
    private readonly TimeProvider _clock;

    public SessionTokens(string sessionSecret, string botToken, TimeProvider? clock = null)
    {
        _secret = Encoding.UTF8.GetBytes(sessionSecret);
        _botToken = Encoding.UTF8.GetBytes(botToken);
        _clock = clock ?? TimeProvider.System;
    }

    private long Now => _clock.GetUtcNow().ToUnixTimeSeconds();

    public string IssueToken(Viewer viewer)
    {
        var payload = new TokenPayload { Id = viewer.Id, Name = viewer.Name, Handle = viewer.Handle, Exp = Now + TokenTtlSeconds };
        return Sign(JsonSerializer.SerializeToUtf8Bytes(payload, Json));
    }

    public Viewer ReadToken(string token)
    {
        var payload = ParseToken(token);
        return new Viewer(payload.Id, payload.Name ?? "Без имени", payload.Handle);
    }

    /// <summary>
    /// Свежий токен, если прежнему осталось меньше недели; иначе null. Продление
    /// молчаливое и попутное: просить его пришлось бы ровно тогда, когда вход уже
    /// не работает. Истёкший и поддельный токен не продлевается.
    /// </summary>
    public string? RenewedToken(string token)
    {
        TokenPayload payload;
        try
        {
            payload = ParseToken(token);
        }
        catch (AuthException)
        {
            return null;
        }

        return payload.Exp - Now > RenewBeforeSeconds
            ? null
            : IssueToken(new Viewer(payload.Id, payload.Name ?? "Без имени", payload.Handle));
    }

    /// <summary>
    /// Проверяет подпись initData по алгоритму Telegram: пары key=value без hash,
    /// отсортированные по ключу и склеенные переводом строки; ключ подписи —
    /// HMAC("WebAppData", токен бота).
    /// </summary>
    public Viewer VerifyInitData(string initData)
    {
        if (string.IsNullOrEmpty(initData))
        {
            throw new AuthException("данные запуска пусты");
        }

        var query = HttpUtility.ParseQueryString(initData);
        var hash = query["hash"] ?? throw new AuthException("в данных запуска нет подписи");
        var pairs = query.AllKeys
            .Where(key => key is not null && key != "hash")
            .Select(key => $"{key}={query[key]}")
            .OrderBy(pair => pair, StringComparer.Ordinal);
        var checkString = string.Join('\n', pairs);

        var secretKey = HMACSHA256.HashData(Encoding.UTF8.GetBytes("WebAppData"), _botToken);
        var expected = HMACSHA256.HashData(secretKey, Encoding.UTF8.GetBytes(checkString));
        byte[] actual;
        try
        {
            actual = Convert.FromHexString(hash);
        }
        catch (FormatException)
        {
            throw new AuthException("подпись не совпала");
        }

        if (!CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            throw new AuthException("подпись не совпала");
        }

        if (long.TryParse(query["auth_date"], out var authDate) && authDate > 0 && Now - authDate > InitDataMaxAgeSeconds)
        {
            throw new AuthException("данные запуска устарели");
        }

        var rawUser = query["user"] ?? throw new AuthException("в данных запуска нет пользователя");
        var user = JsonSerializer.Deserialize<InitDataUser>(rawUser, Json) ?? throw new AuthException("у пользователя нет id");
        if (user.Id <= 0)
        {
            throw new AuthException("у пользователя нет id");
        }

        var name = string.Join(' ', new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrEmpty(part))).Trim();
        return new Viewer(user.Id, name.Length > 0 ? name : "Без имени", string.IsNullOrEmpty(user.Username) ? null : "@" + user.Username);
    }

    /// <summary>Достаёт токен из заголовка <c>Authorization: Bearer …</c>.</summary>
    public static string Bearer(string? header)
    {
        var value = header?.Trim() ?? "";
        if (!value.StartsWith("bearer ", StringComparison.OrdinalIgnoreCase))
        {
            throw new AuthException("нужен токен сессии");
        }

        return value[7..].Trim();
    }

    private TokenPayload ParseToken(string token)
    {
        var body = Verify(token, "токен повреждён", "подпись токена не совпала");
        var payload = JsonSerializer.Deserialize<TokenPayload>(body, Json) ?? throw new AuthException("токен повреждён");
        if (payload.Exp < Now)
        {
            throw new AuthException("токен истёк");
        }

        return payload;
    }

    private string Sign(byte[] payload)
    {
        var body = Base64Url(payload);
        var signature = HMACSHA256.HashData(_secret, Encoding.ASCII.GetBytes(body));
        return $"{body}.{Base64Url(signature)}";
    }

    private byte[] Verify(string signed, string brokenMessage, string mismatchMessage)
    {
        var parts = signed.Split('.');
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0)
        {
            throw new AuthException(brokenMessage);
        }

        var expected = Base64Url(HMACSHA256.HashData(_secret, Encoding.ASCII.GetBytes(parts[0])));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(parts[1])))
        {
            throw new AuthException(mismatchMessage);
        }

        try
        {
            return FromBase64Url(parts[0]);
        }
        catch (FormatException)
        {
            throw new AuthException(brokenMessage);
        }
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromBase64Url(string text)
    {
        var padded = text.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
    }

    private sealed class TokenPayload
    {
        [JsonPropertyName("id")] public long Id { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("handle")] public string? Handle { get; set; }
        [JsonPropertyName("exp")] public long Exp { get; set; }
    }

    private sealed class InitDataUser
    {
        [JsonPropertyName("id")] public long Id { get; set; }
        [JsonPropertyName("first_name")] public string? FirstName { get; set; }
        [JsonPropertyName("last_name")] public string? LastName { get; set; }
        [JsonPropertyName("username")] public string? Username { get; set; }
    }
}
