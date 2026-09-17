using CompDesignBot.Hosting;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Catalog;

/// <summary>
/// Список проектов бюро для подсказки в поле «Проект» — общий справочник Pyrus
/// «Проект» (~900 позиций). Свой список из папок на диске дал бы второе
/// написание того же проекта. Кэш десять минут: новые проекты заводят не каждый час.
/// </summary>
public sealed class ProjectCatalog
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    private readonly IPyrusClient _pyrus;
    private readonly AppOptions _options;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private (DateTimeOffset At, IReadOnlyList<CatalogItem> Items)? _cache;

    public ProjectCatalog(IPyrusClient pyrus, AppOptions options, TimeProvider? clock = null)
    {
        _pyrus = pyrus;
        _options = options;
        _clock = clock ?? TimeProvider.System;
    }

    public async Task<IReadOnlyList<CatalogItem>> ItemsAsync(CancellationToken ct = default)
    {
        if (Fresh() is { } cached)
        {
            return cached;
        }

        await _lock.WaitAsync(ct);
        try
        {
            if (Fresh() is { } again)
            {
                return again;
            }

            var items = await _pyrus.CatalogItemsAsync(_options.PyrusProjectCatalogId, ct);
            _cache = (_clock.GetUtcNow(), items);
            return items;
        }
        finally
        {
            _lock.Release();
        }
    }

    private IReadOnlyList<CatalogItem>? Fresh() =>
        _cache is { } c && _clock.GetUtcNow() - c.At < Ttl ? c.Items : null;
}
