"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { materialById } from "@/features/materials";
import type { UploadedPhoto } from "./photos";

/**
 * Черновик заявки, живущий выше экранов.
 *
 * Раньше форма была отдельным маршрутом, и её состояние умирало на каждом
 * переходе: посмотреть соседний кейс значило потерять набранное описание.
 * Поэтому уход с формы приходилось охранять вопросом «выйти?» — защита от
 * архитектуры, а не от ошибки пользователя.
 *
 * Теперь форма — шторка над главным экраном, а её содержимое лежит здесь, в
 * оболочке приложения. Колоду можно листать, в поток и профиль можно сходить,
 * материал можно открыть — набранное остаётся на месте. Пропадает оно только
 * вместе с приложением, и об этом Telegram спрашивает сам
 * (`enableClosingConfirmation`).
 *
 * Что именно тут хранится:
 *
 * - поля формы;
 * - картинки (уже загруженные в Pyrus, с локальным превью);
 * - **основа заявки** — из чего она: карточка колоды или конкретное решение.
 *
 * Основа устроена двухслойно и это главное решение всего файла. Тема идёт
 * следом за колодой: что сейчас наверху, по тому и заявка — человек листает и
 * останавливается на подходящем. Решение закрепляется явно (чипом в шторке
 * или кнопкой с экрана материала) и колоду больше не слушает: закреплённое
 * человек выбрал руками, и подменять его свайпом было бы враньём.
 */

/** Тема колоды в том объёме, в каком она нужна заявке. */
export type DraftTopic = { key: string; title: string };

/** Насколько шторка открыта. Значения — снапы, между ними её не оставляют. */
export type SheetSnap = "peek" | "half" | "full";

export type DraftFields = {
  project: string;
  description: string;
  source: string;
  deadline: string;
};

const EMPTY_FIELDS: DraftFields = {
  project: "",
  description: "",
  source: "",
  deadline: "",
};

type DraftStore = {
  fields: DraftFields;
  setField: <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => void;

  photos: readonly UploadedPhoto[];
  addPhoto: (photo: UploadedPhoto) => void;
  removePhoto: (id: string) => void;

  /** Тема, на которой стоит колода. Обновляется свайпом. */
  topic: DraftTopic | null;
  setTopic: (topic: DraftTopic) => void;
  /**
   * Тема, с которой колода должна открыться.
   *
   * Нужна дважды: при возврате с другого экрана (колода монтируется заново и
   * без подсказки начала бы с первой карточки, молча сменив основу заявки) и
   * при переходе по прямой ссылке `/request/?topic=…`.
   *
   * Функция, а не значение: её читают один раз, когда колода уже смонтирована
   * и получила карточки. Значение в контексте пришлось бы обновлять на каждый
   * свайп, перерисовывая ради этого всё приложение.
   */
  readInitialTopicKey: () => string | null;
  requestTopic: (key: string, title?: string) => void;

  /** Закреплённое решение. `null` — заявка по теме карточки. */
  materialId: string | null;
  pinMaterial: (id: string | null) => void;

  snap: SheetSnap;
  setSnap: (snap: SheetSnap) => void;

  /** Есть ли что терять: от этого зависит вопрос при закрытии приложения. */
  filled: boolean;
  /** После успешной отправки — чтобы вернувшийся не увидел чужой черновик. */
  reset: () => void;
};

const Context = createContext<DraftStore | null>(null);

export function RequestDraftProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [photos, setPhotos] = useState<readonly UploadedPhoto[]>([]);
  const [topic, setTopicState] = useState<DraftTopic | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [snap, setSnap] = useState<SheetSnap>("half");

  // Стартовая тема колоды — в ref, а не в состоянии: её читают один раз на
  // монтировании колоды, и перерисовывать из-за неё всё приложение незачем.
  const initialTopicKey = useRef<string | null>(null);

  const setField = useCallback<DraftStore["setField"]>((key, value) => {
    setFields((current) => ({ ...current, [key]: value }));
  }, []);

  /**
   * Колода сообщает, какая карточка сейчас наверху.
   *
   * Здесь же снимается закреплённое решение, если оно с другой темы. Свайп на
   * соседнюю карточку — это смена предмета заявки, и оставить под ней решение
   * от предыдущей темы значило бы отправить в отдел противоречие. Ключ тот же
   * (колода перемонтировалась и объявила ту же тему) — ничего не трогаем.
   */
  const setTopic = useCallback((next: DraftTopic) => {
    initialTopicKey.current = next.key;
    setTopicState(next);
    setMaterialId((current) => {
      if (!current) return current;
      const material = materialById(current);
      return material && material.topic !== next.key ? null : current;
    });
  }, []);

  const readInitialTopicKey = useCallback(() => initialTopicKey.current, []);

  /**
   * Тема из ссылки снаружи.
   *
   * Ставится и в черновик, а не только в стартовую точку колоды: заявка должна
   * быть отправляемой, даже если карточки не пришли — Supabase бывает
   * недоступен, а тема в ссылке уже есть. Название колода уточнит, когда
   * загрузится; в ссылке оно тоже бывает (`?t=`).
   */
  const requestTopic = useCallback((key: string, title?: string) => {
    initialTopicKey.current = key;
    setTopicState((current) =>
      current?.key === key && current.title ? current : { key, title: title ?? "" },
    );
  }, []);

  const addPhoto = useCallback((photo: UploadedPhoto) => {
    setPhotos((current) => [...current, photo]);
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      // Файл остаётся в хранилище Pyrus, но к задаче не привязывается: удалять
      // его отдельным запросом незачем — он никуда не попадёт.
      if (photo) URL.revokeObjectURL(photo.preview);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  /**
   * Закрепляет решение как основу заявки.
   *
   * Колода едет следом: решение живёт под своей темой, и если закрепили его с
   * экрана материала другой темы, карточка под шторкой должна стать той же.
   * Название темы придёт от колоды, когда та смонтируется, — оно приходит из
   * Supabase, а здесь его взять негде.
   */
  const pinMaterial = useCallback((id: string | null) => {
    setMaterialId(id);
    if (!id) return;
    const material = materialById(id);
    if (!material) return;
    initialTopicKey.current = material.topic;
    setTopicState((current) =>
      current?.key === material.topic ? current : { key: material.topic, title: "" },
    );
  }, []);

  const reset = useCallback(() => {
    setFields(EMPTY_FIELDS);
    setPhotos((current) => {
      for (const photo of current) URL.revokeObjectURL(photo.preview);
      return [];
    });
    setMaterialId(null);
  }, []);

  const filled =
    fields.project.trim().length > 0 ||
    fields.description.trim().length > 0 ||
    fields.source.trim().length > 0 ||
    fields.deadline.length > 0 ||
    photos.length > 0;

  const value = useMemo<DraftStore>(
    () => ({
      fields,
      setField,
      photos,
      addPhoto,
      removePhoto,
      topic,
      setTopic,
      readInitialTopicKey,
      requestTopic,
      materialId,
      pinMaterial,
      snap,
      setSnap,
      filled,
      reset,
    }),
    [
      fields,
      setField,
      photos,
      addPhoto,
      removePhoto,
      topic,
      setTopic,
      readInitialTopicKey,
      requestTopic,
      materialId,
      pinMaterial,
      snap,
      filled,
      reset,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRequestDraft(): DraftStore {
  const store = useContext(Context);
  if (!store) throw new Error("useRequestDraft вне RequestDraftProvider");
  return store;
}
