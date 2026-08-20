"use client";

import { useSearchParams } from "next/navigation";
import { ActionBar } from "@/components/action-bar";
import { Screen } from "@/components/screen";
import { StageTrack } from "@/components/stage-track";
import { REQUEST_STAGES, myRequestById, type MyRequest } from "@/lib/mock/materials";
import { routes } from "@/lib/routes";

/**
 * Карточка заявки: где она сейчас и что с ней можно сделать.
 *
 * Действий у заявки много, но одновременно уместно ровно одно главное — оно
 * зависит от состояния и стоит внизу, там же, где на других экранах «создать
 * заявку». Остальное лежит списком: в вайрфрейме шесть кнопок кричали
 * одинаково, и «принять результат» ничем не отличалось от «отменить заявку».
 */
export function RequestCard() {
  const id = useSearchParams().get("id") ?? "";
  const request = myRequestById(id);

  if (!request) {
    return (
      <Screen title="Заявка не найдена" backHref={routes.myRequests}>
        <p className="section-note">Вернитесь к списку и откройте заявку заново.</p>
      </Screen>
    );
  }

  const { primary, secondary } = actionsFor(request);

  return (
    <>
      <Screen
        title={request.title}
        subtitle={`№ ${request.id.replace("r-", "")} · ${request.when}`}
        backHref={routes.myRequests}
      >
        {request.flag ? (
          <div className="banner">
            <strong>{request.flag}</strong>
            <span>
              {request.flag === "Требуется уточнение"
                ? "Отдел задал вопрос — без ответа заявка стоит"
                : "Замечания приняты, отдел готовит новую версию"}
            </span>
          </div>
        ) : null}

        {request.watching ? (
          <div className="banner banner-quiet">
            <strong>Вы отслеживаете задачу отдела</strong>
            <span>Это не ваша заявка — видно статус, детали скрыты</span>
          </div>
        ) : null}

        <StageTrack stage={request.stage} />
        <p className="section-note">
          Сейчас: {REQUEST_STAGES[request.stage]}
        </p>

        <div className="fact">
          <span className="fact-key">Заявка по</span>
          <span className="fact-value">{request.originLabel}</span>
        </div>
        <div className="fact">
          <span className="fact-key">Проект</span>
          <span className="fact-value">{request.project}</span>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Ещё можно</h2>
          </div>
          <div className="rows">
            {secondary.map((label) => (
              <button key={label} type="button" className="row-action">
                <span>{label}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      </Screen>

      <ActionBar href={routes.myRequests} label={primary} />
    </>
  );
}

/**
 * Какое действие главное при этом состоянии.
 *
 * Уточнение важнее всего: пока на вопрос не ответили, заявка не двигается,
 * поэтому оно перебивает и «в работе», и «результат готов».
 */
function actionsFor(request: MyRequest): {
  primary: string;
  secondary: readonly string[];
} {
  if (request.watching) {
    return {
      primary: "Отписаться от задачи",
      secondary: ["Связаться с исполнителем", "Создать свою заявку"],
    };
  }
  if (request.flag === "Требуется уточнение") {
    return {
      primary: "Ответить на уточнение",
      secondary: ["Приложить материалы", "Отменить заявку"],
    };
  }
  if (request.flag === "На доработке") {
    return {
      primary: "Посмотреть замечания",
      secondary: ["Связаться с исполнителем"],
    };
  }
  if (request.stage >= 3) {
    return {
      primary: "Принять результат",
      secondary: ["Есть замечания — вернуть на доработку", "Связаться с исполнителем"],
    };
  }
  if (request.stage === 2) {
    return {
      primary: "Связаться с исполнителем",
      secondary: ["Дополнить заявку", "Отменить заявку"],
    };
  }
  return {
    primary: "Дополнить заявку",
    secondary: ["Отменить заявку"],
  };
}
