'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch, jsonOrThrow } from '@/lib/api';
import type { CharacterSummary, UploadResult } from '@/lib/api-types';
import styles from './studio.module.css';

/** One reference of a composed start photo: a photo of this machine, imported or made here. */
export type ComposeSlot = { imageRef: string; url: string; personal: boolean };
export type ComposeRole = 'character' | 'location' | 'product';
export type ComposeState = { on: boolean } & Partial<Record<ComposeRole, ComposeSlot>>;

export const COMPOSE_OFF: ComposeState = { on: false };
const ROLES: [ComposeRole, MessageKey, MessageKey][] = [
  ['character', 'composeCharacter', 'composeCharacterHint'],
  ['location', 'composeLocation', 'composeLocationHint'],
  ['product', 'composeProduct', 'composeProductHint'],
];

const filled = (state: ComposeState) => ROLES.map(([role]) => state[role]).filter((slot): slot is ComposeSlot => Boolean(slot));

/** A composition renders once two of the three slots hold a photo. */
export const composeReady = (state: ComposeState) => state.on && filled(state).length >= 2;
/** Any photo someone imported asks for consent, as for a one-photo effect. */
export const composePersonal = (state: ComposeState) => filled(state).some((slot) => slot.personal);
/** What POST /api/effects takes as `compose`. */
export const composeBody = (state: ComposeState) =>
  Object.fromEntries(ROLES.flatMap(([role]) => (state[role] ? [[role, state[role]!.imageRef]] : [])));

function Slot({
  role,
  label,
  hint,
  slot,
  characters,
  disabled,
  onSlot,
}: {
  role: ComposeRole;
  label: MessageKey;
  hint: MessageKey;
  slot?: ComposeSlot;
  characters: CharacterSummary[];
  disabled: boolean;
  onSlot: (slot: ComposeSlot | undefined) => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const upload = async (file: File) => {
    setFailed(false);
    const form = new FormData();
    form.append('image', file);
    const res = await apiFetch('/api/uploads', { method: 'POST', body: form }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    const meta = (await res.json()) as UploadResult;
    onSlot({ imageRef: meta.imageRef, url: `/media/data/${meta.imageRef}`, personal: meta.personal });
  };
  // A saved character's portrait or pictures: made from a text here, never personal.
  const pictures = role === 'character' ? characters.flatMap((character) => [
    { key: character.imageRef, name: character.name, imageRef: character.imageRef, url: character.imageUrl },
    ...character.photos.map((photo, index) => ({ key: photo.imageRef, name: `${character.name} · ${index + 1}`, imageRef: photo.imageRef, url: photo.url })),
  ]) : [];
  const inputId = `compose-${role}`;
  return (
    <div className={styles.composeSlot}>
      <div className={styles.composeThumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local reference photo */}
        {slot ? <img src={slot.url} alt="" /> : <span aria-hidden="true">+</span>}
      </div>
      <div className={styles.composeText}>
        <span className={styles.sectionTitle}>{t(label)}</span>
        <span className={styles.hint}>{t(hint)}</span>
        <div className={styles.composeActions}>
          <input
            id={inputId}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <label htmlFor={inputId} className={styles.chip} aria-disabled={disabled || undefined}>
            {slot ? t('composeReplace') : t('composeAdd')}
          </label>
          {pictures.length > 0 && (
            <select
              className={styles.composeSelect}
              aria-label={t('composeFromCharacters')}
              value=""
              disabled={disabled}
              onChange={(event) => {
                const picked = pictures.find((picture) => picture.key === event.target.value);
                if (picked) onSlot({ imageRef: picked.imageRef, url: picked.url, personal: false });
              }}
            >
              <option value="">{t('composeFromCharacters')}</option>
              {pictures.map((picture) => (
                <option key={picture.key} value={picture.key}>
                  {picture.name}
                </option>
              ))}
            </select>
          )}
          {slot && (
            <button type="button" className={styles.chip} disabled={disabled} onClick={() => onSlot(undefined)}>
              {t('composeRemove')}
            </button>
          )}
        </div>
        {failed && (
          <span className={styles.photoError} role="alert">
            {t('composeUploadFailed')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * An effect's start photo composed from a character, a place and a product: two at least. The edit
 * puts them together first (the place gives the frame), then the effect animates that photo.
 */
export function ComposeSlots({ value, onChange, disabled }: { value: ComposeState; onChange: Dispatch<SetStateAction<ComposeState>>; disabled: boolean }) {
  const { t } = useI18n();
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  useEffect(() => {
    if (!value.on) return;
    let alive = true;
    apiFetch('/api/characters')
      .then((res) => jsonOrThrow<CharacterSummary[]>(res))
      .then((list) => alive && setCharacters(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [value.on]);
  const count = filled(value).length;
  return (
    <div className={styles.panelSection}>
      <div className={styles.styleRow}>
        <span className={styles.styleLabel} aria-hidden="true">
          {t('composeLabel')}
        </span>
        <button type="button" className={styles.chip} aria-pressed={value.on} disabled={disabled} onClick={() => onChange((current) => ({ ...current, on: !current.on }))}>
          {t('composeToggle')}
        </button>
      </div>
      {value.on && (
        <>
          <p className={styles.hint}>{t('composeLead')}</p>
          {ROLES.map(([role, label, hint]) => (
            <Slot
              key={role}
              role={role}
              label={label}
              hint={hint}
              {...(value[role] ? { slot: value[role] } : {})}
              characters={characters}
              disabled={disabled}
              onSlot={(slot) => onChange((current) => ({ ...current, [role]: slot }))}
            />
          ))}
          <p className={styles.hint} role="status">
            {count >= 2 ? t('composeReadyHint', { n: count }) : t('composeNeedsTwo')}
          </p>
        </>
      )}
    </div>
  );
}
