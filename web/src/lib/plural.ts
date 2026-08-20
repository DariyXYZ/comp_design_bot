/**
 * Русская форма существительного по числу.
 *
 * Нужна там, где счётчик приходит из данных: «1 задача», «2 задачи»,
 * «7 задач» — подставлять одну форму на все числа нельзя.
 */
export function plural(
  count: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = count % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
