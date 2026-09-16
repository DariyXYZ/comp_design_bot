using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Feed;

/// <summary>Строка ленты отдела — то, что видно на карточке канбана. Автор намеренно не отдаётся.</summary>
public sealed record FeedTask(
    long TaskId,
    string? Topic,
    string? Project,
    string Excerpt,
    string? Status,
    bool Closed,
    string? Created,
    string? ClosedAt,
    string? Source,
    bool HasCover,
    IReadOnlyList<long> Watchers);

/// <summary>
/// Поток отдела — доска Pyrus в виде ленты. Реестр не отдаёт вложений и
/// комментариев, поэтому активные и последние закрытые задачи читаются
/// целиком (~25 запросов) — результат живёт в памяти две минуты.
/// </summary>
public sealed class FeedService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);
    private const int ClosedLimit = 15;
    private const int ExcerptLimit = 140;

    private readonly IPyrusClient _pyrus;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private Snapshot? _cache;

    public FeedService(IPyrusClient pyrus, TimeProvider? clock = null)
    {
        _pyrus = pyrus;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>Лента: активные задачи и последние закрытые, свежие сверху.</summary>
    public async Task<IReadOnlyList<FeedTask>> LoadAsync(CancellationToken ct = default)
    {
        if (Fresh() is { } cached)
        {
            return cached.Tasks;
        }

        await _lock.WaitAsync(ct);
        try
        {
            if (Fresh() is { } again)
            {
                return again.Tasks;
            }

            var register = await _pyrus.RegisterAsync(ct);
            // Отклонённые в ленту не идут: это доска сделанного, а не корзина.
            var closed = register
                .Where(task => task.Closed)
                .Where(task => ToFeedTask(task).Status != BoardStatus.Rejected)
                .OrderByDescending(task => task.CloseDate ?? "", StringComparer.Ordinal)
                .Take(ClosedLimit);
            var active = register.Where(task => !task.Closed);
            var picked = active.Concat(closed).ToList();

            var details = new Dictionary<long, PyrusTask>();
            var loaded = await Task.WhenAll(picked.Select(task => _pyrus.GetTaskAsync(task.Id, ct)));
            foreach (var full in loaded)
            {
                if (full is not null)
                {
                    details[full.Id] = full;
                }
            }

            var tasks = picked
                .Select(task => ToFeedTask(details.TryGetValue(task.Id, out var full) ? full : task))
                .OrderByDescending(task => task.Created ?? "", StringComparer.Ordinal)
                .ToList();
            _cache = new Snapshot(_clock.GetUtcNow(), tasks, details);
            return tasks;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Задача из кэша ленты или напрямую — для обложки и подписки.</summary>
    public async Task<PyrusTask?> TaskAsync(long taskId, CancellationToken ct = default)
    {
        if (_cache?.Details.TryGetValue(taskId, out var cached) == true)
        {
            return cached;
        }

        return await _pyrus.GetTaskAsync(taskId, ct);
    }

    /// <summary>Сбросить кэш после записи — подписка должна быть видна сразу.</summary>
    public void Invalidate() => _cache = null;

    public static PyrusAttachment? FirstImage(PyrusTask task)
    {
        var all = task.Attachments.Concat(task.Comments.SelectMany(comment => comment.Attachments));
        return all.FirstOrDefault(att =>
            (att.MimeType ?? "").StartsWith("image/", StringComparison.Ordinal)
            || HasImageExtension(att.Name));
    }

    public static FeedTask ToFeedTask(PyrusTask task)
    {
        var values = task.ValuesByName();
        string? Get(string name) => values.TryGetValue(name, out var v) ? v : null;
        return new FeedTask(
            task.Id,
            Get(Field.Topic),
            Get(Field.Project),
            RequestCard.Excerpt(Get(Field.Description), ExcerptLimit),
            Get(Field.Status),
            task.Closed,
            task.CreateDate,
            task.CloseDate,
            Get(Field.Source),
            FirstImage(task) is not null,
            RequestParser.Watchers(task.Comments));
    }

    private static bool HasImageExtension(string? name)
    {
        var ext = Path.GetExtension(name ?? "").ToLowerInvariant();
        return ext is ".jpg" or ".jpeg" or ".png" or ".webp" or ".gif";
    }

    private Snapshot? Fresh() =>
        _cache is { } snapshot && _clock.GetUtcNow() - snapshot.At < Ttl ? snapshot : null;

    private sealed record Snapshot(DateTimeOffset At, IReadOnlyList<FeedTask> Tasks, IReadOnlyDictionary<long, PyrusTask> Details);
}
