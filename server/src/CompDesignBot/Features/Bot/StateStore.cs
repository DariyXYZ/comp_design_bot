using System.Collections.Concurrent;

namespace CompDesignBot.Features.Bot;

/// <summary>
/// Состояния диалога. aiogram держит один контекст на ключ (chat_id, user_id),
/// и состояния из разных групп (заявка / вопрос отдела / отзыв) — физически
/// одно поле; поэтому здесь один enum. На этом держится защита «уже открыт
/// вопрос по другой заявке» в чате отдела и в оценке.
/// </summary>
public enum BotState
{
    None,
    NewDescription,
    NewPhotos,
    NewSource,
    NewPreview,
    DeptReason,
    DeptQuestion,
    FeedbackText,
}

/// <summary>Данные диалога: черновик заявки или номер заявки, по которой ждём текст.</summary>
public sealed class Draft
{
    public string? CaseKey { get; set; }
    public string? Description { get; set; }
    public List<string> Photos { get; } = [];
    public List<string> PyrusPhotoGuids { get; set; } = [];
    public string? SourcePath { get; set; }
    public bool FromWebApp { get; set; }
    public string? Project { get; set; }
    public long? ProjectId { get; set; }
    public string? Origin { get; set; }
    public string? OriginPath { get; set; }
    public string? Deadline { get; set; }
    public string? Expected { get; set; }

    /// <summary>Заявка, по которой отдел пишет причину/вопрос или заявитель — отзыв.</summary>
    public long? ReqId { get; set; }
}

public sealed class FsmEntry
{
    public BotState State { get; set; } = BotState.None;
    public Draft Data { get; set; } = new();
}

/// <summary>
/// Аналог aiogram FSMContext + MemoryStorage: состояние и данные по ключу
/// (chat_id, user_id). Не переживает рестарт процесса — тот же осознанный
/// компромисс, что и раньше: реплай-механика оказалась неочевидной для людей.
/// </summary>
public sealed class StateStore
{
    private readonly ConcurrentDictionary<(long ChatId, long UserId), FsmEntry> _entries = new();

    public FsmEntry Entry(long chatId, long userId) => _entries.GetOrAdd((chatId, userId), _ => new FsmEntry());

    public BotState GetState(long chatId, long userId) => Entry(chatId, userId).State;

    public void SetState(long chatId, long userId, BotState state) => Entry(chatId, userId).State = state;

    public void Clear(long chatId, long userId)
    {
        var entry = Entry(chatId, userId);
        entry.State = BotState.None;
        entry.Data = new Draft();
    }
}

/// <summary>
/// Замена словарей asyncio.Lock: один лок на пользователя (гонки альбома и
/// дабл-кликов) и один на заявку (два быстрых клика по одной карточке).
/// Записи не удаляются — долгоживущие локи, как в оригинале.
/// </summary>
public sealed class KeyedAsyncLock
{
    private readonly ConcurrentDictionary<long, SemaphoreSlim> _locks = new();

    public async Task<IDisposable> LockAsync(long key, CancellationToken ct = default)
    {
        var semaphore = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await semaphore.WaitAsync(ct);
        return new Releaser(semaphore);
    }

    private sealed class Releaser(SemaphoreSlim semaphore) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            semaphore.Release();
        }
    }
}

/// <summary>Два назначения локов — пользователь и заявка — раздельно, ключи не пересекаются по смыслу.</summary>
public sealed class BotLocks
{
    public KeyedAsyncLock Users { get; } = new();
    public KeyedAsyncLock Requests { get; } = new();
}
