import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCases, toCases } from "@/app/_lib/cases";

type Row = {
  key: string;
  title: string;
  hint: string;
  eta: string;
  image_front: string;
  image_back: string | null;
};

function row(over: Partial<Row> = {}): Row {
  return {
    key: "unique",
    title: "Много уникальных элементов",
    hint: "Панели не повторяются",
    eta: "2 – 3 дня",
    image_front: "https://example.test/unique.jpg",
    image_back: "https://example.test/unique-back.jpg",
    ...over,
  };
}

function respondWith(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toCases", () => {
  it("дописывает иконку срока — на карточке eta показывается уже с ней", () => {
    expect(toCases([row({ eta: "1 день" })])[0].eta).toBe("⏱ 1 день");
  });

  it("переименовывает поля картинок под нужды карточки", () => {
    const [c] = toCases([row()]);
    expect(c.frontImg).toBe("https://example.test/unique.jpg");
    expect(c.backImg).toBe("https://example.test/unique-back.jpg");
  });

  it("считает пустую обратную картинку отсутствующей — иначе будет битый <img>", () => {
    expect(toCases([row({ image_back: "" })])[0].backImg).toBeNull();
    expect(toCases([row({ image_back: null })])[0].backImg).toBeNull();
  });

  it("сохраняет порядок строк — им задаётся порядок колоды", () => {
    const cases = toCases([row({ key: "a" }), row({ key: "b" })]);
    expect(cases.map((c) => c.key)).toEqual(["a", "b"]);
  });
});

describe("fetchCases", () => {
  it("запрашивает карточки у своего роута и не носит ключей в браузере", async () => {
    const fetchMock = respondWith({ rows: [row()] });
    await fetchCases();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/topics/");
    // Кеша нет намеренно: контент правят в дашборде Supabase и ждут увидеть
    // правку при следующем открытии.
    expect(init.cache).toBe("no-store");
    // Ключ Supabase остался на сервере — в запросе из браузера его быть не
    // должно, иначе он снова попадёт в бандл.
    expect(init.headers).toBeUndefined();
  });

  it("возвращает готовые к отрисовке карточки", async () => {
    respondWith({ rows: [row({ key: "curved", eta: "2 дня" })] });
    const cases = await fetchCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ key: "curved", eta: "⏱ 2 дня" });
  });

  it("падает с кодом ответа, если Supabase отказал", async () => {
    respondWith({ error: "нет доступа" }, false, 401);
    // 401 здесь не абстрактный: так проявляется таблица без GRANT SELECT для anon.
    await expect(fetchCases()).rejects.toThrow("HTTP 401");
  });

  it("падает на пустой таблице — показывать пустую колоду хуже, чем сказать о сбое", async () => {
    respondWith({ rows: [] });
    await expect(fetchCases()).rejects.toThrow(/не пришли/);
  });

  it("прокидывает signal, чтобы запрос отменялся при размонтировании", async () => {
    const fetchMock = respondWith({ rows: [row()] });
    const controller = new AbortController();
    await fetchCases({ signal: controller.signal });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
