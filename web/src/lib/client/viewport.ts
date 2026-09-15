/**
 * Высота фрейма Mini App, устойчивая к клавиатуре.
 *
 * Проблема: когда фокус попадает в поле ввода, клиент Telegram ужимает фрейм
 * под клавиатуру и присылает серию `viewportChanged` (сначала нестабильных,
 * потом стабильное), а на Android ещё и `window.resize`. Всё, что считало
 * размеры от высоты фрейма — карточка колоды, положения шторки — пересчитывало
 * себя на каждом событии: интерфейс уезжал вниз и возвращался, как глюк.
 *
 * Решение: пока открыта клавиатура (в фокусе поле ввода), «базовая» высота
 * фрейма заморожена на последнем значении без клавиатуры. От неё считается всё,
 * что клавиатуре не подчиняется (карточка, нижнее положение шторки). Живую
 * высоту с клавиатурой берёт только тот, кому она нужна, — развёрнутая шторка,
 * чтобы поле ввода и кнопка не ушли под клавиатуру.
 *
 * Значение публикуется в `--app-h` для CSS: там оно заменяет `100svh` и
 * `--tg-viewport-stable-height`, которые в вебвью меняются вместе с
 * клавиатурой.
 */

let baseHeight = 0;
let installed = false;

export function editableFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable === true
  );
}

/** Высота фрейма прямо сейчас — с учётом открытой клавиатуры. */
export function liveFrameHeight(): number {
  const reported = window.Telegram?.WebApp?.viewportHeight;
  return typeof reported === "number" && reported > 0 ? reported : window.innerHeight;
}

/** Высота фрейма без клавиатуры: последнее значение, снятое при пустом фокусе. */
export function stableFrameHeight(): number {
  if (!baseHeight || !editableFocused()) {
    const tg = window.Telegram?.WebApp;
    const reported = tg?.viewportStableHeight ?? tg?.viewportHeight;
    const fresh =
      typeof reported === "number" && reported > 0 ? reported : window.innerHeight;
    // Пока клавиатура открыта, свежее значение — уже ужатое; берём его только
    // если базы нет вовсе (первый рендер прямо в поле — редкость, но не ноль).
    if (!editableFocused() || !baseHeight) baseHeight = fresh;
  }
  return baseHeight;
}

/**
 * Стабильно ли событие клиента. `viewportChanged` приходит с
 * `{ isStateStable }`; пока анимация фрейма не закончилась, размеры промежуточные
 * и перекладывать по ним интерфейс — значит показать каждый кадр анимации.
 */
export function eventIsStable(arg: unknown): boolean {
  if (arg && typeof arg === "object" && "isStateStable" in arg) {
    return (arg as { isStateStable?: boolean }).isStateStable !== false;
  }
  return true;
}

function publish() {
  document.documentElement.style.setProperty("--app-h", `${stableFrameHeight()}px`);
}

/** Один раз на приложение: следит за фреймом и держит `--app-h` актуальным. */
export function installViewport(): () => void {
  if (installed) return () => {};
  installed = true;
  publish();
  const onChange = (arg?: unknown) => {
    if (!eventIsStable(arg)) return;
    publish();
  };
  window.addEventListener("resize", onChange);
  // Клавиатура закрылась: фокус ушёл, и следующее событие уже без неё. Но
  // событие может прийти раньше blur — перепубликуем и на blur тоже.
  const onBlur = () => window.setTimeout(publish, 50);
  document.addEventListener("focusout", onBlur);
  const tg = window.Telegram?.WebApp;
  tg?.onEvent?.("viewportChanged", onChange);
  return () => {
    installed = false;
    window.removeEventListener("resize", onChange);
    document.removeEventListener("focusout", onBlur);
    tg?.offEvent?.("viewportChanged", onChange);
  };
}
