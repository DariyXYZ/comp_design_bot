using System.Text.Json;
using System.Text.Json.Serialization;

namespace CompDesignBot.Infrastructure.Pyrus;

/// <summary>Задача Pyrus в том виде, в каком её отдаёт <c>/tasks/{id}</c> и реестр формы.</summary>
public sealed class PyrusTask
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("create_date")] public string? CreateDate { get; init; }
    [JsonPropertyName("close_date")] public string? CloseDate { get; init; }
    [JsonPropertyName("is_closed")] public bool? IsClosed { get; init; }
    [JsonPropertyName("fields")] public List<PyrusField> Fields { get; init; } = [];
    [JsonPropertyName("attachments")] public List<PyrusAttachment> Attachments { get; init; } = [];
    [JsonPropertyName("comments")] public List<PyrusComment> Comments { get; init; } = [];

    public bool Closed => IsClosed == true || !string.IsNullOrEmpty(CloseDate);

    /// <summary>
    /// Поля одним списком, включая вложенные в разделы: у поля-раздела значение —
    /// <c>{fields: [...]}</c>, и плоский обход их не видит.
    /// </summary>
    public IEnumerable<PyrusField> FlatFields() => Flatten(Fields);

    private static IEnumerable<PyrusField> Flatten(IEnumerable<PyrusField> fields)
    {
        foreach (var field in fields)
        {
            yield return field;
            if (field.Value is { ValueKind: JsonValueKind.Object } value
                && value.TryGetProperty("fields", out var nested)
                && nested.ValueKind == JsonValueKind.Array)
            {
                var inner = nested.Deserialize<List<PyrusField>>() ?? [];
                foreach (var child in Flatten(inner))
                {
                    yield return child;
                }
            }
        }
    }

    /// <summary>Значения полей по названию; для полей выбора — подпись варианта.</summary>
    public Dictionary<string, string?> ValuesByName()
    {
        var result = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var field in FlatFields())
        {
            if (string.IsNullOrEmpty(field.Name))
            {
                continue;
            }

            if (field.Value is { ValueKind: JsonValueKind.Object } obj && obj.TryGetProperty("fields", out _))
            {
                continue;
            }

            result[field.Name.Trim()] = PyrusField.Plain(field.Value);
        }

        return result;
    }
}

public sealed class PyrusField
{
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("type")] public string? Type { get; init; }
    [JsonPropertyName("value")] public JsonElement? Value { get; init; }

    /// <summary>Значение как строка: текст, число, подпись варианта выбора; <c>null</c> для пустого.</summary>
    public static string? Plain(JsonElement? value)
    {
        if (value is not { } element)
        {
            return null;
        }

        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                return element.GetRawText();
            case JsonValueKind.True:
            case JsonValueKind.False:
                return element.GetRawText();
            case JsonValueKind.Object:
                if (element.TryGetProperty("choice_names", out var names)
                    && names.ValueKind == JsonValueKind.Array
                    && names.GetArrayLength() > 0)
                {
                    return names[0].GetString();
                }

                if (element.TryGetProperty("choice_value", out var choice))
                {
                    return choice.GetString();
                }

                return null;
            default:
                return null;
        }
    }
}

public sealed class PyrusAttachment
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("url")] public string? Url { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("size")] public long? Size { get; init; }
}

public sealed class PyrusComment
{
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("attachments")] public List<PyrusAttachment> Attachments { get; init; } = [];
}

/// <summary>Схема одной формы: поля по названию, их типы и варианты полей выбора.</summary>
public sealed class PyrusFormSchema
{
    public required IReadOnlyDictionary<string, int> FieldIds { get; init; }
    public required IReadOnlyDictionary<string, string> FieldTypes { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyDictionary<string, int>> Choices { get; init; }
}

/// <summary>
/// Значение поля, которое в форме может быть и текстом, и справочником:
/// текст — для текстового поля, id позиции — для справочника.
/// </summary>
public sealed record CatalogValue(string? Text, long? ItemId);

public sealed record CatalogItem(long Id, string Name);
