namespace CompDesignBot;

// Порт config.py: те же переменные, тот же .env-парсер (setdefault-семантика —
// реальная переменная процесса всегда важнее файла), те же проверки.
public sealed class Config
{
    public required string Token { get; init; }
    public long? DeptChatId { get; init; }
    public long? DeptThreadId { get; init; }
    public required string WebAppUrl { get; init; }
    public required string DbPath { get; init; }

    public static Config Instance { get; private set; } = null!;

    public static void Load(string baseDir)
    {
        var fileValues = ParseEnvFile(Path.Combine(baseDir, ".env"));

        string? Get(string name) =>
            Environment.GetEnvironmentVariable(name) ??
            (fileValues.TryGetValue(name, out var v) ? v : null);

        var token = Get("TELEGRAM_TOKEN");
        if (string.IsNullOrEmpty(token))
            throw new InvalidOperationException("TELEGRAM_TOKEN не задан в .env");

        long? IntOrNull(string name)
        {
            var raw = Get(name)?.Trim();
            return string.IsNullOrEmpty(raw) ? null : long.Parse(raw);
        }

        var webAppUrl = Get("WEBAPP_URL")?.Trim() ?? "";
        if (webAppUrl.Length > 0 && !webAppUrl.StartsWith("https://", StringComparison.Ordinal))
        {
            // Telegram принимает только https:// для web_app-кнопок; кривой URL
            // ломает /start целиком, поэтому лучше вообще без кнопки Mini App.
            Log.Warning($"WEBAPP_URL не https:// — кнопка Mini App отключена: {webAppUrl}");
            webAppUrl = "";
        }

        var dbFile = Get("DB_FILE")?.Trim();
        var dbPath = Path.Combine(baseDir, string.IsNullOrEmpty(dbFile) ? "requests.sqlite3" : dbFile);

        Instance = new Config
        {
            Token = token,
            DeptChatId = IntOrNull("DEPT_CHAT_ID"),
            DeptThreadId = IntOrNull("DEPT_THREAD_ID"),
            WebAppUrl = webAppUrl,
            DbPath = dbPath,
        };
    }

    private static Dictionary<string, string> ParseEnvFile(string path)
    {
        var result = new Dictionary<string, string>();
        if (!File.Exists(path)) return result;

        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var idx = line.IndexOf('=');
            if (idx < 0) continue;
            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim().Trim('\'', '"');
            // setdefault: первое вхождение ключа в файле побеждает, как в Python.
            if (!result.ContainsKey(key)) result[key] = value;
        }
        return result;
    }
}
