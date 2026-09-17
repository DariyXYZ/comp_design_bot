using System.Collections.Concurrent;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Чего бот ждёт от человека следующим сообщением. Один контекст на ключ
/// (chat_id, user_id), как в aiogram: два одновременных ожидания у одного
/// человека невозможны — на этом держится защита «уже открыт вопрос по другой заявке».
/// </summary>
public enum BotState
{
    None,
    /// <summary>В чате отдела: причина отказа по заявке.</summary>
    DeptReason,
    /// <summary>В чате отдела: вопрос заявителю.</summary>
    DeptQuestion,
    /// <summary>В личке: отзыв о результате.</summary>
    FeedbackText,
}

public sealed class FsmEntry
{
    public BotState State { get; set; } = BotState.None;

    /// <summary>Заявка, по которой ждём текст.</summary>
    public long? ReqId { get; set; }
}

/// <summary>
/// Память процесса; не переживает рестарт. Перенос в техническую БД —
/// первый шаг Persistence по docs/ARCHITECTURE.md §10.
/// </summary>
public sealed class StateStore
{
    private readonly ConcurrentDictionary<(long ChatId, long UserId), FsmEntry> _entries = new();

    public FsmEntry Entry(long chatId, long userId) => _entries.GetOrAdd((chatId, userId), _ => new FsmEntry());

    public BotState GetState(long chatId, long userId) => Entry(chatId, userId).State;

    public void Clear(long chatId, long userId)
    {
        var entry = Entry(chatId, userId);
        entry.State = BotState.None;
        entry.ReqId = null;
    }
}

/// <summary>
/// Лок на заявку: два быстрых клика по одной карточке (свой или чужой) читали
/// один снимок статуса до того, как первый успел записать. Записи не удаляются —
/// долгоживущие локи, как в оригинале.
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
