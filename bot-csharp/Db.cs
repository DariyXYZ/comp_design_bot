using Microsoft.Data.Sqlite;
using System.Text.Json;

namespace CompDesignBot;

// Порт db.py — SQLite-хранилище заявок. Схема и миграция колонок один в
// один совпадают с Python-версией: файл requests.sqlite3 читается/пишется
// в том же формате (JSON-массив в photo_file_ids, те же имена и типы колонок).
public static class Db
{
    private const string Schema = """
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT,
            full_name TEXT,
            case_key TEXT NOT NULL,
            description TEXT NOT NULL,
            photo_file_ids TEXT NOT NULL DEFAULT '[]',
            source_path TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            dept_message_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS actor_contacts (
            user_id INTEGER PRIMARY KEY,
            contact TEXT NOT NULL
        );
        """;

    // ALTER TABLE ADD COLUMN, но только если колонки ещё нет — CREATE TABLE
    // IF NOT EXISTS не трогает уже существующую таблицу, схему приходится
    // доращивать руками при каждом обновлении, не теряя старые данные.
    private static readonly (string Name, string Type)[] NewColumns =
    {
        ("accepted_by_user_id", "INTEGER"),
        ("accepted_by_username", "TEXT"),
        ("accepted_by_name", "TEXT"),
        ("accepted_by_contact", "TEXT"),
        ("finished_by_user_id", "INTEGER"),
        ("finished_by_username", "TEXT"),
        ("finished_by_name", "TEXT"),
        ("finished_by_contact", "TEXT"),
        ("rejection_reason", "TEXT"),
        ("feedback", "TEXT"),
        ("feedback_comment", "TEXT"),
    };

    // Единственные два префикса, которые когда-либо подставляются в SQL как
    // имена колонок (см. SetActorAsync/SetActorContactAsync) — жёстко
    // ограничены этим множеством, никогда не приходят как есть от пользователя.
    private static readonly HashSet<string> ActorPrefixes = new() { "accepted_by", "finished_by" };

    private static string Now() => DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss+00:00");

    private static async Task<SqliteConnection> ConnectAsync()
    {
        var conn = new SqliteConnection($"Data Source={Config.Instance.DbPath}");
        await conn.OpenAsync().ConfigureAwait(false);
        // WAL: конкурентные записи не блокируют друг друга насмерть;
        // busy_timeout: при занятом локе ждём, а не падаем с 'database is locked'.
        await using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;";
        await pragma.ExecuteNonQueryAsync().ConfigureAwait(false);
        return conn;
    }

    public static async Task InitDbAsync()
    {
        await using var conn = await ConnectAsync();
        await using (var create = conn.CreateCommand())
        {
            create.CommandText = Schema;
            await create.ExecuteNonQueryAsync();
        }
        await EnsureColumnsAsync(conn);
    }

    private static async Task EnsureColumnsAsync(SqliteConnection conn)
    {
        var existing = new HashSet<string>();
        await using (var info = conn.CreateCommand())
        {
            info.CommandText = "PRAGMA table_info(requests)";
            await using var reader = await info.ExecuteReaderAsync();
            while (await reader.ReadAsync()) existing.Add(reader.GetString(1));
        }
        foreach (var (name, type) in NewColumns)
        {
            if (existing.Contains(name)) continue;
            await using var alter = conn.CreateCommand();
            alter.CommandText = $"ALTER TABLE requests ADD COLUMN {name} {type}";
            await alter.ExecuteNonQueryAsync();
        }
    }

    public static async Task<long> CreateRequestAsync(
        long userId, string? username, string fullName, string caseKey,
        string description, List<string> photoFileIds, string? sourcePath)
    {
        var now = Now();
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO requests (user_id, username, full_name, case_key, description,
                photo_file_ids, source_path, status, created_at, updated_at)
            VALUES ($userId, $username, $fullName, $caseKey, $description,
                $photos, $sourcePath, 'new', $now, $now);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$userId", userId);
        cmd.Parameters.AddWithValue("$username", (object?)username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$fullName", fullName);
        cmd.Parameters.AddWithValue("$caseKey", caseKey);
        cmd.Parameters.AddWithValue("$description", description);
        cmd.Parameters.AddWithValue("$photos", JsonSerializer.Serialize(photoFileIds));
        cmd.Parameters.AddWithValue("$sourcePath", (object?)sourcePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$now", now);
        var result = await cmd.ExecuteScalarAsync();
        return (long)result!;
    }

    public static async Task SetDeptMessageIdAsync(long reqId, long messageId)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE requests SET dept_message_id = $mid, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$mid", messageId);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    // Меняет статус, возвращает обновлённую заявку (или null, если нет такой).
    public static async Task<RequestRecord?> SetStatusAsync(long reqId, string status)
    {
        await using var conn = await ConnectAsync();
        await using (var upd = conn.CreateCommand())
        {
            upd.CommandText = "UPDATE requests SET status = $status, updated_at = $now WHERE id = $id";
            upd.Parameters.AddWithValue("$status", status);
            upd.Parameters.AddWithValue("$now", Now());
            upd.Parameters.AddWithValue("$id", reqId);
            await upd.ExecuteNonQueryAsync();
        }
        return await GetRequestAsync(conn, reqId);
    }

    // Кто нажал кнопку статуса — prefix задаёт, какую пару колонок писать:
    // "accepted_by" (кто взял в работу) или "finished_by" (кто реально сдал).
    public static async Task SetActorAsync(long reqId, string prefix, long userId, string? username, string fullName)
    {
        if (!ActorPrefixes.Contains(prefix))
            throw new ArgumentException($"неизвестный actor prefix: {prefix}", nameof(prefix));
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"UPDATE requests SET {prefix}_user_id = $uid, {prefix}_username = $uname, " +
            $"{prefix}_name = $name, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$uname", (object?)username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$name", fullName);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    // Контакт, присланный вручную — для тех, у кого нет @username в Telegram.
    public static async Task SetActorContactAsync(long reqId, string prefix, string contact)
    {
        if (!ActorPrefixes.Contains(prefix))
            throw new ArgumentException($"неизвестный actor prefix: {prefix}", nameof(prefix));
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE requests SET {prefix}_contact = $contact, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$contact", contact);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    // Контакт, который этот человек уже когда-то присылал — не переспрашивать снова.
    public static async Task<string?> GetKnownContactAsync(long userId)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT contact FROM actor_contacts WHERE user_id = $id";
        cmd.Parameters.AddWithValue("$id", userId);
        var result = await cmd.ExecuteScalarAsync();
        return result as string;
    }

    public static async Task SetKnownContactAsync(long userId, string contact)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO actor_contacts (user_id, contact) VALUES ($id, $contact)
            ON CONFLICT(user_id) DO UPDATE SET contact = excluded.contact
            """;
        cmd.Parameters.AddWithValue("$id", userId);
        cmd.Parameters.AddWithValue("$contact", contact);
        await cmd.ExecuteNonQueryAsync();
    }

    public static async Task SetRejectionReasonAsync(long reqId, string reason)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE requests SET rejection_reason = $reason, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$reason", reason);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    public static async Task SetFeedbackAsync(long reqId, string feedback)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE requests SET feedback = $fb, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$fb", feedback);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    public static async Task SetFeedbackCommentAsync(long reqId, string comment)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE requests SET feedback_comment = $comment, updated_at = $now WHERE id = $id";
        cmd.Parameters.AddWithValue("$comment", comment);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.Parameters.AddWithValue("$id", reqId);
        await cmd.ExecuteNonQueryAsync();
    }

    public static async Task<RequestRecord?> GetRequestAsync(long reqId)
    {
        await using var conn = await ConnectAsync();
        return await GetRequestAsync(conn, reqId);
    }

    private static async Task<RequestRecord?> GetRequestAsync(SqliteConnection conn, long reqId)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT * FROM requests WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", reqId);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? MapRow(reader) : null;
    }

    public static async Task<List<RequestRecord>> ListUserRequestsAsync(long userId, int limit = 20)
    {
        await using var conn = await ConnectAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT * FROM requests WHERE user_id = $uid ORDER BY id DESC LIMIT $limit";
        cmd.Parameters.AddWithValue("$uid", userId);
        cmd.Parameters.AddWithValue("$limit", limit);
        await using var reader = await cmd.ExecuteReaderAsync();
        var result = new List<RequestRecord>();
        while (await reader.ReadAsync()) result.Add(MapRow(reader));
        return result;
    }

    private static RequestRecord MapRow(SqliteDataReader r)
    {
        string? S(string col) { var i = r.GetOrdinal(col); return r.IsDBNull(i) ? null : r.GetString(i); }
        long? L(string col) { var i = r.GetOrdinal(col); return r.IsDBNull(i) ? null : r.GetInt64(i); }

        return new RequestRecord
        {
            Id = r.GetInt64(r.GetOrdinal("id")),
            UserId = r.GetInt64(r.GetOrdinal("user_id")),
            Username = S("username"),
            FullName = S("full_name") ?? "",
            CaseKey = S("case_key") ?? "",
            Description = S("description") ?? "",
            PhotoFileIdsJson = S("photo_file_ids") ?? "[]",
            SourcePath = S("source_path"),
            Status = S("status") ?? "new",
            DeptMessageId = L("dept_message_id"),
            CreatedAt = S("created_at") ?? "",
            UpdatedAt = S("updated_at") ?? "",
            AcceptedByUserId = L("accepted_by_user_id"),
            AcceptedByUsername = S("accepted_by_username"),
            AcceptedByName = S("accepted_by_name"),
            AcceptedByContact = S("accepted_by_contact"),
            FinishedByUserId = L("finished_by_user_id"),
            FinishedByUsername = S("finished_by_username"),
            FinishedByName = S("finished_by_name"),
            FinishedByContact = S("finished_by_contact"),
            RejectionReason = S("rejection_reason"),
            Feedback = S("feedback"),
            FeedbackComment = S("feedback_comment"),
        };
    }
}
