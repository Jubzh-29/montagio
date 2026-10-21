'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { apiFetch, IS_SHOWCASE, jsonOrThrow } from '@/lib/api';
import type { CharacterSummary, JobSummary } from '@/lib/api-types';
import {
  CHARACTER_TYPES,
  characterPrompt,
  characterTypeKey,
  DEFAULT_SCENES,
  photodumpInstruction,
  photodumpScene,
  SCENES,
  sceneKey,
  scenePhrase,
  type CharacterType,
  type Scene,
} from '@/lib/characters';
import { refusalMessageKey } from '@/lib/refusals';
import { visibleTabs, type Tab } from '@/lib/tabs';
import { useExtensions } from '@/lib/use-extensions';
import { useJob } from '@/lib/use-job';
import { Header } from './Header';
import { ShowcaseFooter } from './ShowcaseFooter';
import styles from './characters.module.css';
import studio from './studio.module.css';

const DETAILS_MAX = 240;
const NAME_MAX = 40;

async function postJson(path: string, body: unknown): Promise<{ ok: true; value: CharacterSummary } | { ok: false; code: string }> {
  try {
    const res = await apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true, value: (await res.json()) as CharacterSummary };
    const answer = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, code: answer.error ?? 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Create a character: a type, a few words, a portrait from Z-Image-Turbo, then a name. */
function CreatePanel({ estimate, onSaved }: { estimate: number; onSaved: (character: CharacterSummary) => void }) {
  const { t } = useI18n();
  const { job, refusal, busy, start, reset } = useJob();
  const [type, setType] = useState<CharacterType>('everyday');
  const [details, setDetails] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const done = job?.state === 'succeeded' && job.outputImageRef && job.outputUrl ? job : null;
  const failed = job?.state === 'failed' || job?.state === 'canceled';
  const percent = job ? Math.round(job.progress * 100) : 0;

  const create = () => {
    if (!details.trim() || busy) return;
    setSaveError(null);
    void start('/api/images', { prompt: characterPrompt(type, details), aspect: '9:16' });
  };

  const save = async () => {
    if (!done || !name.trim() || saving) return;
    setSaving(true);
    const answer = await postJson('/api/characters', { name: name.trim(), type, description: details.trim(), imageRef: done.outputImageRef, jobId: done.id });
    setSaving(false);
    if (!answer.ok) return setSaveError(answer.code);
    onSaved(answer.value);
    setName('');
    setDetails('');
    reset();
  };

  return (
    <section className={styles.panel} aria-labelledby="character-create">
      <h2 id="character-create" className={styles.panelTitle}>
        {t('characterCreateTitle')}
      </h2>
      <p className={studio.hint}>{t('characterFictional')}</p>

      <div className={studio.styleRow} role="radiogroup" aria-label={t('characterTypeLabel')}>
        <span className={studio.styleLabel} aria-hidden="true">
          {t('characterTypeLabel')}
        </span>
        {CHARACTER_TYPES.map((value) => (
          <button key={value} type="button" role="radio" className={studio.chip} aria-checked={type === value} disabled={busy} onClick={() => setType(value)}>
            {t(characterTypeKey(value))}
          </button>
        ))}
      </div>

      <label htmlFor="character-details" className={studio.sectionTitle}>
        {t('characterDetails')}
      </label>
      <textarea
        id="character-details"
        className={studio.prompt}
        rows={3}
        maxLength={DETAILS_MAX}
        placeholder={t('characterDetailsPlaceholder')}
        value={details}
        disabled={busy}
        onChange={(event) => setDetails(event.target.value)}
      />
      <p className={studio.counter}>{t('charCount', { n: details.length, max: DETAILS_MAX })}</p>

      <button type="button" className={studio.buttonPrimary} disabled={!details.trim() || busy} onClick={create}>
        {done ? t('characterAgain', { s: estimate }) : t('characterCreate', { s: estimate })}
      </button>

      {busy && job && (
        <div className={studio.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('running', { p: percent })}>
          <span className={studio.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      )}
      {(refusal || failed) && (
        <p className={studio.photoError} role="alert">
          {refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}
        </p>
      )}

      {done && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the portrait just made */}
          <img className={styles.portrait} src={done.outputUrl} alt="" />
          <label htmlFor="character-name" className={studio.sectionTitle}>
            {t('characterName')}
          </label>
          <input
            id="character-name"
            className={studio.prompt}
            type="text"
            maxLength={NAME_MAX}
            placeholder={t('characterNamePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className={studio.buttonSecondary} disabled={!name.trim() || saving} onClick={() => void save()}>
            {t('characterSave')}
          </button>
          {saveError && (
            <p className={studio.photoError} role="alert">
              {t(refusalMessageKey(saveError))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One picture of a photodump on its way: its own edit job, started once. */
function PhotodumpSlot({
  character,
  scene,
  onDone,
  onDismiss,
}: {
  character: CharacterSummary;
  scene: Scene;
  onDone: (job: JobSummary) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const { job, refusal, start } = useJob();
  const started = useRef(false);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const where = scenePhrase(scene);
    void start('/api/edits', { imageRef: character.imageRef, instruction: photodumpInstruction(where), scene: photodumpScene(character.description, where) });
    // A slot starts its picture once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (job?.state === 'succeeded' && job.outputImageRef && reported.current !== job.id) {
      reported.current = job.id;
      onDone(job);
    }
  }, [job, onDone]);
  const failed = refusal || job?.state === 'failed' || job?.state === 'canceled';
  const percent = job ? Math.round(job.progress * 100) : 0;
  return (
    <li className={styles.slot} data-state={failed ? 'failed' : 'running'}>
      <span className={styles.slotName}>{t(sceneKey(scene))}</span>
      {failed ? (
        <>
          <span className={studio.photoError}>{refusal ? t(refusalMessageKey(refusal)) : t('failed', { error: job?.error ?? '?' })}</span>
          <button type="button" className={studio.buttonGhost} onClick={onDismiss}>
            {t('atelierClose')}
          </button>
        </>
      ) : (
        <span className={styles.slotProgress}>{t('running', { p: percent })}</span>
      )}
    </li>
  );
}

const ANIMATE: [Tab, MessageKey][] = [
  ['camera', 'characterAnimateCamera'],
  ['effects', 'characterAnimateEffect'],
  ['avatar', 'characterAnimateAvatar'],
  ['motion', 'characterAnimateMotion'],
];

/** A picture's ways into the Studio: the tab it opens there, with the picture as the start photo. */
function AnimateLinks({ historyKey, tabs }: { historyKey?: string; tabs: Tab[] }) {
  const { t } = useI18n();
  if (!historyKey) return null;
  return (
    <div className={styles.animate}>
      {ANIMATE.filter(([tab]) => tabs.includes(tab)).map(([tab, key]) => (
        <Link key={tab} className={styles.animateLink} href={`/?tab=${tab}&from=${encodeURIComponent(historyKey)}`}>
          {t(key)}
        </Link>
      ))}
    </div>
  );
}

function CharacterDetail({
  character,
  tabs,
  canEdit,
  editEstimate,
  onChange,
  onDelete,
}: {
  character: CharacterSummary;
  tabs: Tab[];
  canEdit: boolean;
  editEstimate: number;
  onChange: (character: CharacterSummary) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [scenes, setScenes] = useState<Scene[]>([...DEFAULT_SCENES]);
  const [slots, setSlots] = useState<{ key: string; scene: Scene }[]>([]);
  const batch = useRef(0);

  const toggle = (scene: Scene) => setScenes((current) => (current.includes(scene) ? current.filter((s) => s !== scene) : [...current, scene]));
  const make = () => {
    const id = ++batch.current;
    setSlots((current) => [...current, ...scenes.map((scene) => ({ key: `${id}-${scene}`, scene }))]);
  };
  /** A picture done: it joins the character, and its slot leaves (it stays, with its error, when saving fails). */
  const finish = async (key: string, scene: Scene, job: JobSummary) => {
    const answer = await postJson(`/api/characters/${character.id}/photos`, {
      imageRef: job.outputImageRef,
      scene: photodumpScene(character.description, scenePhrase(scene)),
      jobId: job.id,
    });
    if (!answer.ok) return;
    onChange(answer.value);
    setSlots((current) => current.filter((slot) => slot.key !== key));
  };

  return (
    <section className={styles.detail} aria-labelledby="character-name-title">
      <div className={styles.detailHead}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the character's portrait */}
        <img className={styles.detailPortrait} src={character.imageUrl} alt="" />
        <div className={styles.detailText}>
          <h2 id="character-name-title" className={styles.detailName}>
            {character.name}
          </h2>
          <p className={styles.detailMeta}>
            {t(characterTypeKey(character.type))} · {character.description}
          </p>
          <button
            type="button"
            className={studio.buttonGhost}
            onClick={() => {
              if (window.confirm(t('characterDeleteConfirm', { name: character.name }))) onDelete();
            }}
          >
            {t('characterDelete')}
          </button>
        </div>
      </div>

      <div className={styles.photodump}>
        <h3 className={studio.sectionTitle}>{t('photodumpTitle')}</h3>
        {canEdit ? (
          <>
            <p className={studio.hint}>{t('photodumpLead')}</p>
            <div className={studio.styleRow} role="group" aria-label={t('photodumpTitle')}>
              {SCENES.map((scene) => (
                <button key={scene} type="button" className={studio.chip} aria-pressed={scenes.includes(scene)} onClick={() => toggle(scene)}>
                  {t(sceneKey(scene))}
                </button>
              ))}
            </div>
            <button type="button" className={studio.buttonPrimary} disabled={scenes.length === 0} onClick={make}>
              {t('photodumpMake', { n: scenes.length, s: scenes.length * editEstimate })}
            </button>
          </>
        ) : (
          <p className={studio.hint}>{t('photodumpNeedsEdit')}</p>
        )}
      </div>

      {slots.length > 0 && (
        <ul className={styles.slots} aria-live="polite">
          {slots.map((slot) => (
            <PhotodumpSlot
              key={slot.key}
              character={character}
              scene={slot.scene}
              onDone={(job) => void finish(slot.key, slot.scene, job)}
              onDismiss={() => setSlots((current) => current.filter((entry) => entry.key !== slot.key))}
            />
          ))}
        </ul>
      )}

      <ul className={styles.photos}>
        <li className={styles.photo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the portrait */}
          <img src={character.imageUrl} alt="" />
          <p className={styles.photoScene}>{t('characterPortrait')}</p>
          <AnimateLinks historyKey={character.portraitHistoryKey} tabs={tabs} />
        </li>
        {[...character.photos].reverse().map((photo) => (
          <li key={photo.imageRef} className={styles.photo}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a photodump picture */}
            <img src={photo.url} alt="" />
            <p className={styles.photoScene}>{photo.scene}</p>
            <AnimateLinks historyKey={photo.historyKey} tabs={tabs} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Characters: make a fictional character once, then its photodump, then animate any picture of it. */
export function CharactersPage() {
  const { t } = useI18n();
  const info = useExtensions();
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (IS_SHOWCASE) return;
    let alive = true;
    apiFetch('/api/characters')
      .then((res) => jsonOrThrow<CharacterSummary[]>(res))
      .then((list) => alive && setCharacters(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const selected = characters?.find((character) => character.id === selectedId) ?? characters?.[0] ?? null;
  const replace = (next: CharacterSummary) =>
    setCharacters((current) => (current ? current.map((character) => (character.id === next.id ? next : character)) : [next]));
  const remove = async (id: string) => {
    const res = await apiFetch(`/api/characters/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setCharacters((current) => current?.filter((character) => character.id !== id) ?? null);
  };

  return (
    <>
      <Header current="characters" />
      <main className={styles.page}>
        <div className={styles.intro}>
          <h1 className={styles.title}>{t('charactersTitle')}</h1>
          <p className={styles.lead}>{t('charactersLead')}</p>
        </div>
        {IS_SHOWCASE ? (
          <p className={studio.hint}>{t('charactersShowcase')}</p>
        ) : (
          <div className={styles.layout}>
            <CreatePanel
              estimate={info?.estimates.t2i ?? 5}
              onSaved={(character) => {
                setCharacters((current) => [character, ...(current ?? [])]);
                setSelectedId(character.id);
              }}
            />
            <div className={styles.content}>
              {failed && (
                <p className={studio.photoError} role="alert">
                  {t('errorGeneric')}
                </p>
              )}
              {characters && characters.length === 0 && <p className={styles.empty}>{t('charactersEmpty')}</p>}
              {characters && characters.length > 0 && (
                <ul className={styles.list} aria-label={t('charactersTitle')}>
                  {characters.map((character) => (
                    <li key={character.id}>
                      <button
                        type="button"
                        className={styles.card}
                        aria-pressed={selected?.id === character.id}
                        onClick={() => setSelectedId(character.id)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a character's portrait */}
                        <img src={character.imageUrl} alt="" />
                        <span className={styles.cardName}>{character.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && (
                <CharacterDetail
                  key={selected.id}
                  character={selected}
                  tabs={visibleTabs(info)}
                  canEdit={Boolean(info?.extensions.includes('edit'))}
                  editEstimate={info?.estimates.edit ?? 15}
                  onChange={replace}
                  onDelete={() => void remove(selected.id)}
                />
              )}
            </div>
          </div>
        )}
      </main>
      <ShowcaseFooter />
    </>
  );
}
