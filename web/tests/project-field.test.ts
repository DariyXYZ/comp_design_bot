import { describe, expect, it } from "vitest";
import {
  exactProject,
  matchProjects,
  normalizeProject,
} from "@/features/requests/components/project-field";

const OPTIONS = [
  { id: 1, name: "1-19-2026 MR Group АГК БЦ Верейская" },
  { id: 2, name: "1-39-2026 MR Школа Верейская 29" },
  { id: 3, name: "1-34-2026 ФСК Шеногина Сидней" },
  { id: 4, name: "1_53_2025_Архплей_Силикатный" },
];

describe("normalizeProject", () => {
  it("уравнивает регистр, ё, подчёркивания и пробелы", () => {
    expect(normalizeProject("1-19-2026  МР Верейская БЦ")).toBe("1 19 2026 мр верейская бц");
    expect(normalizeProject("1_53_2025_Архплей_Силикатный")).toBe("1 53 2025 архплей силикатный");
    expect(normalizeProject("Ёлки")).toBe("елки");
  });
});

describe("matchProjects", () => {
  it("пусто без ввода", () => {
    expect(matchProjects(OPTIONS, "  ")).toEqual([]);
  });
  it("сначала совпадения с начала, потом по вхождению", () => {
    expect(matchProjects(OPTIONS, "1-19").map((o) => o.id)).toEqual([1]);
    expect(matchProjects(OPTIONS, "верейск").map((o) => o.id)).toEqual([1, 2]);
  });
  it("не зависит от регистра и разделителей", () => {
    expect(matchProjects(OPTIONS, "1 53 2025 архплей").map((o) => o.id)).toEqual([4]);
  });
});

describe("exactProject", () => {
  it("находит каноническое написание по вводу в другом регистре", () => {
    expect(exactProject(OPTIONS, "1-19-2026 mr group агк бц верейская")?.id).toBe(1);
    expect(exactProject(OPTIONS, "1-19-2026")).toBeUndefined();
  });
});
