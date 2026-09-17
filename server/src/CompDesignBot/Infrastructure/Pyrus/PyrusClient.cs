using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using CompDesignBot.Hosting;

namespace CompDesignBot.Infrastructure.Pyrus;

/// <summary>
/// Клиент Pyrus API v4.
/// <list type="bullet">
/// <item>Токен живёт в памяти процесса и перезапрашивается по 401 — один раз на запрос.</item>
/// <item>Поля формы ищутся по названию: коды полей API не отдаёт (<c>code: null</c>),
/// а id меняется, если поле пересоздать. Переименованное поле видно в логе, заявку не ломает.</item>
/// <item>Удалённые варианты выбора приходят с флагом <c>deleted</c> — их брать нельзя, choice_id не переиспользуются.</item>
/// <item>Поле-справочник принимает id позиции, а не текст; поле выбора — choice_id.</item>
/// </list>
/// </summary>
public sealed class PyrusClient : IPyrusClient
{
    private const string AuthUrl = "https://api.pyrus.com/v4/auth";
    private const string DefaultApi = "https://api.pyrus.com/v4";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly AppOptions _options;
    private readonly ILogger<PyrusClient> _log;
    private readonly SemaphoreSlim _authLock = new(1, 1);
    private readonly SemaphoreSlim _schemaLock = new(1, 1);
    private readonly Dictionary<long, PyrusFormSchema> _schemas = [];
    private string? _token;
    private string _api = DefaultApi;

    public PyrusClient(HttpClient http, AppOptions options, ILogger<PyrusClient> log)
    {
        _http = http;
        _options = options;
        _log = log;
    }

    public bool Enabled => _options.PyrusEnabled;

    public async Task<PyrusFormSchema?> SchemaAsync(long formId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        lock (_schemas)
        {
            if (_schemas.TryGetValue(formId, out var cached))
            {
                return cached;
            }
        }

        // Кэш по форме: заявки и кадровый реестр — разные формы, общий кэш
        // перетирал бы одну схему другой.
        await _schemaLock.WaitAsync(ct);
        try
        {
            lock (_schemas)
            {
                if (_schemas.TryGetValue(formId, out var again))
                {
                    return again;
                }
            }

            var body = await CallAsync(HttpMethod.Get, $"/forms/{formId}", null, ct);
            if (body is null)
            {
                return null;
            }

            var ids = new Dictionary<string, int>(StringComparer.Ordinal);
            var types = new Dictionary<string, string>(StringComparer.Ordinal);
            var choices = new Dictionary<string, IReadOnlyDictionary<string, int>>(StringComparer.Ordinal);
            foreach (var field in FlattenSchema(body.Value.TryGetProperty("fields", out var fields) ? fields : default))
            {
                var name = field.TryGetProperty("name", out var n) ? n.GetString()?.Trim() : null;
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }

                ids[name] = field.GetProperty("id").GetInt32();
                types[name] = field.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
                if (!field.TryGetProperty("info", out var info) || !info.TryGetProperty("options", out var options)
                    || options.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var byValue = new Dictionary<string, int>(StringComparer.Ordinal);
                foreach (var option in options.EnumerateArray())
                {
                    if (option.TryGetProperty("deleted", out var deleted) && deleted.ValueKind == JsonValueKind.True)
                    {
                        continue;
                    }

                    var value = option.TryGetProperty("choice_value", out var v) ? v.GetString()?.Trim() : null;
                    if (!string.IsNullOrEmpty(value))
                    {
                        byValue[value] = option.GetProperty("choice_id").GetInt32();
                    }
                }

                if (byValue.Count > 0)
                {
                    choices[name] = byValue;
                }
            }

            var schema = new PyrusFormSchema { FieldIds = ids, FieldTypes = types, Choices = choices };
            lock (_schemas)
            {
                _schemas[formId] = schema;
            }

            _log.LogInformation("Pyrus: схема формы {FormId} прочитана, полей {Count}", formId, ids.Count);
            return schema;
        }
        finally
        {
            _schemaLock.Release();
        }
    }

    public async Task<long?> CreateFormTaskAsync(long formId, IReadOnlyDictionary<string, object?> values, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        var fields = await FieldValuesAsync(formId, values, ct);
        if (fields.Count == 0)
        {
            return null;
        }

        var body = await CallAsync(HttpMethod.Post, "/tasks", new { form_id = formId, fields }, ct);
        if (body is { } b && b.TryGetProperty("task", out var task) && task.TryGetProperty("id", out var id))
        {
            var taskId = id.GetInt64();
            _log.LogInformation("Pyrus: создана задача {TaskId} по форме {FormId}", taskId, formId);
            return taskId;
        }

        return null;
    }

    public async Task<bool> CommentAsync(long taskId, PyrusCommentRequest request, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return false;
        }

        var payload = new Dictionary<string, object?>();
        if (request.Text.Length > 0)
        {
            payload["text"] = request.Text;
        }

        if (request.SetFields is { Count: > 0 })
        {
            var formId = request.FormId ?? throw new ArgumentException("Для field_updates нужен FormId", nameof(request));
            var updates = await FieldValuesAsync(formId, request.SetFields, ct);
            if (updates.Count > 0)
            {
                payload["field_updates"] = updates;
            }
        }

        if (!string.IsNullOrEmpty(request.Action))
        {
            payload["action"] = request.Action;
        }

        if (request.AttachmentGuids is { Count: > 0 })
        {
            payload["attachments"] = request.AttachmentGuids.Select(g => new { guid = g }).ToList();
        }

        if (payload.Count == 0)
        {
            return false;
        }

        return await CallAsync(HttpMethod.Post, $"/tasks/{taskId}/comments", payload, ct) is not null;
    }

    public async Task<PyrusTask?> GetTaskAsync(long taskId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        var body = await CallAsync(HttpMethod.Get, $"/tasks/{taskId}", null, ct, notFoundIsNull: true);
        if (body is not { } b || !b.TryGetProperty("task", out var task))
        {
            return null;
        }

        return task.Deserialize<PyrusTask>(Json);
    }

    public async Task<IReadOnlyList<PyrusTask>> RegisterAsync(long formId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return [];
        }

        var body = await CallAsync(HttpMethod.Post, $"/forms/{formId}/register", new { include_archived = true }, ct);
        if (body is not { } b || !b.TryGetProperty("tasks", out var tasks))
        {
            return [];
        }

        return tasks.Deserialize<List<PyrusTask>>(Json) ?? [];
    }

    public async Task<string?> UploadFileAsync(string fileName, Stream content, string contentType, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        var token = await TokenAsync(ct);
        using var form = new MultipartFormDataContent();
        var part = new StreamContent(content);
        part.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(part, "file", fileName);
        using var request = new HttpRequestMessage(HttpMethod.Post, _api + "/files/upload") { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await SendAsync(request, ct);
        var body = await ReadJsonAsync(response, ct);
        if (!response.IsSuccessStatusCode || body is not { } b || !b.TryGetProperty("guid", out var guid))
        {
            _log.LogWarning("Pyrus: файл {Name} не загрузился ({Status})", fileName, (int)response.StatusCode);
            return null;
        }

        return guid.GetString();
    }

    public async Task<HttpResponseMessage?> DownloadAsync(string url, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return null;
        }

        var token = await TokenAsync(ct);
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        try
        {
            return await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e)
        {
            throw new PyrusException($"Pyrus: файл {url} недоступен", e);
        }
    }

    public async Task<IReadOnlyList<CatalogItem>> CatalogItemsAsync(long catalogId, CancellationToken ct = default)
    {
        if (!Enabled)
        {
            return [];
        }

        var body = await CallAsync(HttpMethod.Get, $"/catalogs/{catalogId}", null, ct);
        if (body is not { } b || !b.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<CatalogItem>();
        foreach (var item in items.EnumerateArray())
        {
            if (!item.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() == 0)
            {
                continue;
            }

            var name = values[0].GetString()?.Trim();
            if (!string.IsNullOrEmpty(name))
            {
                result.Add(new CatalogItem(item.GetProperty("item_id").GetInt64(), name));
            }
        }

        return result;
    }

    /// <summary>
    /// {название поля: значение} → список {id, value} для API. Общий для создания
    /// задачи и для field_updates: пустое не отправляется, поле выбора получает
    /// choice_id, справочник — item_id, чужое название уходит в лог.
    /// </summary>
    private async Task<List<object>> FieldValuesAsync(long formId, IReadOnlyDictionary<string, object?> values, CancellationToken ct)
    {
        var schema = await SchemaAsync(formId, ct);
        var result = new List<object>();
        if (schema is null)
        {
            return result;
        }

        foreach (var (name, raw) in values)
        {
            var value = raw;
            if (value is null || value is string { Length: 0 })
            {
                continue;
            }

            if (!schema.FieldIds.TryGetValue(name, out var fieldId))
            {
                _log.LogWarning("Pyrus: в форме нет поля «{Name}» — значение не отправлено", name);
                continue;
            }

            if (schema.FieldTypes.TryGetValue(name, out var type) && type == "catalog")
            {
                // Справочник принимает id позиции. Текст сюда не положить — он
                // остаётся в описании, а поле пустует, пока проекта нет в
                // справочнике; это честнее, чем «похожая» позиция.
                var itemId = (value as CatalogValue)?.ItemId;
                if (itemId is > 0)
                {
                    result.Add(new { id = fieldId, value = new { item_id = itemId } });
                }
                else
                {
                    _log.LogInformation("Pyrus: поле «{Name}» — справочник, текст не отправлен", name);
                }

                continue;
            }

            if (value is CatalogValue catalog)
            {
                if (string.IsNullOrEmpty(catalog.Text))
                {
                    continue;
                }

                value = catalog.Text;
            }

            if (schema.Choices.TryGetValue(name, out var options))
            {
                var label = Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
                if (!options.TryGetValue(label, out var choiceId))
                {
                    _log.LogWarning("Pyrus: в поле «{Name}» нет варианта «{Value}»", name, label);
                    continue;
                }

                result.Add(new { id = fieldId, value = new { choice_id = choiceId } });
            }
            else
            {
                result.Add(new { id = fieldId, value });
            }
        }

        return result;
    }

    private static IEnumerable<JsonElement> FlattenSchema(JsonElement fields)
    {
        if (fields.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }

        foreach (var field in fields.EnumerateArray())
        {
            yield return field;
            // На доске отдела поля лежат внутри разделов («Инфо», «Задача») —
            // Pyrus отдаёт их как info.fields поля типа title.
            if (field.TryGetProperty("info", out var info) && info.TryGetProperty("fields", out var nested))
            {
                foreach (var child in FlattenSchema(nested))
                {
                    yield return child;
                }
            }
        }
    }

    private async Task<string> TokenAsync(CancellationToken ct)
    {
        if (_token is { } cached)
        {
            return cached;
        }

        await _authLock.WaitAsync(ct);
        try
        {
            if (_token is { } again)
            {
                return again;
            }

            using var response = await _http.PostAsJsonAsync(
                AuthUrl, new { login = _options.PyrusLogin, security_key = _options.PyrusSecurityKey }, ct);
            var body = await ReadJsonAsync(response, ct);
            if (!response.IsSuccessStatusCode || body is not { } b || !b.TryGetProperty("access_token", out var token))
            {
                throw new PyrusException($"Pyrus: авторизация не удалась ({(int)response.StatusCode})");
            }

            _token = token.GetString();
            // Pyrus может вернуть свой адрес API (у крупных аккаунтов он отличается).
            _api = (b.TryGetProperty("api_url", out var api) ? api.GetString() : null)?.TrimEnd('/') ?? DefaultApi;
            return _token!;
        }
        catch (HttpRequestException e)
        {
            throw new PyrusException("Pyrus: авторизация недоступна", e);
        }
        finally
        {
            _authLock.Release();
        }
    }

    /// <summary>Запрос с одной повторной попыткой после переавторизации по 401.</summary>
    private async Task<JsonElement?> CallAsync(HttpMethod method, string path, object? payload, CancellationToken ct, bool notFoundIsNull = false)
    {
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            var token = await TokenAsync(ct);
            using var request = new HttpRequestMessage(method, _api + path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (payload is not null)
            {
                request.Content = JsonContent.Create(payload, options: Json);
            }

            using var response = await SendAsync(request, ct);
            var body = await ReadJsonAsync(response, ct);
            if (response.IsSuccessStatusCode)
            {
                return body;
            }

            if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 1)
            {
                _token = null;
                continue;
            }

            if (notFoundIsNull && response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
            {
                return null;
            }

            _log.LogWarning("Pyrus: {Path} ответил {Status}: {Body}", path, (int)response.StatusCode, body?.GetRawText());
            throw new PyrusException($"Pyrus: {path} ответил {(int)response.StatusCode}");
        }

        throw new PyrusException($"Pyrus: {path} недоступен");
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            return await _http.SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw new PyrusException($"Pyrus: {request.RequestUri} недоступен", e);
        }
        catch (TaskCanceledException e) when (!ct.IsCancellationRequested)
        {
            throw new PyrusException($"Pyrus: {request.RequestUri} не ответил вовремя", e);
        }
    }

    private static async Task<JsonElement?> ReadJsonAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
