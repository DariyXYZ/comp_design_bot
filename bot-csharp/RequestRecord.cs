using System.Text.Json;

namespace CompDesignBot;

// Одна строка таблицы requests — те же колонки, что и в db.py, тот же
// JSON-формат photo_file_ids (совместим с БД, созданной Python-версией).
public sealed class RequestRecord
{
    public long Id { get; init; }
    public long UserId { get; init; }
    public string? Username { get; init; }
    public string FullName { get; init; } = "";
    public string CaseKey { get; init; } = "";
    public string Description { get; init; } = "";
    public string PhotoFileIdsJson { get; init; } = "[]";
    public string? SourcePath { get; init; }
    public string Status { get; init; } = "new";
    public long? DeptMessageId { get; init; }
    public string CreatedAt { get; init; } = "";
    public string UpdatedAt { get; init; } = "";
    public long? AcceptedByUserId { get; init; }
    public string? AcceptedByUsername { get; init; }
    public string? AcceptedByName { get; init; }
    public string? AcceptedByContact { get; init; }
    public long? FinishedByUserId { get; init; }
    public string? FinishedByUsername { get; init; }
    public string? FinishedByName { get; init; }
    public string? FinishedByContact { get; init; }
    public string? RejectionReason { get; init; }
    public string? Feedback { get; init; }
    public string? FeedbackComment { get; init; }

    public List<string> Photos => JsonSerializer.Deserialize<List<string>>(PhotoFileIdsJson) ?? new();

    // "Имя (@username)" — та же строка, что author_line()/author в Python.
    public string AuthorLine() => FullName + (string.IsNullOrEmpty(Username) ? "" : $" (@{Username})");
}
